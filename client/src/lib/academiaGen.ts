/**
 * Knowledge Forge generation, done by a model instead of a template.
 *
 * What this replaces: `buildArtifact()` produced nine fixed strings by slotting
 * extracted sentences into prose scaffolding, so a "quiz" asked "which
 * statement is supported by the selected material?" nine times and a "mind map"
 * was the ten most frequent non-stop words. Nothing in it read the material.
 *
 * Read once, compose many
 * -----------------------
 *
 * A local model has a context window measured in thousands of tokens and a
 * study PDF is measured in hundreds of thousands of characters, so nothing here
 * hands a document to a model whole. It is read passage by passage — and the
 * result of that reading is **kept**.
 *
 *   1. **Read** (`readSource`) — one constrained call per chunk, producing a
 *      summary, the points worth keeping, and the terms the chunk introduces.
 *      Linear in the document and the only slow part. Saved to IndexedDB as it
 *      goes, so an interrupted read resumes instead of restarting, and a
 *      re-read after an edit keeps every passage whose text did not change.
 *   2. **Compose** (`composeArtifact`, `composeNote`) — one constrained call
 *      over the stored digest. Seconds, not minutes, and it is what runs every
 *      time you press a Studio button.
 *
 * The first version paid step 1 again for every artifact: the same forty pages
 * digested from scratch to make a quiz, then again for a slide deck. Reading is
 * a property of the source, not of the thing being made from it.
 *
 * When a document is long enough that even its summaries will not fit, they are
 * folded into section summaries, repeatedly, until they do. That fold is why a
 * 400-page book produces a report about the whole book rather than about its
 * introduction.
 *
 * Every call is schema-constrained (see `localLLM.ts`) and every result is
 * validated for the things a schema cannot express — four distinct options, an
 * answer index in range, a card with something on both sides. A rejected
 * generation is retried once with the reason attached, then abandoned, and the
 * reason is carried to the surface rather than flattened into "it failed".
 *
 * Artifacts remain a single string in `StudioArtifact.content`, so none of this
 * needs a store migration beyond the digest store itself. The model returns
 * structure; the formatters below turn it back into the monospace text the
 * viewer already renders.
 */

import type {
  AcademiaSource, DigestPassage, SourceDigest, StudioKind,
} from "@/lib/academiaStore";
import { awaitIdle, generateJson, NUM_CTX_PASSAGE, type JsonSchema, type LocalLLMConfig } from "@/lib/localLLM";
import { CHUNKING_VERSION, chunkSource } from "@/lib/textChunks";

/* ── Limits ──────────────────────────────────────────────────────────── */

/**
 * Passage summaries a compose call may see before they are folded.
 *
 * Sized to sit inside the context window `localLLM` asks for, with room for the
 * instruction and the answer. Overrunning it does not raise an error — Ollama
 * truncates quietly — so this number is the difference between a report about
 * the document and a report about its first few pages.
 */
// Sized so a compose prompt fits the application's single context window: a
// summary runs to roughly sixty tokens, so fourteen of them plus the
// instruction and the answer sit comfortably inside 4096.
const FOLD_THRESHOLD = 14;
const FOLD_GROUP = 6;
/** Passages read between saves, so a cancelled read loses seconds, not minutes. */
const SAVE_EVERY = 3;

/* ── Progress ────────────────────────────────────────────────────────── */

export interface GenProgress {
  phase: "reading" | "folding" | "composing";
  done: number;
  total: number;
  label: string;
}

/* ── Reading ─────────────────────────────────────────────────────────── */

const DIGEST_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    // Bounded on purpose: an unbounded array under constrained decoding is a
    // grammar that lets a small model emit elements until the context runs out.
    points: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 },
    terms: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 6 },
  },
  required: ["summary", "points", "terms"],
};

const STUDY_SYSTEM =
  "You are a careful study assistant. You work only from the text you are given. " +
  "You never introduce facts, names, numbers or claims that are not in it, and you " +
  "never pad. If the text does not support something, you leave it out.";

function validateDigest(value: unknown): { summary: string; points: string[]; terms: string[] } {
  const v = value as Partial<DigestPassage>;
  if (typeof v?.summary !== "string" || !v.summary.trim()) throw new Error("the summary came back empty");
  const list = (raw: unknown, cap: number) =>
    (Array.isArray(raw) ? raw : []).map(String).map(s => s.trim()).filter(Boolean).slice(0, cap);
  return { summary: v.summary.trim(), points: list(v.points, 6), terms: list(v.terms, 6) };
}

export interface ReadRequest {
  cfg: LocalLLMConfig;
  profileId: number;
  source: AcademiaSource;
  /** A previous read of this source. Matching passages are reused, not re-read. */
  existing?: SourceDigest;
  targetChars?: number;
  signal?: AbortSignal;
  onProgress?: (progress: GenProgress) => void;
  /** Called with the digest so far. Persist it; this is what makes a read resumable. */
  onPartial?: (digest: SourceDigest) => void | Promise<void>;
}

/**
 * Read one source into a digest, resuming and reusing wherever it can.
 *
 * Chunks are keyed by a hash of their own text, so re-reading an edited note
 * costs only the passages that actually changed — which is the whole reason the
 * chunker hashes rather than numbering.
 */
export async function readSource(request: ReadRequest): Promise<SourceDigest> {
  const targetChars = request.targetChars ?? 900;
  const chunks = chunkSource(request.source.id, request.source.text, { targetChars });

  const reusable = new Map<string, DigestPassage>();
  if (
    request.existing &&
    request.existing.model === request.cfg.model &&
    request.existing.chunkingVersion === CHUNKING_VERSION &&
    request.existing.targetChars === targetChars
  ) {
    for (const passage of request.existing.passages) reusable.set(passage.hash, passage);
  }

  const now = Date.now();
  const digest: SourceDigest = {
    id: request.source.id,
    profileId: request.profileId,
    model: request.cfg.model,
    chunkingVersion: CHUNKING_VERSION,
    targetChars,
    passages: [],
    chunkCount: chunks.length,
    complete: false,
    createdAt: request.existing?.createdAt ?? now,
    updatedAt: now,
  };

  for (let i = 0; i < chunks.length; i++) {
    request.signal?.throwIfAborted();
    // Yield the model to anyone waiting on it. A read is minutes of work that
    // nobody is watching; a Quantum Recall round is someone sitting in front of
    // a timer. Without this the round queues behind the job inside Ollama and
    // times out.
    await awaitIdle(request.signal);
    const chunk = chunks[i];
    // `chunkSource` builds the id as `${sourceId}:${hash}`.
    const hash = chunk.id.slice(chunk.id.lastIndexOf(":") + 1);

    request.onProgress?.({
      phase: "reading",
      done: i,
      total: chunks.length,
      label: `${request.source.name} — passage ${i + 1} of ${chunks.length}`,
    });

    const reused = reusable.get(hash);
    if (reused) {
      digest.passages.push({ ...reused, index: i, hash });
      continue;
    }

    const result = await generateJson(request.cfg, {
      system: STUDY_SYSTEM,
      schema: DIGEST_SCHEMA,
      validate: validateDigest,
      signal: request.signal,
      temperature: 0.2,
      // Dozens of these per source. An 8k window on a 900-character passage
      // reserves a KV cache that can never be used and slows every call.
      numCtx: NUM_CTX_PASSAGE,
      numPredict: 400,
      label: "forge: read passage",
      prompt:
        `Passage ${i + 1} of ${chunks.length} from "${request.source.name}".\n\n` +
        `---\n${chunk.text}\n---\n\n` +
        "Give a two to three sentence summary of what this passage establishes, " +
        "the specific points worth remembering from it (claims, definitions, " +
        "figures, steps \u2014 not topic labels), and any terms it introduces. " +
        "Use the passage's own vocabulary.",
    });

    digest.passages.push({ index: i, hash, ...result });
    digest.updatedAt = Date.now();
    if ((i + 1) % SAVE_EVERY === 0) await request.onPartial?.({ ...digest, passages: [...digest.passages] });
  }

  digest.complete = true;
  digest.updatedAt = Date.now();
  await request.onPartial?.({ ...digest, passages: [...digest.passages] });
  request.onProgress?.({ phase: "reading", done: chunks.length, total: chunks.length, label: `${request.source.name} read` });
  return digest;
}

/* ── Folding ─────────────────────────────────────────────────────────── */

/** Compact rendering of a passage set, for a compose prompt. */
function outline(passages: DigestPassage[]): string {
  return passages
    .map((p, i) => [`[${i + 1}] ${p.summary}`, ...p.points.map(point => `    - ${point}`)].join("\n"))
    .join("\n");
}

interface FoldRequest {
  cfg: LocalLLMConfig;
  subject: string;
  signal?: AbortSignal;
  onProgress?: (progress: GenProgress) => void;
}

/**
 * Fold passage summaries into section summaries until they fit a compose call.
 *
 * Groups are contiguous, so a section summary describes a stretch of the
 * document rather than a scatter of it, and the composed artifact keeps the
 * document's order. Repeats because one pass is not always enough: 200 passages
 * fold to 34, which still will not fit.
 */
async function foldPassages(request: FoldRequest, passages: DigestPassage[]): Promise<DigestPassage[]> {
  let current = passages;
  while (current.length > FOLD_THRESHOLD) {
    const groups: DigestPassage[][] = [];
    for (let i = 0; i < current.length; i += FOLD_GROUP) groups.push(current.slice(i, i + FOLD_GROUP));
    // A fold that cannot reduce further would loop forever; compose over what
    // there is rather than hanging.
    if (groups.length >= current.length) break;

    const folded: DigestPassage[] = [];
    for (let i = 0; i < groups.length; i++) {
      request.signal?.throwIfAborted();
      request.onProgress?.({
        phase: "folding",
        done: i,
        total: groups.length,
        label: `Consolidating section ${i + 1} of ${groups.length}`,
      });
      const group = groups[i];
      const result = await generateJson(request.cfg, {
        system: STUDY_SYSTEM,
        schema: DIGEST_SCHEMA,
        validate: validateDigest,
        signal: request.signal,
        temperature: 0.2,
        prompt:
          `Consecutive passage summaries from "${request.subject}":\n\n${outline(group)}\n\n` +
          "Consolidate these into one section summary, the points that survive " +
          "consolidation, and the section's key terms. Drop nothing important; " +
          "merge what repeats.",
      });
      folded.push({ index: group[0].index, hash: "", ...result });
    }
    current = folded;
  }
  return current;
}

/* ── Artifact specifications ─────────────────────────────────────────── */

const str = { type: "string" } as const;
const strArray = { type: "array", items: { type: "string" } } as const;

interface ArtifactSpec {
  /** What the model is being asked to write. */
  instruction: string;
  schema: JsonSchema;
  validate: (value: unknown) => any;
  format: (value: any, context: { subject: string; sourceNames: string[] }) => string;
  temperature?: number;
}

function requireArray(value: unknown, key: string, min: number): any[] {
  const list = (value as Record<string, unknown>)?.[key];
  if (!Array.isArray(list) || list.length < min) throw new Error(`${key} needed at least ${min} entries`);
  return list;
}

function heading(label: string, subject: string): string {
  return `${label} · ${subject}`;
}

const SPECS: Record<StudioKind, ArtifactSpec> = {

  audio: {
    instruction:
      "Write a two-voice briefing between a HOST who asks and an ANALYST who explains. " +
      "Twelve to eighteen turns, starting with the host. The analyst's turns carry the " +
      "actual content — mechanisms and specifics, not summaries of summaries.",
    schema: {
      type: "object",
      properties: {
        exchanges: {
          type: "array",
          items: {
            type: "object",
            properties: { speaker: { type: "string", enum: ["HOST", "ANALYST"] }, line: str },
            required: ["speaker", "line"],
          },
        },
        keyTerms: strArray,
      },
      required: ["exchanges", "keyTerms"],
    },
    validate: value => {
      requireArray(value, "exchanges", 6);
      return value;
    },
    format: (value, ctx) => [
      heading("AUDIO OVERVIEW", ctx.subject),
      "",
      ...value.exchanges.map((e: any) => `${e.speaker}: ${e.line}`),
      "",
      `KEY TERMS: ${(value.keyTerms ?? []).join(" · ")}`,
    ].join("\n"),
  },

  slides: {
    instruction:
      "Build a presentation outline: six to ten slides, each with a heading, two to " +
      "four bullets that state something rather than name a topic, and a speaker note " +
      "giving the point of the slide.",
    schema: {
      type: "object",
      properties: {
        slides: {
          type: "array",
          items: {
            type: "object",
            properties: { heading: str, bullets: strArray, note: str },
            required: ["heading", "bullets", "note"],
          },
        },
      },
      required: ["slides"],
    },
    validate: value => {
      requireArray(value, "slides", 4);
      return value;
    },
    format: (value, ctx) => [
      heading("SLIDE DECK", ctx.subject),
      "",
      ...value.slides.flatMap((slide: any, i: number) => [
        `${String(i + 1).padStart(2, "0")} · ${slide.heading.toUpperCase()}`,
        ...(slide.bullets ?? []).map((b: string) => `  - ${b}`),
        slide.note ? `  note: ${slide.note}` : "",
        "",
      ]),
    ].join("\n").trimEnd(),
  },

  video: {
    instruction:
      "Write a narrated storyboard: five to eight scenes, each with a visual " +
      "description and the narration spoken over it. The narration must teach, not " +
      "announce what the viewer is about to see.",
    schema: {
      type: "object",
      properties: {
        scenes: {
          type: "array",
          items: {
            type: "object",
            properties: { title: str, visual: str, narration: str },
            required: ["title", "visual", "narration"],
          },
        },
      },
      required: ["scenes"],
    },
    validate: value => {
      requireArray(value, "scenes", 3);
      return value;
    },
    format: (value, ctx) => [
      heading("VIDEO STORYBOARD", ctx.subject),
      "",
      ...value.scenes.flatMap((scene: any, i: number) => [
        `SCENE ${String(i + 1).padStart(2, "0")} · ${scene.title.toUpperCase()}`,
        `Visual: ${scene.visual}`,
        `Narration: ${scene.narration}`,
        "",
      ]),
    ].join("\n").trimEnd(),
  },

  mindmap: {
    instruction:
      "Lay out the concept hierarchy: four to seven branches from the root, each with " +
      "two to four children carrying a short explanation of how the child relates to " +
      "its branch.",
    schema: {
      type: "object",
      properties: {
        root: str,
        branches: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: str,
              children: {
                type: "array",
                items: { type: "object", properties: { label: str, detail: str }, required: ["label", "detail"] },
              },
            },
            required: ["label", "children"],
          },
        },
      },
      required: ["root", "branches"],
    },
    validate: value => {
      requireArray(value, "branches", 3);
      return value;
    },
    format: (value, ctx) => [
      heading("MIND MAP", ctx.subject),
      "",
      `◆ ${value.root}`,
      ...value.branches.flatMap((branch: any, bi: number) => {
        const lastBranch = bi === value.branches.length - 1;
        const stem = lastBranch ? "  └─" : "  ├─";
        const rail = lastBranch ? "     " : "  │  ";
        return [
          `${stem} ${branch.label.toUpperCase()}`,
          ...(branch.children ?? []).map((child: any, ci: number) => {
            const lastChild = ci === branch.children.length - 1;
            return `${rail}${lastChild ? "└─" : "├─"} ${child.label} — ${child.detail}`;
          }),
        ];
      }),
    ].join("\n"),
  },

  report: {
    instruction:
      "Write a synthesis report: an executive summary of three or four sentences, four " +
      "to seven findings each with a heading and a paragraph, the connections between " +
      "them, and a conclusion that states what follows from all of it.",
    schema: {
      type: "object",
      properties: {
        executiveSummary: str,
        findings: {
          type: "array",
          items: { type: "object", properties: { heading: str, body: str }, required: ["heading", "body"] },
        },
        connections: strArray,
        conclusion: str,
      },
      required: ["executiveSummary", "findings", "connections", "conclusion"],
    },
    validate: value => {
      requireArray(value, "findings", 3);
      return value;
    },
    format: (value, ctx) => [
      heading("SYNTHESIS REPORT", ctx.subject),
      `Sources: ${ctx.sourceNames.join(", ") || "—"}`,
      "",
      "EXECUTIVE SUMMARY",
      value.executiveSummary,
      "",
      "FINDINGS",
      ...value.findings.flatMap((f: any, i: number) => [`${i + 1}. ${f.heading}`, `   ${f.body}`, ""]),
      "CONNECTIONS",
      ...(value.connections ?? []).map((c: string) => `  - ${c}`),
      "",
      "CONCLUSION",
      value.conclusion,
    ].join("\n"),
  },

  flashcards: {
    instruction:
      "Write twelve to twenty recall cards. A front that asks for one specific thing, a " +
      "back that answers it completely and no more. No card may be answerable from its " +
      "own wording, and no two cards may test the same fact.",
    schema: {
      type: "object",
      properties: {
        cards: {
          type: "array",
          items: { type: "object", properties: { front: str, back: str }, required: ["front", "back"] },
        },
      },
      required: ["cards"],
    },
    temperature: 0.3,
    validate: value => {
      const cards = requireArray(value, "cards", 6);
      const seen = new Set<string>();
      for (const card of cards) {
        const front = String(card.front ?? "").trim().toLowerCase();
        if (!front || !String(card.back ?? "").trim()) throw new Error("a card had an empty side");
        if (seen.has(front)) throw new Error("two cards asked the same question");
        seen.add(front);
      }
      return value;
    },
    format: (value, ctx) => [
      heading("FLASHCARD SET", ctx.subject),
      "",
      ...value.cards.flatMap((card: any, i: number) => [
        `CARD ${String(i + 1).padStart(2, "0")}`,
        `Q: ${card.front}`,
        `A: ${card.back}`,
        "",
      ]),
    ].join("\n").trimEnd(),
  },

  quiz: {
    instruction:
      "Write eight to twelve multiple-choice questions with exactly four options each. " +
      "Wrong options must be statements that are plausible for this material and wrong " +
      "for this question — never obviously silly, never 'none of the above'. Give the " +
      "index of the correct option and one sentence saying why it is correct.",
    schema: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              stem: str,
              options: { type: "array", items: str },
              answerIndex: { type: "integer" },
              explanation: str,
            },
            required: ["stem", "options", "answerIndex", "explanation"],
          },
        },
      },
      required: ["questions"],
    },
    temperature: 0.3,
    validate: value => {
      const questions = requireArray(value, "questions", 4);
      for (const q of questions) {
        const options = (q.options ?? []).map((o: unknown) => String(o).trim()).filter(Boolean);
        if (options.length !== 4) throw new Error("every question needs exactly four options");
        if (new Set(options.map((o: string) => o.toLowerCase())).size !== 4) throw new Error("a question had duplicate options");
        if (!Number.isInteger(q.answerIndex) || q.answerIndex < 0 || q.answerIndex > 3) {
          throw new Error("answerIndex must be 0, 1, 2 or 3");
        }
        q.options = options;
      }
      return value;
    },
    format: (value, ctx) => [
      heading("QUIZ", ctx.subject),
      "",
      ...value.questions.flatMap((q: any, i: number) => [
        `${i + 1}. ${q.stem}`,
        ...q.options.map((o: string, oi: number) => `   ${"ABCD"[oi]}. ${o}`),
        `   KEY: ${"ABCD"[q.answerIndex]} — ${q.explanation}`,
        "",
      ]),
    ].join("\n").trimEnd(),
  },

  infographic: {
    instruction:
      "Reduce the material to four to six signals. Each signal is a short label, the " +
      "single number or comparison that carries it where the text supplies one, and two " +
      "sentences of substance. Finish with one line that sums the whole picture.",
    schema: {
      type: "object",
      properties: {
        signals: {
          type: "array",
          items: {
            type: "object",
            properties: { label: str, figure: str, body: str },
            required: ["label", "figure", "body"],
          },
        },
        atAGlance: str,
      },
      required: ["signals", "atAGlance"],
    },
    validate: value => {
      requireArray(value, "signals", 3);
      return value;
    },
    format: (value, ctx) => [
      heading("INFOGRAPHIC BRIEF", ctx.subject),
      "",
      ...value.signals.flatMap((signal: any, i: number) => [
        `SIGNAL ${String(i + 1).padStart(2, "0")}  ${signal.label.toUpperCase()}${signal.figure ? `   ${signal.figure}` : ""}`,
        signal.body,
        "",
      ]),
      "AT A GLANCE",
      value.atAGlance,
    ].join("\n"),
  },

  table: {
    instruction:
      "Extract an evidence matrix: three to five columns chosen to suit this material, " +
      "and six to fifteen rows. Every cell must be short and come from the material. " +
      "Use an em dash where the material does not say.",
    schema: {
      type: "object",
      properties: {
        columns: strArray,
        rows: { type: "array", items: strArray },
      },
      required: ["columns", "rows"],
    },
    validate: value => {
      const columns = requireArray(value, "columns", 2);
      const rows = requireArray(value, "rows", 3);
      for (const row of rows) {
        if (!Array.isArray(row)) throw new Error("every row must be a list of cells");
        // Ragged rows are the most common structured-output failure and they
        // render as a broken table rather than as an error, so pad and trim.
        while (row.length < columns.length) row.push("—");
        row.length = columns.length;
      }
      return value;
    },
    format: (value, ctx) => {
      const clean = (cell: unknown) => String(cell ?? "—").replace(/\|/g, "/").trim() || "—";
      return [
        heading("DATA TABLE", ctx.subject),
        "",
        value.columns.map(clean).join(" | "),
        value.columns.map(() => "---").join(" | "),
        ...value.rows.map((row: unknown[]) => row.map(clean).join(" | ")),
      ].join("\n");
    },
  },
};

/* ── Composing ───────────────────────────────────────────────────────── */

export interface ComposeRequest {
  cfg: LocalLLMConfig;
  /** Stored digests of the armed sources, in the order they should be read. */
  digests: SourceDigest[];
  /**
   * The active note, included verbatim rather than digested.
   *
   * A note is short and is edited constantly, so digesting it would be a cache
   * that is stale the moment you type. Capped so a very long note cannot crowd
   * out the sources it was written from.
   */
  noteText?: string;
  subject: string;
  sourceNames: string[];
  signal?: AbortSignal;
  onProgress?: (progress: GenProgress) => void;
}

const NOTE_EXCERPT_LIMIT = 4_000;

function gatherPassages(digests: SourceDigest[]): DigestPassage[] {
  return digests.flatMap(digest => [...digest.passages].sort((a, b) => a.index - b.index));
}

/** Everything a compose prompt needs about where the material came from. */
function provenance(request: ComposeRequest, count: number): string {
  return (
    `Material: "${request.subject}"\n` +
    `Sources: ${request.sourceNames.join(", ") || "\u2014"}\n` +
    `Passage summaries below, in document order (${count}).\n`
  );
}

/**
 * Turn stored digests into the block a compose call reads.
 *
 * This is the only place the read-once design shows up as a saving: on a source
 * that has already been read it is pure string work, and the model is asked
 * exactly one question.
 */
async function prepareOutline(request: ComposeRequest): Promise<string> {
  const passages = gatherPassages(request.digests);
  if (!passages.length && !request.noteText?.trim()) {
    throw new Error("Nothing has been read yet. Read a source first.");
  }

  const folded = await foldPassages(
    { cfg: request.cfg, subject: request.subject, signal: request.signal, onProgress: request.onProgress },
    passages,
  );

  const blocks = [provenance(request, folded.length), outline(folded)];
  if (request.noteText?.trim()) {
    blocks.push(`\nYOUR OWN NOTES on this material:\n${request.noteText.trim().slice(0, NOTE_EXCERPT_LIMIT)}`);
  }
  return blocks.join("\n");
}

export async function composeArtifact(kind: StudioKind, request: ComposeRequest): Promise<string> {
  const spec = SPECS[kind];
  const material = await prepareOutline(request);

  request.signal?.throwIfAborted();
  request.onProgress?.({ phase: "composing", done: 0, total: 1, label: "Composing" });

  const value = await generateJson(request.cfg, {
    system: STUDY_SYSTEM,
    schema: spec.schema,
    validate: spec.validate,
    signal: request.signal,
    temperature: spec.temperature,
    prompt: `${material}\n\n${spec.instruction}`,
  });

  request.onProgress?.({ phase: "composing", done: 1, total: 1, label: "Composed" });
  return spec.format(value, { subject: request.subject, sourceNames: request.sourceNames });
}

/* ── Generated notes ─────────────────────────────────────────────────── */

const NOTE_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    title: str,
    overview: str,
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: { heading: str, body: str, details: strArray },
        required: ["heading", "body", "details"],
      },
    },
    keyTerms: {
      type: "array",
      items: { type: "object", properties: { term: str, definition: str }, required: ["term", "definition"] },
    },
    openQuestions: strArray,
  },
  required: ["title", "overview", "sections", "keyTerms", "openQuestions"],
};

export interface GeneratedNote {
  title: string;
  content: string;
}

/**
 * A note written from the material, in the shape a hand-written one would take.
 *
 * The output is plain text into `AcademiaNote.content`, deliberately: notes are
 * edited by hand in a textarea straight afterwards, and a format the editor
 * cannot round-trip would make the generated note a dead end rather than a
 * starting point.
 */
export async function composeNote(request: ComposeRequest): Promise<GeneratedNote> {
  const material = await prepareOutline(request);
  const passagesRead = gatherPassages(request.digests).length;

  request.signal?.throwIfAborted();
  request.onProgress?.({ phase: "composing", done: 0, total: 1, label: "Writing the note" });

  const value = await generateJson(request.cfg, {
    system: STUDY_SYSTEM,
    schema: NOTE_SCHEMA,
    signal: request.signal,
    temperature: 0.3,
    validate: v => {
      const note = v as any;
      if (!String(note?.overview ?? "").trim()) throw new Error("the overview came back empty");
      requireArray(note, "sections", 3);
      return note;
    },
    prompt:
      `${material}\n\n` +
      "Write detailed study notes over all of this. An overview of one paragraph, " +
      "then five to twelve sections following the document's own order \u2014 each with a " +
      "heading, a paragraph explaining it properly, and the specific details worth " +
      "keeping (definitions, figures, steps, names, conditions). Then the key terms " +
      "with their definitions, and the questions the material raises but does not " +
      "answer. Prefer the material's own wording for anything technical.",
  });

  const content = [
    value.overview.trim(),
    "",
    ...value.sections.flatMap((section: any) => [
      section.heading.toUpperCase(),
      section.body,
      ...(section.details ?? []).map((d: string) => `  - ${d}`),
      "",
    ]),
    "KEY TERMS",
    ...(value.keyTerms ?? []).map((t: any) => `  ${t.term} \u2014 ${t.definition}`),
    "",
    "OPEN QUESTIONS",
    ...(value.openQuestions ?? []).map((q: string) => `  - ${q}`),
    "",
    `Generated from ${request.sourceNames.join(", ") || "the selected material"} \u00b7 ${passagesRead} passages`,
  ].join("\n");

  request.onProgress?.({ phase: "composing", done: 1, total: 1, label: "Note written" });
  return { title: String(value.title || request.subject).trim(), content };
}
