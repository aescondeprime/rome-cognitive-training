/**
 * Comparing what you could recall against what the document says.
 *
 * The decision was claim-level alignment rather than diffing prose, because
 * diffing your words against the source's words produces noise: you said the
 * same thing differently and the diff calls it a difference. A claim is the
 * unit that can honestly be called covered or missed.
 *
 * **The claims are already extracted.** Reading a source produced, per passage,
 * "the specific points worth remembering — claims, definitions, figures, steps".
 * Those are the claims, and they are cached in the digest with the passage they
 * came from. So the expensive half of a map-reduce was paid during reading, and
 * Compare is only the reduce: batches of claims held up against what you wrote.
 *
 * That is also why an unread source cannot be compared. It is not a limitation
 * worth engineering around — reading is the thing that makes every other part
 * of this feature good, and Compare is where its absence finally has to be said
 * out loud.
 *
 * Batching is bounded rather than clever: eight claims per call keeps each
 * prompt inside the one context window the app uses, makes progress meaningful,
 * and means a single bad batch costs eight claims rather than the document.
 */

import { generateJson, type JsonSchema, type LocalLLMConfig } from "@/lib/localLLM";
import type { ClaimAlignment, ClaimVerdict, SourceDigest } from "@/lib/academiaStore";

/** Claims per model call. Bounded so a bad batch costs eight claims, not the run. */
const BATCH = 8;

export interface CompareProgress {
  done: number;
  total: number;
  label: string;
}

export interface SourceClaim {
  claim: string;
  sourceId: string;
  chunkIndex: number;
  chunkHash: string;
}

/**
 * Every claim the read produced, in document order.
 *
 * Deduplicated case-insensitively: a point restated in two passages is one
 * thing to have recalled, and counting it twice would make coverage read low
 * for the wrong reason.
 */
export function gatherClaims(digests: SourceDigest[], corpusIds: string[]): SourceClaim[] {
  const claims: SourceClaim[] = [];
  const seen = new Set<string>();

  for (const digest of digests) {
    if (!corpusIds.includes(digest.id)) continue;
    for (const passage of [...digest.passages].sort((a, b) => a.index - b.index)) {
      for (const point of passage.points) {
        const text = point.trim();
        const key = text.toLowerCase().replace(/\s+/g, " ");
        if (!text || seen.has(key)) continue;
        seen.add(key);
        claims.push({ claim: text, sourceId: digest.id, chunkIndex: passage.index, chunkHash: passage.hash });
      }
    }
  }
  return claims;
}

const ALIGNMENT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer", minimum: 0, maximum: BATCH - 1 },
          verdict: { type: "string", enum: ["covered", "partial", "missed"] },
          note: { type: "string" },
        },
        required: ["index", "verdict", "note"],
      },
      minItems: 1,
      maxItems: BATCH,
    },
  },
  required: ["results"],
};

const SYSTEM =
  "You compare a person's written recollection against claims from the document " +
  "they were studying. You are judging whether the substance is there, not the " +
  "wording: a claim said differently, or in less detail but correctly, is covered. " +
  "A claim they clearly never reached is missed. You never invent claims and you " +
  "never mark something covered because it sounds plausible.";

export interface CompareRequest {
  cfg: LocalLLMConfig;
  claims: SourceClaim[];
  archive: string;
  /** Alignments already decided, so an interrupted comparison resumes. */
  existing?: ClaimAlignment[];
  signal?: AbortSignal;
  onProgress?: (progress: CompareProgress) => void;
  /** Called after each batch so a partial comparison can be saved. */
  onPartial?: (alignments: ClaimAlignment[]) => void | Promise<void>;
}

/**
 * Hold each claim up against the archive.
 *
 * Returns everything decided so far even when it stops early, because a
 * comparison that got two thirds of the way through is still worth reading and
 * is worth resuming rather than repeating.
 */
export async function compareArchive(request: CompareRequest): Promise<ClaimAlignment[]> {
  const decided = new Map<string, ClaimAlignment>();
  for (const alignment of request.existing ?? []) decided.set(`${alignment.sourceId}:${alignment.claim}`, alignment);

  const outstanding = request.claims.filter(claim => !decided.has(`${claim.sourceId}:${claim.claim}`));
  const batches: SourceClaim[][] = [];
  for (let i = 0; i < outstanding.length; i += BATCH) batches.push(outstanding.slice(i, i + BATCH));

  for (let b = 0; b < batches.length; b++) {
    request.signal?.throwIfAborted();
    const batch = batches[b];
    request.onProgress?.({
      done: decided.size,
      total: request.claims.length,
      label: `Comparing claim ${decided.size + 1} of ${request.claims.length}`,
    });

    try {
      const value = await generateJson<{ results: Array<{ index: number; verdict: ClaimVerdict; note: string }> }>(request.cfg, {
        system: SYSTEM,
        schema: ALIGNMENT_SCHEMA,
        signal: request.signal,
        temperature: 0.1,
        numPredict: 500,
        label: "compare: align claims",
        validate: raw => {
          const parsed = raw as { results?: unknown };
          if (!Array.isArray(parsed?.results) || !parsed.results.length) throw new Error("no verdicts came back");
          return parsed as { results: Array<{ index: number; verdict: ClaimVerdict; note: string }> };
        },
        prompt: [
          `What they wrote from memory:\n---\n${request.archive.trim() || "(nothing)"}\n---`,
          "",
          "Claims from the document:",
          ...batch.map((item, i) => `${i}. ${item.claim}`),
          "",
          "For each claim give its `index`, a `verdict` of covered, partial or missed, " +
          "and one short `note` addressed to them — for a miss, what it was they did not " +
          "reach; for a partial, what was thin.",
        ].join("\n"),
      });

      for (const result of value.results) {
        const claim = batch[result.index];
        if (!claim) continue;
        decided.set(`${claim.sourceId}:${claim.claim}`, {
          claim: claim.claim,
          sourceId: claim.sourceId,
          chunkIndex: claim.chunkIndex,
          chunkHash: claim.chunkHash,
          verdict: result.verdict,
          note: result.note?.trim() || undefined,
          // The model proposes; a gap is only kept if you confirm it.
          confirmed: result.verdict === "missed",
        });
      }
      // A claim the batch skipped is left undecided rather than guessed at.
      await request.onPartial?.(Array.from(decided.values()));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      // One failed batch is eight claims, not the comparison.
    }
  }

  request.onProgress?.({ done: decided.size, total: request.claims.length, label: "Comparison complete" });
  // Document order, so reading the result follows reading the document.
  return Array.from(decided.values()).sort((a, b) => a.chunkIndex - b.chunkIndex);
}

/* ── The note built from the gaps ────────────────────────────────────── */

const GAP_NOTE_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    overview: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          heading: { type: "string" },
          body: { type: "string" },
          claims: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 },
        },
        required: ["heading", "body", "claims"],
      },
      minItems: 1,
      maxItems: 8,
    },
  },
  required: ["title", "overview", "sections"],
};

export interface GapNote { title: string; content: string }

/**
 * A note about what you missed, which is itself drillable.
 *
 * Written from the confirmed gaps only. That confirmation matters: the note is
 * then a record of *your* gaps rather than the model's opinion of them, and one
 * bad alignment does not become a permanent note.
 */
export async function composeGapNote(
  cfg: LocalLLMConfig,
  subject: string,
  gaps: ClaimAlignment[],
  signal?: AbortSignal,
): Promise<GapNote> {
  if (!gaps.length) throw new Error("Nothing was marked as missed.");

  const value = await generateJson<any>(cfg, {
    system:
      "You write study notes covering exactly the material someone missed. You work " +
      "only from the claims given. You never add claims, and you never pad.",
    schema: GAP_NOTE_SCHEMA,
    signal,
    temperature: 0.3,
    numPredict: 900,
    label: "compare: write the gap note",
    validate: raw => {
      const parsed = raw as { overview?: string; sections?: unknown[] };
      if (!String(parsed?.overview ?? "").trim()) throw new Error("the overview came back empty");
      if (!Array.isArray(parsed.sections) || !parsed.sections.length) throw new Error("no sections came back");
      return raw;
    },
    prompt: [
      `Material: "${subject}".`,
      "",
      "These are the claims the reader did not recall:",
      ...gaps.map(gap => `- ${gap.claim}${gap.note ? ` (${gap.note})` : ""}`),
      "",
      "Group them into two to eight coherent sections. Each needs a heading, a " +
      "paragraph explaining the material properly rather than restating the claim, " +
      "and the claims it covers. Open with one paragraph saying what the gaps have " +
      "in common — that is the most useful thing you can tell them.",
    ].join("\n"),
  });

  const content = [
    value.overview.trim(),
    "",
    ...value.sections.flatMap((section: any) => [
      String(section.heading).toUpperCase(),
      section.body,
      ...(section.claims ?? []).map((claim: string) => `  - ${claim}`),
      "",
    ]),
    `Built from ${gaps.length} claim${gaps.length === 1 ? "" : "s"} missed on ${subject}.`,
  ].join("\n");

  return { title: String(value.title || `Gaps · ${subject}`).trim(), content };
}
