/**
 * Deterministic tests for the Quantum Recall machine.
 *
 * Phase 2 exists to answer "does the rhythm work", which is judged by playing.
 * Everything underneath the rhythm is not: whether the scheduler actually walks
 * the document, whether coverage means what it was decided to mean, and whether
 * the next round is genuinely being written while you answer this one are all
 * properties that look fine on screen while being wrong.
 *
 * The pipeline test is the important one. If `next()` did not prime ahead, the
 * surface would still work — it would simply stall for the model's latency in
 * the middle of every round, which is exactly the failure that is easy to ship
 * and hard to notice while the generator is a mock.
 *
 * Run with `npm run test:recall`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SourceLedger } from "../academiaStore";
import { chunkSource, type Chunk } from "../textChunks";
import {
  chunkState, coverageOf, emptyLedger, entryFor, hashOf, pickNextChunk,
  pruneLedger, recordRound, typeBreakdown,
} from "../recallLedger";
import {
  gradeObjective, mixWeights, normalizeBlank, plannedMix, RECALL_DEFAULTS,
  RoundQueue, secondsToAnswer, secondsToRead, type Question, type RecallConfig,
  type Round, type RoundGenerator,
} from "../recallRound";
import { createMockGenerator } from "../recallGenerator";

/* ── Fixtures ────────────────────────────────────────────────────────── */

const DOC = Array.from({ length: 12 }, (_, i) =>
  `Passage ${i + 1} introduces a mechanism called stabiliser${i} and explains that it constrains the system in a measurable way. ` +
  `The effect was recorded at ${i * 4 + 11} units across every trial reported here, which the authors treat as decisive.`
).join(" ");

const CHUNKS: Chunk[] = chunkSource("src:1", DOC, { targetChars: 260 });
const CFG: RecallConfig = { ...RECALL_DEFAULTS };

function freshLedger(): SourceLedger {
  return emptyLedger("src:1", 1, 260, 1);
}

/** A round in which every question of the given types was answered correctly. */
function cleanOutcomes(types: Array<"choice" | "blank" | "open">) {
  return types.map(type => ({ type, correct: true } as const));
}

/* ── Coverage ────────────────────────────────────────────────────────── */

test("the fixture chunks into enough passages to schedule over", () => {
  assert.ok(CHUNKS.length >= 6, `expected several chunks, got ${CHUNKS.length}`);
});

test("coverage counts passages presented, not passages mastered", () => {
  // The decision, restated as a test: a passage you saw and got wrong is
  // covered. Anything else turns a forty-page PDF into a session with no end.
  let ledger = freshLedger();
  assert.equal(coverageOf(CHUNKS, ledger).fraction, 0);

  ledger = recordRound(ledger, CHUNKS[0], [{ type: "choice", correct: false }]);
  const coverage = coverageOf(CHUNKS, ledger);
  assert.equal(coverage.seen, 1);
  assert.equal(coverage.consolidated, 0);
  assert.ok(coverage.fraction > 0 && coverage.masteryFraction === 0);
});

test("consolidation needs accuracy and separate rounds, not one good minute", () => {
  let ledger = freshLedger();
  ledger = recordRound(ledger, CHUNKS[0], cleanOutcomes(["choice", "blank", "open"]));
  assert.equal(chunkState(entryFor(ledger, CHUNKS[0])), "weak", "one clean round is not knowledge");

  ledger = recordRound(ledger, CHUNKS[0], cleanOutcomes(["choice", "blank"]));
  assert.equal(chunkState(entryFor(ledger, CHUNKS[0])), "consolidated");
});

test("a single miss stops consolidation without erasing what came before", () => {
  let ledger = freshLedger();
  ledger = recordRound(ledger, CHUNKS[0], cleanOutcomes(["choice", "blank", "open"]));
  ledger = recordRound(ledger, CHUNKS[0], [{ type: "open", correct: false }]);
  const entry = entryFor(ledger, CHUNKS[0]);
  assert.equal(entry.cleanRounds, 1, "the earlier clean round survives");
  assert.equal(chunkState(entry), "weak");
});

test("tallies stay split by question type", () => {
  // Recognising a passage in a multiple choice while being unable to produce it
  // from a blank is the finding a pooled accuracy number cannot show.
  let ledger = freshLedger();
  ledger = recordRound(ledger, CHUNKS[0], [
    { type: "choice", correct: true },
    { type: "blank", correct: false },
  ]);
  const breakdown = typeBreakdown(ledger);
  assert.deepEqual(breakdown.choice, { asked: 1, correct: 1 });
  assert.deepEqual(breakdown.blank, { asked: 1, correct: 0 });
  assert.deepEqual(breakdown.open, { asked: 0, correct: 0 });
});

/* ── Scheduling ──────────────────────────────────────────────────────── */

test("a first pass walks the document in order and covers all of it", () => {
  // reviewRatio 0 is the pure first pass, and it must reach the last passage.
  let ledger = freshLedger();
  const order: number[] = [];
  let lastHash: string | undefined;

  for (let i = 0; i < CHUNKS.length; i++) {
    const chunk = pickNextChunk(CHUNKS, ledger, { reviewRatio: 0, rng: () => 0.99, lastHash });
    assert.ok(chunk, "the scheduler must always have something to show");
    order.push(chunk!.index);
    lastHash = hashOf(chunk!);
    ledger = recordRound(ledger, chunk!, [{ type: "choice", correct: false }]);
  }

  assert.deepEqual(order, CHUNKS.map(c => c.index), "unseen material is served in document order");
  assert.equal(coverageOf(CHUNKS, ledger).fraction, 1, "the promise is that it eventually covers everything");
});

test("review draws on what is weak, and never stalls on the passage just answered", () => {
  let ledger = freshLedger();
  ledger = recordRound(ledger, CHUNKS[0], [{ type: "choice", correct: false }]);
  ledger = recordRound(ledger, CHUNKS[1], [{ type: "choice", correct: false }]);

  // rng below the ratio asks for review rather than advancing.
  const reviewed = pickNextChunk(CHUNKS, ledger, { reviewRatio: 1, rng: () => 0, lastHash: hashOf(CHUNKS[1]) });
  assert.ok(reviewed);
  assert.equal(reviewed!.index, CHUNKS[0].index, "least recently seen first, and not the one just answered");
});

test("with nothing seen yet, a review request advances instead of failing", () => {
  const chunk = pickNextChunk(CHUNKS, freshLedger(), { reviewRatio: 1, rng: () => 0 });
  assert.ok(chunk, "an empty review pool must fall through to unseen material");
  assert.equal(chunk!.index, 0);
});

test("a fully covered document becomes pure review rather than ending", () => {
  let ledger = freshLedger();
  for (const chunk of CHUNKS) ledger = recordRound(ledger, chunk, [{ type: "choice", correct: true }]);
  const chunk = pickNextChunk(CHUNKS, ledger, { reviewRatio: 0, rng: () => 0.99 });
  assert.ok(chunk, "coverage complete is not the same as nothing to do");
});

test("editing a source drops only the passages that changed", () => {
  let ledger = freshLedger();
  for (const chunk of CHUNKS) ledger = recordRound(ledger, chunk, [{ type: "choice", correct: true }]);

  const edited = chunkSource("src:1", `${DOC} A closing sentence appended at the very end of the document.`, { targetChars: 260 });
  const pruned = pruneLedger(ledger, edited);
  const kept = Object.keys(pruned.entries).length;
  assert.ok(kept >= CHUNKS.length - 2, `most history should survive an append, kept ${kept} of ${CHUNKS.length}`);
});

/* ── Timing and mix ──────────────────────────────────────────────────── */

test("reading time follows length, within the floor and ceiling", () => {
  const short = "One short line.";
  // 600 words at 22s per hundred is 132s, comfortably past the ceiling.
  const long = Array.from({ length: 600 }, () => "word").join(" ");
  assert.equal(secondsToRead(short, CFG), CFG.readSecondsMin, "a fragment still gets the floor");
  assert.equal(secondsToRead(long, CFG), CFG.readSecondsMax, "a wall of text is capped");

  const medium = Array.from({ length: 100 }, () => "word").join(" ");
  assert.equal(secondsToRead(medium, CFG), CFG.readSecondsPer100Words);
});

test("an open answer gets more clock than a multiple choice", () => {
  assert.ok(secondsToAnswer("open", CFG) > secondsToAnswer("blank", CFG));
  assert.ok(secondsToAnswer("blank", CFG) > secondsToAnswer("choice", CFG));
});

test("equal weights across three questions is one of each", () => {
  assert.deepEqual(plannedMix({ ...CFG, questionsPerRound: 3 }), { choice: 1, blank: 1, open: 1 });
});

test("the mix sliders are relative weights, and zeroing two is allowed", () => {
  const onlyBlanks = { ...CFG, questionsPerRound: 4, mixChoice: 0, mixOpen: 0, mixBlank: 1 };
  assert.deepEqual(plannedMix(onlyBlanks), { choice: 0, blank: 4, open: 0 });
  assert.deepEqual(mixWeights({ ...CFG, mixChoice: 0, mixBlank: 0, mixOpen: 0 }), { choice: 1 / 3, blank: 1 / 3, open: 1 / 3 });
});

/* ── Grading ─────────────────────────────────────────────────────────── */

const blankQuestion: Question = {
  id: "q", type: "blank", stem: "The ______ constrains the system.",
  answer: "stabiliser", explanation: "", proof: null,
};

test("a blank is graded on what it claims, not on how it was typed", () => {
  assert.equal(gradeObjective(blankQuestion, { value: "  Stabiliser. ", elapsedMs: 0, expired: false }), "correct");
  assert.equal(gradeObjective(blankQuestion, { value: "the stabiliser", elapsedMs: 0, expired: false }), "correct");
  assert.equal(gradeObjective(blankQuestion, { value: "governor", elapsedMs: 0, expired: false }), "wrong");
  assert.equal(normalizeBlank("The Anglo-Saxon corpus!"), "anglo-saxon corpus");
});

test("running out of time is missed, which is not the same as wrong", () => {
  // PASAT already draws this line, and over a long session the two readings
  // diverge a lot: wrong is a belief, missed is a clock.
  assert.equal(gradeObjective(blankQuestion, { value: null, elapsedMs: 0, expired: true }), "missed");
  assert.equal(gradeObjective(blankQuestion, { value: "governor", elapsedMs: 0, expired: false }), "wrong");
});

test("a choice is graded against its index", () => {
  const q: Question = { id: "c", type: "choice", stem: "?", options: ["a", "b", "c", "d"], answerIndex: 2, answer: "c", explanation: "", proof: null };
  assert.equal(gradeObjective(q, { value: 2, elapsedMs: 0, expired: false }), "correct");
  assert.equal(gradeObjective(q, { value: 0, elapsedMs: 0, expired: false }), "wrong");
});

/* ── The mock generator ──────────────────────────────────────────────── */

test("the mock builds the asked-for mix, with verified proof spans", async () => {
  const generator = createMockGenerator({ latencyMs: 0 });
  const round = await generator.generate({ chunk: CHUNKS[0], siblings: CHUNKS.slice(1, 4), config: CFG });

  assert.equal(round.questions.length, CFG.questionsPerRound);
  assert.equal(round.chunkHash, hashOf(CHUNKS[0]));
  for (const question of round.questions) {
    assert.ok(question.stem.trim().length > 0);
    assert.ok(question.proof, "every question must be able to show its evidence");
    // The proof offsets are into the source, and the text must really be there.
    assert.ok(CHUNKS[0].text.includes(question.proof!.text));
    if (question.type === "choice") {
      assert.equal(question.options?.length, 4);
      assert.equal(new Set(question.options).size, 4, "duplicate options give the answer away");
      assert.equal(question.options![question.answerIndex!], question.answer);
    }
  }
});

test("distractors come from neighbouring passages, not from invention", async () => {
  const generator = createMockGenerator({ latencyMs: 0 });
  const round = await generator.generate({ chunk: CHUNKS[0], siblings: CHUNKS.slice(1, 4), config: { ...CFG, questionsPerRound: 1, mixBlank: 0, mixOpen: 0, mixChoice: 1 } });
  const choice = round.questions[0];
  const wrong = choice.options!.filter((_, i) => i !== choice.answerIndex);
  const neighbourText = CHUNKS.slice(1, 4).map(c => c.text).join(" ");
  assert.ok(wrong.some(option => neighbourText.includes(option)), "plausibility by construction");
});

test("the same passage always produces the same round", async () => {
  const a = await createMockGenerator({ latencyMs: 0 }).generate({ chunk: CHUNKS[2], siblings: CHUNKS.slice(0, 2), config: CFG });
  const b = await createMockGenerator({ latencyMs: 0 }).generate({ chunk: CHUNKS[2], siblings: CHUNKS.slice(0, 2), config: CFG });
  assert.deepEqual(a, b, "a fixture that drifts is not a fixture");
});

/* ── The pipeline ────────────────────────────────────────────────────── */

function countingGenerator(delayMs = 0): RoundGenerator & { calls: number } {
  const inner = createMockGenerator({ latencyMs: delayMs });
  const wrapper = {
    calls: 0,
    async generate(input: Parameters<RoundGenerator["generate"]>[0]): Promise<Round> {
      wrapper.calls++;
      return inner.generate(input);
    },
    gradeOpen: inner.gradeOpen,
  };
  return wrapper;
}

test("the round after this one is already being written", async () => {
  // The whole reason the queue exists. Without it the surface still works and
  // simply stalls for the model's latency in the middle of every round — easy
  // to ship, and invisible while the generator is instant.
  const generator = countingGenerator();
  let cursor = 0;
  const queue = new RoundQueue({
    generator,
    pick: () => CHUNKS[cursor++ % CHUNKS.length],
    siblings: chunk => CHUNKS.filter(other => other.index !== chunk.index).slice(0, 3),
    config: CFG,
  });

  const pending = queue.next();
  assert.ok(pending, "a round must be available");
  // The passage arrives synchronously; only the questions are awaited.
  assert.ok(pending!.chunk.text.length > 0, "the passage is known before the questions are");
  const first = await pending!.round;
  assert.ok(first.questions.length > 0);
  assert.ok(queue.isPrimed, "the following round must be in flight before this one is handed over");
  // Production is chained off the previous generation, so the next call starts
  // a tick after the one before it resolves. The slot exists immediately; the
  // generation it holds begins moments later.
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(generator.calls >= 2, "one round returned, one already being built");

  const second = await queue.next()!.round;
  assert.notEqual(second.chunkHash, first.chunkHash);
});

test("the passage is handed over before a single token is generated", async () => {
  // The point of the split: the scheduler's pick costs nothing and the
  // questions cost the model, so waiting for both meant staring at a loading
  // screen for the slow half while the fast half sat ready.
  let generated = false;
  const inner = createMockGenerator({ latencyMs: 30 });
  const queue = new RoundQueue({
    generator: {
      async generate(input) { generated = true; return inner.generate(input); },
      gradeOpen: inner.gradeOpen,
    },
    depth: 1,
    pick: () => CHUNKS[0],
    siblings: () => CHUNKS.slice(1, 4),
    config: CFG,
  });

  const pending = queue.next();
  assert.ok(pending);
  assert.equal(generated, false, "next() must not wait on the model");
  assert.equal(pending!.chunk.id, CHUNKS[0].id);
  assert.equal(pending!.settled(), false);
  await pending!.round;
  assert.equal(pending!.settled(), true);
});

test("a passage that cannot make a round is skipped, not sat on", async () => {
  const empty: Chunk = { id: "src:1:dead", sourceId: "src:1", index: 99, text: "...", start: 0, end: 3 };
  const picks = [empty, CHUNKS[0]];
  let i = 0;
  const queue = new RoundQueue({
    generator: createMockGenerator({ latencyMs: 0 }),
    pick: () => picks[Math.min(i++, picks.length - 1)],
    siblings: () => CHUNKS.slice(1, 4),
    config: CFG,
  });

  // The first slot took the dead passage; the second took a real one, and the
  // passage is known synchronously either way.
  await assert.rejects(() => queue.next()!.round, /no sentence long enough/);
  const round = await queue.next()!.round;
  assert.equal(round.chunkHash, hashOf(CHUNKS[0]), "the next passage still produces a round");
});

test("a deeper buffer writes ahead without running two calls at once", async () => {
  // Depth is what makes BEGIN instant and covers a round that costs several
  // model calls. Production stays serial: two concurrent generations would
  // contend for the same model and finish no sooner.
  let concurrent = 0;
  let peak = 0;
  const inner = createMockGenerator({ latencyMs: 5 });
  const generator: RoundGenerator = {
    async generate(input) {
      concurrent++;
      peak = Math.max(peak, concurrent);
      try { return await inner.generate(input); } finally { concurrent--; }
    },
    gradeOpen: inner.gradeOpen,
  };

  let cursor = 0;
  const queue = new RoundQueue({
    generator,
    depth: 3,
    pick: () => CHUNKS[cursor++ % CHUNKS.length],
    siblings: () => CHUNKS.slice(0, 3),
    config: CFG,
  });

  queue.prime();
  const first = await queue.next()!.round;
  assert.ok(first.questions.length > 0);
  assert.equal(peak, 1, "production must stay serial however deep the buffer is");

  // Whatever was written ahead is handed over without another wait.
  const second = await queue.next()!.round;
  assert.notEqual(second.chunkHash, first.chunkHash);
});

test("priming before the session means the first round is already waiting", async () => {
  const generator = countingGenerator();
  let cursor = 0;
  const queue = new RoundQueue({
    generator,
    depth: 2,
    pick: () => CHUNKS[cursor++ % CHUNKS.length],
    siblings: () => [],
    config: CFG,
  });

  queue.prime();
  assert.ok(queue.isPrimed, "priming starts work before anyone asks for a round");
  await queue.next()!.round;
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(generator.calls >= 2, "the buffer refills behind the round it handed over");
});

test("one unbuildable passage does not stall the rounds queued behind it", async () => {
  // The production chain must survive a rejection, or a single bad passage
  // would block every round buffered after it.
  const dead: Chunk = { id: "src:1:dead", sourceId: "src:1", index: 99, text: "...", start: 0, end: 3 };
  // The first buffered slot draws the dead passage; the second draws a real
  // one, and must still be there when the first is asked for and fails.
  const picks: Chunk[] = [dead, CHUNKS[0], CHUNKS[1]];
  let i = 0;
  const queue = new RoundQueue({
    generator: createMockGenerator({ latencyMs: 0 }),
    depth: 2,
    attempts: 1,
    pick: () => picks[Math.min(i++, picks.length - 1)],
    siblings: () => CHUNKS.slice(2, 5),
    config: CFG,
  });

  queue.prime();
  await assert.rejects(() => queue.next()!.round, /no sentence long enough/);
  const recovered = await queue.next()!.round;
  assert.ok(recovered.questions.length > 0, "the queue keeps going after a failed slot");
});

test("cancelling stops the queue rather than leaving work in flight", async () => {
  const queue = new RoundQueue({
    generator: createMockGenerator({ latencyMs: 0 }),
    pick: () => CHUNKS[0],
    siblings: () => [],
    config: CFG,
  });
  await queue.next()!.round;
  queue.cancel();
  assert.equal(queue.isPrimed, false);
  assert.equal(queue.next(), null, "a cancelled queue hands over nothing");
});

test("open answers are graded against the rubric the question carries", async () => {
  const generator = createMockGenerator({ latencyMs: 0 });
  const question: Question = {
    id: "o", type: "open", stem: "Why does it matter?",
    answer: "because the stabiliser constrains the system",
    rubric: ["stabiliser", "constrains"], explanation: "", proof: null,
  };
  assert.equal((await generator.gradeOpen({ question, answer: "the stabiliser constrains it" })).verdict, "correct");
  assert.equal((await generator.gradeOpen({ question, answer: "the stabiliser does something" })).verdict, "partial");
  assert.equal((await generator.gradeOpen({ question, answer: "no idea" })).verdict, "wrong");
  assert.equal((await generator.gradeOpen({ question, answer: "  " })).verdict, "missed");
});
