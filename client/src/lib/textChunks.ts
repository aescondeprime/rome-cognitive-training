/**
 * Cutting source material into the unit everything else counts in.
 *
 * A chunk is two things at once: the excerpt Quantum Recall puts on screen
 * under a timer, and the row the coverage ledger tracks. That is why the
 * chunker lives on its own rather than inside either feature — and why it
 * arrives now, in the generation phase, rather than with the game. A forty-page
 * PDF cannot be handed to a 7B model whole, so even a plain summary is a
 * map-reduce over these chunks.
 *
 * What it deliberately does *not* do:
 *
 * - **It does not reuse `sentences()` from Academia.** That helper keeps only
 *   sentences between 30 and 420 characters, which silently discards most
 *   headings, list items, table rows and formulas. Fine for picking a pull
 *   quote; ruinous for a feature whose promise is that the rounds eventually
 *   cover everything.
 * - **It does not overlap chunks.** Overlap makes retrieval nicer and coverage
 *   meaningless — a sentence in two chunks is either counted twice or covered
 *   by neither. Chunks partition the text exactly.
 * - **It does not truncate.** `sourceCorpus()` slices the corpus at 120,000
 *   characters, which is invisible and wrong here.
 *
 * Chunks are keyed by a hash of their own text, so editing the top of a note
 * does not invalidate the history of every chunk below it: whatever still
 * hashes the same keeps its record, and whatever does not is simply new.
 */

/**
 * Bump when the cutting rules change.
 *
 * Stored beside a ledger so old coverage can be recognised as having been
 * measured against different excerpts, rather than quietly mixing with new.
 */
export const CHUNKING_VERSION = 1;

export interface Chunk {
  /** Stable across re-chunking as long as the text is unchanged. */
  id: string;
  sourceId: string;
  /** Position in the source, for ordering and for "chunk 12 of 84". */
  index: number;
  text: string;
  /** Offsets into the normalized source text, for proof spans later. */
  start: number;
  end: number;
}

export interface ChunkOptions {
  /** Excerpt size aimed for. This is the difficulty dial in the optimizer. */
  targetChars?: number;
  /** Never cut a chunk shorter than this, except for the last one. */
  minChars?: number;
}

const DEFAULT_TARGET = 900;
const DEFAULT_MIN = 320;
/** How far past target a boundary may sit before a hard cut wins instead. */
const OVERRUN = 1.35;

/**
 * FNV-1a, 32-bit, hex.
 *
 * Not cryptographic and does not need to be — this identifies a chunk within
 * one profile's own library. `crypto.subtle` is async, and a chunker that
 * returns a promise infects every caller for no benefit here.
 */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Repair what PDF text extraction does to prose.
 *
 * `extractPdf()` joins `getTextContent()` items with a single space and pages
 * with a blank line, so what arrives has no paragraph structure, arbitrary
 * runs of whitespace, and words broken across line ends by the typesetter.
 * Leaving the hyphens in means the model reads "cogni tive" and the reader
 * sees it in the excerpt.
 */
export function normalizeExtractedText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    // Soft hyphen and typeset line-break hyphenation. Restricted to lowercase
    // on both sides so real compounds ("well- known", "Anglo- Saxon") survive.
    .replace(/\u00ad/g, "")
    .replace(/([a-z])-\s+([a-z])/g, "$1$2")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Every offset at which a chunk may legitimately end.
 *
 * Sentence terminators, closing quotes and brackets included, plus paragraph
 * breaks — a heading followed by a blank line has no full stop and is still a
 * perfectly good place to cut.
 */
function boundaryOffsets(text: string): number[] {
  const offsets: number[] = [];
  const pattern = /([.!?]["'”’)\]]*\s+)|(\n+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    offsets.push(match.index + match[0].length);
  }
  return offsets;
}

/** Last whitespace at or before `limit`, so a hard cut never splits a word. */
function wordCutBefore(text: string, from: number, limit: number): number {
  for (let i = Math.min(limit, text.length) - 1; i > from; i--) {
    if (/\s/.test(text[i])) return i + 1;
  }
  return Math.min(limit, text.length);
}

/**
 * Cut normalized text into spans.
 *
 * Walks forward, and at each step takes the boundary nearest the target that is
 * neither too early nor too far past it. Falling back to a word cut rather than
 * stretching means a document with no punctuation at all — a slide deck, a
 * table — still produces even excerpts instead of one enormous chunk.
 */
export function chunkText(text: string, options: ChunkOptions = {}): Array<{ text: string; start: number; end: number }> {
  const target = Math.max(200, Math.round(options.targetChars ?? DEFAULT_TARGET));
  const min = Math.max(80, Math.min(Math.round(options.minChars ?? DEFAULT_MIN), target - 40));
  const body = text.trim();
  if (!body) return [];

  const ends = boundaryOffsets(body);
  const spans: Array<{ text: string; start: number; end: number }> = [];
  let start = 0;
  let cursor = 0;

  while (start < body.length) {
    const remaining = body.length - start;
    // A tail that is merely a little over target is kept whole rather than
    // split into a full chunk plus a two-line orphan.
    if (remaining <= target * OVERRUN) {
      spans.push({ text: body.slice(start).trim(), start, end: body.length });
      break;
    }

    const ideal = start + target;
    const earliest = start + min;
    const latest = start + Math.round(target * OVERRUN);

    let chosen = -1;
    while (cursor < ends.length && ends[cursor] <= earliest) cursor++;
    for (let i = cursor; i < ends.length && ends[i] <= latest; i++) {
      if (chosen < 0 || Math.abs(ends[i] - ideal) < Math.abs(chosen - ideal)) chosen = ends[i];
    }
    if (chosen < 0) chosen = wordCutBefore(body, earliest, ideal);
    if (chosen <= start) chosen = Math.min(body.length, ideal);

    const slice = body.slice(start, chosen).trim();
    if (slice) spans.push({ text: slice, start, end: chosen });
    start = chosen;
  }

  return spans.filter(span => span.text.length > 0);
}

/** Chunk one source's raw text, normalizing first. */
export function chunkSource(sourceId: string, rawText: string, options: ChunkOptions = {}): Chunk[] {
  const normalized = normalizeExtractedText(rawText);
  return chunkText(normalized, options).map((span, index) => ({
    id: `${sourceId}:${hashText(span.text)}`,
    sourceId,
    index,
    text: span.text,
    start: span.start,
    end: span.end,
  }));
}

export function wordCount(text: string): number {
  const matched = text.trim().match(/\S+/g);
  return matched ? matched.length : 0;
}

/**
 * Even sampling across a document, order preserved.
 *
 * Used where a job has to fit a budget — a fast summary of a 400-page book —
 * and taking the first N chunks would describe only the introduction.
 */
export function spreadSample<T>(items: T[], limit: number): T[] {
  if (limit >= items.length || limit <= 0) return items.slice();
  const step = items.length / limit;
  const out: T[] = [];
  for (let i = 0; i < limit; i++) out.push(items[Math.floor(i * step)]);
  return out;
}
