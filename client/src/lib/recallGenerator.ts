/**
 * A stand-in for the model, so the round loop can be built and judged first.
 *
 * Phase 2's question is entirely about rhythm: does read → hide → answer →
 * prove → next feel right, do the dials land where they should, does the
 * pipeline actually hide generation latency. None of that needs a model, and
 * waiting several seconds per round while finding out would make the answer
 * harder to see rather than easier.
 *
 * So this generator builds questions mechanically out of the passage — real
 * sentences, real offsets, real proof spans — and sleeps for a configurable
 * number of milliseconds first, imitating what a local model costs. Set the
 * latency to zero and the same generator becomes the fixture the tests run on.
 *
 * It is deliberately *not* good. Its distractors are neighbouring sentences and
 * its open questions are templates; the point is that every seam the real
 * generator will use — the schema of a `Round`, the proof span, the grading
 * call, the failure path — is exercised before the model arrives in phase 3,
 * where `createLlmGenerator` will implement this same interface and nothing in
 * the surface will change.
 */

import { plannedMix, type GenerateRoundInput, type GradeOpenInput, type Question, type Round, type RoundGenerator, type Verdict } from "@/lib/recallRound";
import type { RecallQuestionType } from "@/lib/academiaStore";
import type { Chunk } from "@/lib/textChunks";

export interface MockGeneratorOptions {
  /**
   * Imitated model latency per round.
   *
   * A local 3B writing three questions is a few seconds. Zero in tests, and a
   * realistic value in the app, because a pipeline that is never under load
   * proves nothing.
   */
  latencyMs?: number;
  rng?: () => number;
}

/** Seeded so a passage always produces the same round, which is what tests need. */
function seededRng(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5; state >>>= 0;
    return state / 0x100000000;
  };
}

function seedFrom(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

interface Sentence { text: string; start: number; end: number }

/** Sentences with their offsets, so a proof span can point at the real thing. */
function sentencesWithOffsets(text: string): Sentence[] {
  const out: Sentence[] = [];
  const pattern = /[^.!?\n]+[.!?]*/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const raw = match[0];
    const leading = raw.length - raw.trimStart().length;
    const body = raw.trim();
    if (body.length < 25) continue;
    out.push({ text: body, start: match.index + leading, end: match.index + leading + body.length });
  }
  return out;
}

const STOP = new Set([
  "about", "after", "again", "also", "because", "been", "being", "between", "could",
  "from", "have", "into", "more", "most", "other", "over", "should", "than", "that", "their",
  "there", "these", "they", "this", "through", "under", "using", "very", "was", "were", "what",
  "when", "where", "which", "while", "with", "would", "will", "each", "such", "then", "them",
]);

/** The most substantial word in a sentence — the one worth blanking out. */
function salientWord(sentence: string): string | null {
  const words = sentence.match(/[A-Za-z][A-Za-z'-]{4,}/g) ?? [];
  const candidates = words.filter(word => !STOP.has(word.toLowerCase()));
  if (!candidates.length) return null;
  return candidates.reduce((best, word) => (word.length > best.length ? word : best), candidates[0]);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(new DOMException("cancelled", "AbortError")); };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function siblingSentences(siblings: Chunk[], limit: number): string[] {
  const out: string[] = [];
  for (const sibling of siblings) {
    for (const sentence of sentencesWithOffsets(sibling.text)) {
      out.push(sentence.text);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export function createMockGenerator(options: MockGeneratorOptions = {}): RoundGenerator {
  const latency = options.latencyMs ?? 0;

  return {
    async generate(input: GenerateRoundInput): Promise<Round> {
      await sleep(latency, input.signal);

      const { chunk, config } = input;
      const rng = options.rng ?? seededRng(seedFrom(chunk.text));
      const sentences = sentencesWithOffsets(chunk.text);
      if (!sentences.length) throw new Error("This passage has no sentence long enough to ask about.");

      const wanted = plannedMix(config);
      const order: RecallQuestionType[] = [];
      for (const type of ["choice", "blank", "open"] as RecallQuestionType[]) {
        for (let i = 0; i < wanted[type]; i++) order.push(type);
      }

      // Distractors come from neighbouring passages: true statements about the
      // same material that do not answer this question. Plausibility by
      // construction rather than by instruction, which is how the real
      // generator will do it too.
      const distractorPool = siblingSentences(input.siblings, 12);

      const questions: Question[] = order.map((type, i) => {
        const sentence = sentences[i % sentences.length];
        const proof = { start: chunk.start + sentence.start, end: chunk.start + sentence.end, text: sentence.text, verified: true };
        const id = `${chunk.id}#${i}`;

        if (type === "choice") {
          const wrong = distractorPool.length >= 3
            ? distractorPool.slice(0, 3)
            : ["The passage does not address this.", "The opposite relationship is established.", "The effect is described as incidental."];
          const options = [sentence.text, ...wrong].slice(0, 4);
          const answerIndex = Math.floor(rng() * options.length);
          [options[0], options[answerIndex]] = [options[answerIndex], options[0]];
          return {
            id, type, stem: "Which statement does this passage make?",
            options, answerIndex, answer: sentence.text,
            explanation: "It is stated directly in the passage.", proof,
          };
        }

        if (type === "blank") {
          const word = salientWord(sentence.text);
          if (!word) {
            return {
              id, type: "open", stem: "What does this passage establish?",
              answer: sentence.text, rubric: [sentence.text.slice(0, 60)],
              explanation: "Compare against the passage.", proof,
            };
          }
          return {
            id, type, stem: sentence.text.replace(word, "______"),
            answer: word, explanation: `The passage uses the word "${word}".`, proof,
          };
        }

        const flavour = i % 3;
        const topic = salientWord(sentence.text) ?? "this";
        const stem = flavour === 0 ? `What is ${topic}, as this passage defines it?`
          : flavour === 1 ? `How does the passage say ${topic} works?`
          : `Why does ${topic} matter here?`;
        return {
          id, type: "open", stem,
          answer: sentence.text,
          rubric: (sentence.text.match(/[A-Za-z][A-Za-z'-]{4,}/g) ?? []).filter(w => !STOP.has(w.toLowerCase())).slice(0, 4),
          explanation: "Compare your answer against the passage.", proof,
        };
      });

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
      await sleep(Math.round(latency / 3), input.signal);
      const rubric = (input.question.rubric ?? []).map(point => point.toLowerCase());
      const given = input.answer.toLowerCase();
      if (!given.trim()) return { verdict: "missed", note: "Nothing was written." };
      const hit = rubric.filter(point => given.includes(point)).length;
      // Three bands against the rubric the question carries, which is what the
      // real grader will do — a comparison, not a fresh opinion.
      const verdict: Verdict = !rubric.length ? "partial" : hit >= Math.ceil(rubric.length * 0.6) ? "correct" : hit > 0 ? "partial" : "wrong";
      return {
        verdict,
        note: rubric.length ? `Matched ${hit} of ${rubric.length} points the passage makes.` : "No rubric for this question.",
      };
    },
  };
}
