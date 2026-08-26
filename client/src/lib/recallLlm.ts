/**
 * Quantum Recall questions written by the local model.
 *
 * This replaces `createMockGenerator`, and the difference is the whole point of
 * phase 3. The mock took the longest non-stop word in a sentence and plugged it
 * into "What is X", "How does X work", "Why does X matter" — which is a fair
 * description of a template and a poor description of a question. It never
 * asked what the passage was *for*.
 *
 * Three decisions carry the quality here.
 *
 * **1. Questions are anchored on what the passage establishes, not on its
 * vocabulary.** Reading a source already produced a summary, the points worth
 * keeping and the terms it introduces; that digest is handed to the generator
 * as the anchor, and the model is told to test one of those points. When the
 * source was never read, an analysis call works the same thing out first. This
 * is the direct answer to "it is not intelligently selecting the mechanism".
 *
 * **2. One call per question, not one per round.** A small model given a large
 * nested schema and three jobs at once does all three badly. Given one passage,
 * one target and one question type, a 7B is markedly better — and it lets each
 * type carry its own instructions, which is where "a definition question is not
 * a process question" actually gets expressed. The round queue's depth-1
 * pipeline hides the extra latency behind the previous round's answering time.
 *
 * **3. Proof is a verbatim quote, located by us.** The decision said character
 * offsets; models are unreliable at counting characters and reliable at copying
 * a sentence, so the model returns the sentence and `locateQuote` finds it. The
 * guarantee is what matters and it is stronger this way: a quote that cannot be
 * found in the passage is marked unverified and no citation is claimed, rather
 * than an offset pair that happens to parse and points at the wrong words.
 */

import { generateJson, NUM_CTX_PASSAGE, type JsonSchema, type LocalLLMConfig } from "@/lib/localLLM";

/**
 * Every array in every schema below is bounded.
 *
 * This is not tidiness. Under constrained decoding an unbounded array is a
 * grammar that permits another element forever, and a small model given that
 * grammar will take it: it emits option after option and never closes the
 * bracket, running until the context limit. That is why a 3B could appear
 * *slower* than a 7B — the 7B knew when to stop and the 3B did not, so it spent
 * minutes producing tokens that were then thrown away as invalid.
 *
 * `minItems`/`maxItems` make stopping the only legal move, and `numPredict`
 * below turns any remaining runaway into a fast retry rather than a hang.
 */
const boundedStrings = (min: number, max: number): JsonSchema =>
  ({ type: "array", items: { type: "string" }, minItems: min, maxItems: max });
import type { RecallQuestionType } from "@/lib/academiaStore";
import {
  plannedMix, type GenerateRoundInput, type GradeOpenInput, type PassageAnchor,
  type ProofSpan, type Question, type Round, type RoundGenerator, type Verdict,
} from "@/lib/recallRound";

/** Room for a passage, its neighbours' sentences, and an answer. */
const ROUND_NUM_CTX = 4096;

const SYSTEM =
  "You write recall questions for someone studying a document. You work only from " +
  "the passage you are given. You never test general knowledge, never ask about " +
  "the passage as an object (\"what does this passage discuss\"), and never ask " +
  "something answerable from the wording of the question itself. You test what a " +
  "reader would have to have understood: the mechanism, the causal relation, the " +
  "condition, the figure, the distinction the passage draws.";

/* ── Locating proof ──────────────────────────────────────────────────── */

/**
 * Find a quoted sentence in the passage.
 *
 * Exact first, then with whitespace collapsed, because a model copying a
 * sentence out of extracted PDF text reliably normalises the spacing. Anything
 * looser would start matching things the passage does not say, which is the one
 * failure this function exists to prevent.
 */
export function locateQuote(passage: string, quote: string): { start: number; end: number } | null {
  const needle = quote.trim();
  if (needle.length < 8) return null;

  const exact = passage.indexOf(needle);
  if (exact >= 0) return { start: exact, end: exact + needle.length };

  const collapse = (value: string) => value.replace(/\s+/g, " ");
  const flatPassage = collapse(passage);
  const flatNeedle = collapse(needle);
  const flatIndex = flatPassage.indexOf(flatNeedle);
  if (flatIndex < 0) return null;

  // Walk the original string counting non-collapsed positions, so the offsets
  // returned point into the passage as it is actually stored.
  let seen = 0;
  let start = -1;
  for (let i = 0; i < passage.length; i++) {
    const isSpace = /\s/.test(passage[i]);
    const previousIsSpace = i > 0 && /\s/.test(passage[i - 1]);
    if (isSpace && previousIsSpace) continue;
    if (seen === flatIndex && start < 0) start = i;
    if (seen === flatIndex + flatNeedle.length) return { start, end: i };
    seen++;
  }
  return start >= 0 ? { start, end: passage.length } : null;
}

/**
 * The fragment of the passage around a piece of text, to sentence or bullet
 * bounds.
 *
 * Study PDFs are full of slide-style bullet lists — "Management of Hypertension
 * • Take medication as prescribed • Monitor BP regularly" — where a full stop
 * never arrives. Bullets and newlines have to count as boundaries or the
 * "sentence" is the whole passage.
 */
function surrounding(passage: string, start: number, end: number): { start: number; end: number } {
  const isBoundary = (character: string) => /[.!?\n•·▪]/.test(character);
  let from = start;
  while (from > 0 && !isBoundary(passage[from - 1])) from--;
  let to = end;
  while (to < passage.length && !isBoundary(passage[to])) to++;
  return { start: from, end: Math.min(passage.length, to + 1) };
}

/**
 * Locate the evidence for an answer.
 *
 * The quote is tried first, then the answer itself — because the most common
 * way a quote fails to match is that the model edited it on the way out (it
 * copied its own blanked stem back, ellipses, a tidied bullet), and in those
 * cases the answer is still sitting in the passage where it always was. Finding
 * it there is a real citation, not a fallback to guessing.
 *
 * Only when neither can be found is the proof marked unverified, and then
 * nothing is claimed: the surface shows the passage and says no line could be
 * cited. A fabricated quote presented as evidence is the one outcome this must
 * never produce.
 */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-insensitive whole-word search, falling back to a plain one. */
function findWord(passage: string, needle: string): number {
  try {
    const pattern = new RegExp(`(^|[^A-Za-z0-9])${escapeForRegExp(needle)}([^A-Za-z0-9]|$)`, "i");
    const match = pattern.exec(passage);
    if (match) return match.index + match[1].length;
  } catch { /* an answer that will not compile falls through */ }
  return passage.toLowerCase().indexOf(needle.toLowerCase());
}

function proofFor(passage: string, quote: string, answer: string, offset: number): ProofSpan {
  const located = locateQuote(passage, quote);
  if (located) {
    return {
      start: offset + located.start,
      end: offset + located.end,
      text: passage.slice(located.start, located.end),
      verified: true,
    };
  }

  const trimmed = answer.trim();
  if (trimmed.length >= 2) {
    // Whole-word, so a two-character answer like "BP" or "pH" can still be
    // located without "in" matching inside "interference". A length floor was
    // the first attempt and it silently refused to cite exactly the short,
    // clinical answers that matter most.
    const index = findWord(passage, trimmed);
    if (index >= 0) {
      const span = surrounding(passage, index, index + trimmed.length);
      return {
        start: offset + span.start,
        end: offset + span.end,
        text: passage.slice(span.start, span.end).trim(),
        verified: true,
      };
    }
  }

  return { start: offset, end: offset + passage.length, text: quote.trim(), verified: false };
}

/**
 * There is no separate analysis call.
 *
 * There used to be: a passage with no digest got one extra generation asking
 * what it taught, whose answer then anchored the questions. It was the slowest
 * call in a round, the one that hit the five-minute timeout, and a failure mode
 * that took the whole round with it — for a benefit the question prompt already
 * has, since it is handed the passage itself.
 *
 * The anchor survives where it is free: a passage that was *read* carries its
 * summary, points and terms from the digest, which cost nothing extra because
 * reading produced them anyway. Everything else works from the passage, and the
 * type brief is what tells the model to pick the mechanism rather than a word.
 */

function cleanList(value: unknown, cap: number): string[] {
  return (Array.isArray(value) ? value : []).map(String).map(item => item.trim()).filter(Boolean).slice(0, cap);
}

/* ── One question ────────────────────────────────────────────────────── */

/**
 * One schema per question type, and this is not a refinement.
 *
 * There used to be a single schema serving all three types, which meant
 * `options` and `answerIndex` could not be in `required` — a blank has no
 * options. So the grammar explicitly permitted omitting them, the model
 * obligingly omitted them, and the validator then rejected every multiple
 * choice for having no options. Three attempts, every time, guaranteed. The
 * model was doing exactly what it was told; the schema was the bug.
 *
 * A property that does not apply to a type is now absent from that type's
 * schema entirely, rather than present-but-optional. Constrained decoding can
 * only produce what the grammar allows, so this is the difference between
 * asking and hoping.
 */
const COMMON_PROPERTIES = {
  /** What is being tested — used to stop the next question repeating it. */
  target: { type: "string" },
  stem: { type: "string" },
  answer: { type: "string" },
  /**
   * Deliberately early in the property list.
   *
   * A grammar emits object keys in schema order, and a long quote is where the
   * token budget goes: a 147-second blank question was cut off mid-quote with
   * everything else already correct. Short and early survives the cap.
   */
  proofQuote: { type: "string" },
  explanation: { type: "string" },
} as const;

const QUESTION_SCHEMAS: Record<RecallQuestionType, JsonSchema> = {
  choice: {
    type: "object",
    properties: { ...COMMON_PROPERTIES, options: boundedStrings(4, 4), answerIndex: { type: "integer", minimum: 0, maximum: 3 } },
    required: ["target", "stem", "options", "answerIndex", "answer", "proofQuote", "explanation"],
  },
  /**
   * A blank does not write its own stem.
   *
   * The stem of a fill-in-the-blank *is* a sentence from the passage with a
   * term removed, and `proofQuote` is that same sentence — so asking for both
   * was asking the model to copy the passage twice. On a bullet-list passage
   * where a "sentence" runs to the whole chunk, that alone overran the token
   * cap: three attempts, sixty-five seconds, cut off mid-JSON every time.
   *
   * It now returns the quote and the answer, and the stem is built here by
   * blanking one out of the other. Half the output, and the stem is verbatim
   * from the passage by construction rather than by hope.
   */
  blank: {
    type: "object",
    properties: {
      target: { type: "string" },
      answer: { type: "string" },
      proofQuote: { type: "string" },
      explanation: { type: "string" },
    },
    required: ["target", "answer", "proofQuote", "explanation"],
  },
  open: {
    type: "object",
    properties: { ...COMMON_PROPERTIES, rubric: boundedStrings(2, 4) },
    required: ["target", "stem", "answer", "rubric", "proofQuote", "explanation"],
  },
};

const TYPE_BRIEF: Record<RecallQuestionType, string> = {
  choice: [
    "Write ONE multiple-choice question with exactly four options.",
    "The three wrong options must be drawn from the neighbouring passages below —",
    "real statements about the same material that do not answer this question.",
    "Reword them to fit the stem. Never write \"none of the above\", never make a",
    "wrong option obviously absurd, and never let two options say the same thing.",
    "Give `answerIndex` as the position of the correct option, and `answer` as its text.",
  ].join(" "),
  blank: [
    "Write ONE fill-in-the-blank question. Choose from the passage the SHORTEST",
    "single sentence or bullet — at most twenty-five words — that carries a",
    "mechanism, a condition or a defined term, and put it in `proofQuote` copied",
    "exactly, with no edits and no blank in it. Put in `answer` the one term from",
    "that sentence which will be blanked out: it must be the term that carries the",
    "meaning, not an incidental adjective, and impossible to guess from grammar",
    "alone. Do not write the question yourself.",
  ].join(" "),
  open: [
    "Write ONE open-ended question of the flavour named below. It must require the",
    "reader to reconstruct something the passage establishes, in their own words.",
    "Do not ask \"what is X\" where X is merely a word that appeared; ask about the",
    "thing the passage was explaining. Give `answer` as a model answer of two or",
    "three sentences, and `rubric` as the two to four specific points a correct",
    "answer must contain.",
  ].join(" "),
};

/** Rotating flavours, so a run of open questions is not three definitions. */
const OPEN_FLAVOURS = [
  "a DEFINITION question — what something the passage defines actually is",
  "a PROCESS question — how something the passage describes works, step by step",
  "a CONCEPT question — why something in the passage holds, or why it matters",
];

interface RawQuestion {
  target: string;
  stem: string;
  answer: string;
  options?: unknown;
  answerIndex?: unknown;
  rubric?: unknown;
  proofQuote: string;
  explanation: string;
}

function validateRaw(type: RecallQuestionType, value: unknown): RawQuestion {
  const raw = value as Partial<RawQuestion>;
  const answer = String(raw?.answer ?? "").trim();
  const quote = String(raw?.proofQuote ?? "").trim();
  // A blank's stem is derived from its quote, so the quote is what must be there.
  const stem = type === "blank" ? quote : String(raw?.stem ?? "").trim();
  if (!stem) throw new Error(type === "blank" ? "the question came back with no sentence to blank out" : "the question came back with no stem");
  if (!answer) throw new Error("the question came back with no answer");

  if (type === "choice") {
    const options = cleanList(raw.options, 6);
    if (options.length !== 4) throw new Error("a multiple choice needs exactly four options");
    if (new Set(options.map(option => option.toLowerCase())).size !== 4) throw new Error("two options said the same thing");
    const index = Number(raw.answerIndex);
    if (!Number.isInteger(index) || index < 0 || index > 3) throw new Error("answerIndex must be 0, 1, 2 or 3");
    return { ...(raw as RawQuestion), stem, answer, options, answerIndex: index };
  }

  if (type === "blank") {
    // The stem is built by blanking the answer out of the quote, so an answer
    // that is not in the quote produces a question with no blank in it. Worth
    // rejecting rather than papering over: the retry reason is specific enough
    // for the model to fix on the second attempt.
    if (!quote.toLowerCase().includes(answer.toLowerCase())) {
      throw new Error(`the answer "${answer}" does not appear in the sentence you quoted`);
    }
    return { ...(raw as RawQuestion), stem, answer, proofQuote: quote };
  }

  if (type === "open") {
    const rubric = cleanList(raw.rubric, 4);
    if (rubric.length < 2) throw new Error("an open question needs at least two rubric points");
    return { ...(raw as RawQuestion), stem, answer, rubric };
  }

  return { ...(raw as RawQuestion), stem, answer };
}

/**
 * Blanks that came back without a blank in them.
 *
 * A small model quite often writes the sentence and forgets to remove the term.
 * Repairing it is better than retrying: the sentence and the answer are both
 * right, and only the elision is missing.
 */
function repairBlank(stem: string, answer: string): string {
  if (stem.includes("______")) return stem;
  const index = stem.toLowerCase().indexOf(answer.toLowerCase());
  if (index < 0) return `${stem} — the missing term is ______.`;
  return `${stem.slice(0, index)}______${stem.slice(index + answer.length)}`;
}

/* ── The generator ───────────────────────────────────────────────────── */

export interface LlmGeneratorOptions {
  cfg: LocalLLMConfig;
  /** Called when a single question could not be produced; the round goes on without it. */
  onQuestionFailure?: (type: RecallQuestionType, reason: string) => void;
}

export function createLlmGenerator(options: LlmGeneratorOptions): RoundGenerator {
  const { cfg } = options;

  return {
    async generate(input: GenerateRoundInput): Promise<Round> {
      const { chunk, config } = input;
      const anchor = input.anchor;

      const wanted = plannedMix(config);
      const order: RecallQuestionType[] = [];
      for (const type of ["choice", "blank", "open"] as RecallQuestionType[]) {
        for (let i = 0; i < wanted[type]; i++) order.push(type);
      }

      const neighbours = input.siblings
        .slice(0, 4)
        .map((sibling, i) => `Neighbour ${i + 1}: ${sibling.text.slice(0, 600)}`)
        .join("\n");

      const questions: Question[] = [];
      const used: string[] = [];
      let openSeen = 0;

      for (let i = 0; i < order.length; i++) {
        input.signal?.throwIfAborted();
        const type = order[i];
        const flavour = type === "open" ? OPEN_FLAVOURS[openSeen++ % OPEN_FLAVOURS.length] : "";

        const prompt = [
          `Passage:\n---\n${chunk.text}\n---`,
          "",
          anchor ? `What this passage establishes: ${anchor.summary}` : "",
          anchor?.points.length ? `Points worth testing:\n${anchor.points.map(point => `- ${point}`).join("\n")}` : "",
          anchor?.terms.length ? `Terms it relies on: ${anchor.terms.join(", ")}` : "",
          used.length ? `\nAlready asked about, do NOT repeat: ${used.join("; ")}` : "",
          type === "choice" && neighbours ? `\nNeighbouring passages, for wrong options only:\n${neighbours}` : "",
          "",
          TYPE_BRIEF[type],
          flavour ? `This one must be ${flavour}.` : "",
          "",
          "Choose the single most important thing left to test and name it in `target`.",
          type === "blank" ? "" :
            "In `proofQuote` put the SHORTEST exact fragment of the passage that proves " +
            "your answer — at most twenty words, copied character for character, with no " +
            "edits of any kind. Never put a blank or an ellipsis in it.",
        ].filter(Boolean).join("\n");

        try {
          const raw = await generateJson(cfg, {
            system: SYSTEM,
            schema: QUESTION_SCHEMAS[type],
            signal: input.signal,
            temperature: 0.35,
            numCtx: ROUND_NUM_CTX,
            // A question, four options and a quoted sentence fit comfortably.
            // Anything longer is a model that has stopped answering.
            // Four options is a lot of text; a blank is now one short sentence
            // and a word, because its stem is derived rather than written.
            numPredict: type === "choice" ? 700 : type === "open" ? 600 : 400,
            label: `recall: ${type} question`,
            validate: value => validateRaw(type, value),
            prompt,
          });

          used.push(raw.target || raw.stem.slice(0, 60));
          questions.push({
            id: `${chunk.id}#${i}`,
            type,
            // For a blank the stem is the quote with the answer removed, which
            // is what makes it verbatim from the passage by construction.
            stem: type === "blank" ? repairBlank(raw.proofQuote, raw.answer) : raw.stem,
            options: type === "choice" ? (raw.options as string[]) : undefined,
            answerIndex: type === "choice" ? Number(raw.answerIndex) : undefined,
            answer: raw.answer,
            rubric: type === "open" ? (raw.rubric as string[]) : undefined,
            explanation: raw.explanation,
            proof: proofFor(chunk.text, raw.proofQuote, raw.answer, chunk.start),
          });
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") throw error;
          // One failed question is not a failed round. The queue only skips a
          // passage when it can produce nothing at all.
          options.onQuestionFailure?.(type, error instanceof Error ? error.message : "unknown");
        }
      }

      if (!questions.length) throw new Error("The model could not build a question from this passage.");

      return {
        sourceId: chunk.sourceId,
        chunkId: chunk.id,
        chunkHash: chunk.id.slice(chunk.id.lastIndexOf(":") + 1),
        chunkIndex: chunk.index,
        excerpt: chunk.text,
        questions,
      };
    },

    async gradeOpen(input: GradeOpenInput): Promise<{ verdict: Verdict; note: string }> {
      const rubric = input.question.rubric ?? [];
      const value = await generateJson(cfg, {
        system:
          "You mark a study answer against a rubric. You are marking recall and " +
          "understanding, not writing. Wording, spelling and brevity do not matter; " +
          "whether the points are there does.",
        schema: {
          type: "object",
          properties: {
            verdict: { type: "string", enum: ["correct", "partial", "wrong"] },
            missing: boundedStrings(0, 4),
            note: { type: "string" },
          },
          required: ["verdict", "missing", "note"],
        },
        signal: input.signal,
        temperature: 0.1,
        numCtx: NUM_CTX_PASSAGE,
        numPredict: 300,
        label: "recall: grade open answer",
        validate: raw => {
          const parsed = raw as { verdict?: string };
          if (!["correct", "partial", "wrong"].includes(String(parsed?.verdict))) {
            throw new Error("the verdict was not one of correct, partial or wrong");
          }
          return raw as { verdict: Verdict; missing: string[]; note: string };
        },
        prompt: [
          `Question: ${input.question.stem}`,
          `Model answer: ${input.question.answer}`,
          rubric.length ? `Rubric — the points a correct answer contains:\n${rubric.map(point => `- ${point}`).join("\n")}` : "",
          "",
          `The answer given:\n---\n${input.answer}\n---`,
          "",
          "Which rubric points does the answer contain, and which are missing? " +
          "All of them is correct, some is partial, none is wrong. " +
          "In `note`, say in one sentence what was missing, addressed to the person who wrote it.",
        ].filter(Boolean).join("\n"),
      });

      const missing = cleanList(value.missing, 4);
      return {
        verdict: value.verdict,
        note: value.note?.trim() || (missing.length ? `Missing: ${missing.join("; ")}` : "Marked against the rubric."),
      };
    },
  };
}
