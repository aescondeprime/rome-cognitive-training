/**
 * Tests for the model-written round.
 *
 * The model itself cannot be tested — its questions are a judgement call, made
 * by playing. What *can* be pinned is everything around it, and all of it is
 * the kind of thing that fails silently:
 *
 * - a proof quote that is not actually in the passage must never be presented
 *   as a citation;
 * - a multiple choice with three options, or two identical ones, must not reach
 *   the screen;
 * - one question the model refuses must not take the round down with it;
 * - a passage that was already read must not be analysed a second time.
 *
 * `fetch` is stubbed with a queue of responses, so each test says exactly what
 * the model returns and asserts what the generator does with it.
 *
 * Run with `npm run test:recall`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Chunk } from "../textChunks";
import { LLM_DEFAULTS } from "../localLLM";
import { RECALL_DEFAULTS, type PassageAnchor, type Question, type RecallConfig } from "../recallRound";
import { createLlmGenerator, locateQuote } from "../recallLlm";

const CFG = { ...LLM_DEFAULTS, model: "test-model" };

const PASSAGE =
  "Working memory holds information available for processing and is capacity limited. " +
  "The classic estimate is seven items, though later work put the figure nearer four. " +
  "Rehearsal refreshes the trace, which is why interference during the delay is so costly.";

const CHUNK: Chunk = { id: "src:1:abcd1234", sourceId: "src:1", index: 3, text: PASSAGE, start: 500, end: 500 + PASSAGE.length };

const ANCHOR: PassageAnchor = {
  summary: "Working memory is capacity limited and rehearsal maintains the trace.",
  points: ["the classic estimate is seven items", "interference during the delay is costly"],
  terms: ["working memory", "rehearsal"],
};

const ONE_OPEN: RecallConfig = { ...RECALL_DEFAULTS, questionsPerRound: 1, mixChoice: 0, mixBlank: 0, mixOpen: 1 };
const ONE_CHOICE: RecallConfig = { ...RECALL_DEFAULTS, questionsPerRound: 1, mixChoice: 1, mixBlank: 0, mixOpen: 0 };
const ONE_BLANK: RecallConfig = { ...RECALL_DEFAULTS, questionsPerRound: 1, mixChoice: 0, mixBlank: 1, mixOpen: 0 };

/** A queue of model replies; the last one repeats if the generator asks again. */
function stubModel(replies: unknown[]) {
  const bodies: any[] = [];
  const original = globalThis.fetch;
  let call = 0;
  globalThis.fetch = (async (_input: any, init: any) => {
    bodies.push(JSON.parse(init.body));
    const reply = replies[Math.min(call++, replies.length - 1)];
    return new Response(JSON.stringify({ message: { content: JSON.stringify(reply) } }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { bodies, get calls() { return call; }, restore: () => { globalThis.fetch = original; } };
}

const openReply = (overrides: Record<string, unknown> = {}) => ({
  target: "the capacity limit",
  stem: "How does rehearsal keep an item available, and why does interference cost so much?",
  answer: "Rehearsal refreshes the trace, so interference during the delay prevents refreshing.",
  rubric: ["rehearsal refreshes the trace", "interference during the delay is costly"],
  proofQuote: "Rehearsal refreshes the trace, which is why interference during the delay is so costly.",
  explanation: "Stated in the last sentence.",
  ...overrides,
});

/* ── Locating a quote ────────────────────────────────────────────────── */

test("a quote is found exactly, and the offsets point at it", () => {
  const quote = "The classic estimate is seven items";
  const located = locateQuote(PASSAGE, quote);
  assert.ok(located);
  assert.equal(PASSAGE.slice(located!.start, located!.end), quote);
});

test("a quote whose spacing was normalised is still found", () => {
  // A model copying a sentence out of extracted PDF text reliably collapses the
  // spacing, and that must not count as a fabrication.
  const spaced = "Working  memory   holds\ninformation available for processing";
  const located = locateQuote(spaced, "Working memory holds information available for processing");
  assert.ok(located, "collapsed whitespace must still match");
  assert.match(spaced.slice(located!.start, located!.end), /^Working/);
});

test("a quote the passage does not contain is not found", () => {
  assert.equal(locateQuote(PASSAGE, "Working memory has unlimited capacity."), null);
  assert.equal(locateQuote(PASSAGE, "short"), null, "a fragment is not evidence");
});

/* ── Proof ───────────────────────────────────────────────────────────── */

test("a verified proof carries offsets into the source, not into the passage", async () => {
  const stub = stubModel([openReply()]);
  const round = await createLlmGenerator({ cfg: CFG })
    .generate({ chunk: CHUNK, siblings: [], config: ONE_OPEN, anchor: ANCHOR });
  stub.restore();

  const proof = round.questions[0].proof!;
  assert.equal(proof.verified, true);
  // The chunk starts at 500 in the source; a proof span must be usable there.
  assert.ok(proof.start >= CHUNK.start && proof.end <= CHUNK.end);
  assert.ok(PASSAGE.includes(proof.text));
});

test("an invented quote is marked unverified and claims nothing", async () => {
  // The failure this whole mechanism exists to prevent: a plausible sentence,
  // presented as a citation, that the document never contained.
  const stub = stubModel([openReply({ proofQuote: "Working memory has unlimited capacity in trained adults." })]);
  const round = await createLlmGenerator({ cfg: CFG })
    .generate({ chunk: CHUNK, siblings: [], config: ONE_OPEN, anchor: ANCHOR });
  stub.restore();

  assert.equal(round.questions[0].proof!.verified, false);
});

/* ── Validation ──────────────────────────────────────────────────────── */

test("a multiple choice must have four distinct options and a real index", async () => {
  const failures: string[] = [];
  const stub = stubModel([{
    target: "capacity", stem: "Which statement does the passage support?",
    answer: "The classic estimate is seven items",
    options: ["The classic estimate is seven items", "the classic estimate is seven items", "Capacity is unlimited"],
    answerIndex: 0, proofQuote: "The classic estimate is seven items", explanation: "—",
  }]);

  const round = createLlmGenerator({ cfg: CFG, onQuestionFailure: (_type, reason) => failures.push(reason) })
    .generate({ chunk: CHUNK, siblings: [], config: ONE_CHOICE, anchor: ANCHOR });

  await assert.rejects(() => round, /could not build a question/);
  stub.restore();
  assert.ok(failures.some(reason => /four options/.test(reason)), `expected an option-count complaint, got ${failures.join(" | ")}`);
});

test("one refused question does not take the round down with it", async () => {
  // The queue only skips a passage when it can produce nothing at all.
  // A question gets three attempts now — strict, strict-with-reason, then the
  // simplified schema — so a question that truly cannot be built needs three
  // refusals before the round moves on to the next one.
  const bad = { target: "x", stem: "", answer: "", proofQuote: "", explanation: "" };
  const stub = stubModel([bad, bad, bad, openReply()]);

  const failures: string[] = [];
  const round = await createLlmGenerator({ cfg: CFG, onQuestionFailure: (_t, reason) => failures.push(reason) })
    .generate({ chunk: CHUNK, siblings: [], config: { ...RECALL_DEFAULTS, questionsPerRound: 2, mixChoice: 0, mixBlank: 1, mixOpen: 1 }, anchor: ANCHOR });
  stub.restore();

  assert.equal(round.questions.length, 1, "the survivable question survives");
  assert.ok(failures.length >= 1);
});

test("a blank does not write its own stem — it is built from the quote", async () => {
  // Asking for the stem *and* the quote was asking the model to copy the same
  // sentence twice, which on a bullet-list passage overran the token cap on
  // every attempt. It now returns the sentence once and the stem is derived,
  // which also makes the stem verbatim by construction.
  const stub = stubModel([{
    target: "rehearsal", answer: "Rehearsal",
    proofQuote: "Rehearsal refreshes the trace", explanation: "—",
  }]);
  const round = await createLlmGenerator({ cfg: CFG })
    .generate({ chunk: CHUNK, siblings: [], config: ONE_BLANK, anchor: ANCHOR });
  const schema = stub.bodies[0].format;
  stub.restore();

  assert.equal(schema.properties.stem, undefined, "the model must not be asked for a stem it should not write");
  assert.ok(!schema.required.includes("stem"));

  const question: Question = round.questions[0];
  assert.equal(question.stem, "______ refreshes the trace");
  assert.equal(question.answer, "Rehearsal");
  assert.equal(question.proof!.verified, true, "the sentence it was built from is the citation");
});

test("a blank whose answer is not in its own quote is rejected, not papered over", async () => {
  const good = { target: "rehearsal", answer: "Rehearsal", proofQuote: "Rehearsal refreshes the trace", explanation: "—" };
  const bad = { target: "x", answer: "consolidation", proofQuote: "Rehearsal refreshes the trace", explanation: "—" };
  const stub = stubModel([bad, good]);
  const round = await createLlmGenerator({ cfg: CFG })
    .generate({ chunk: CHUNK, siblings: [], config: ONE_BLANK, anchor: ANCHOR });
  const retry = stub.bodies[1].messages.map((m: any) => m.content).join("\n");
  stub.restore();

  assert.match(retry, /does not appear in the sentence you quoted/, "the retry must say what was wrong");
  assert.ok(round.questions[0].stem.includes("______"));
});

test("an answer cut off by the cap is retried with more room and a plainer instruction", async () => {
  const original = globalThis.fetch;
  const bodies: any[] = [];
  let call = 0;
  globalThis.fetch = (async (_input: any, init: any) => {
    bodies.push(JSON.parse(init.body));
    call++;
    const cutOff = call === 1;
    return new Response(JSON.stringify({
      message: { content: cutOff ? '{ "target": "t", "answer": "Rehearsal", "proofQuote": "Rehearsal refreshes the tr' : JSON.stringify({ target: "t", answer: "Rehearsal", proofQuote: "Rehearsal refreshes the trace", explanation: "—" }) },
      done_reason: cutOff ? "length" : "stop",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  const round = await createLlmGenerator({ cfg: CFG })
    .generate({ chunk: CHUNK, siblings: [], config: ONE_BLANK, anchor: ANCHOR });
  globalThis.fetch = original;

  assert.equal(round.questions.length, 1);
  assert.ok(bodies[1].options.num_predict > bodies[0].options.num_predict, "the second attempt gets more room");
  const retry = bodies[1].messages.map((m: any) => m.content).join("\n");
  assert.match(retry, /quarter of the words/, "and is told to be shorter, not diagnosed at");
});

/* ── Anchoring ───────────────────────────────────────────────────────── */

test("a digest anchors the question, and costs no extra call", async () => {
  const stub = stubModel([openReply()]);
  await createLlmGenerator({ cfg: CFG }).generate({ chunk: CHUNK, siblings: [], config: ONE_OPEN, anchor: ANCHOR });
  const prompt = stub.bodies[0].messages.map((m: any) => m.content).join("\n");
  stub.restore();

  assert.equal(stub.calls, 1, "one question, one call");
  assert.ok(prompt.includes(ANCHOR.summary), "what the passage establishes reaches the question");
  assert.ok(prompt.includes("the classic estimate is seven items"), "and so do the points worth testing");
});

test("a passage with no digest costs one call, not two", async () => {
  // There used to be a separate analysis call for unread passages. It was the
  // slowest call in a round, it is what hit the five-minute timeout, and it
  // took the whole round with it when it failed — for a benefit the question
  // prompt already has, since it is handed the passage itself.
  const stub = stubModel([openReply()]);
  const round = await createLlmGenerator({ cfg: CFG }).generate({ chunk: CHUNK, siblings: [], config: ONE_OPEN });
  const prompt = stub.bodies[0].messages.map((m: any) => m.content).join("\n");
  stub.restore();

  assert.equal(stub.calls, 1, "no analysis call");
  assert.equal(round.questions.length, 1, "and a question still comes out");
  assert.ok(prompt.includes(PASSAGE), "the passage itself is what the model works from");
});

test("distractors are given neighbouring passages to draw on", async () => {
  const sibling: Chunk = { id: "src:1:beef", sourceId: "src:1", index: 4, text: "Long-term memory has no comparable capacity limit.", start: 0, end: 50 };
  const stub = stubModel([{
    target: "capacity", stem: "Which does the passage support?",
    answer: "The classic estimate is seven items",
    options: ["The classic estimate is seven items", "Long-term memory has no comparable capacity limit.", "Rehearsal is unnecessary", "Interference is harmless"],
    answerIndex: 0, proofQuote: "The classic estimate is seven items", explanation: "—",
  }]);
  await createLlmGenerator({ cfg: CFG }).generate({ chunk: CHUNK, siblings: [sibling], config: ONE_CHOICE, anchor: ANCHOR });
  stub.restore();

  const prompt = stub.bodies[0].messages.map((m: any) => m.content).join("\n");
  assert.ok(prompt.includes("Long-term memory has no comparable capacity limit."), "plausibility by construction");
  assert.ok(/wrong options only/i.test(prompt), "and only for wrong options");
});

/* ── Grading ─────────────────────────────────────────────────────────── */

test("an open answer is marked against the rubric, in three bands", async () => {
  const question: Question = {
    id: "q", type: "open", stem: "Why is interference costly?",
    answer: "Because rehearsal refreshes the trace.",
    rubric: ["rehearsal refreshes the trace", "interference prevents refreshing"],
    explanation: "", proof: null,
  };

  let stub = stubModel([{ verdict: "partial", missing: ["interference prevents refreshing"], note: "You had the mechanism but not the cost." }]);
  const partial = await createLlmGenerator({ cfg: CFG }).gradeOpen({ question, answer: "rehearsal keeps it alive" });
  stub.restore();
  assert.equal(partial.verdict, "partial");
  assert.match(partial.note, /mechanism/);

  stub = stubModel([{ verdict: "correct", missing: [], note: "" }]);
  const correct = await createLlmGenerator({ cfg: CFG }).gradeOpen({ question, answer: "rehearsal refreshes it and interference stops that" });
  stub.restore();
  assert.equal(correct.verdict, "correct");
  assert.ok(correct.note.length > 0, "an empty note still needs to say something");
});

test("a verdict outside the three bands is rejected rather than shown", async () => {
  const question: Question = { id: "q", type: "open", stem: "?", answer: "", rubric: ["a"], explanation: "", proof: null };
  const stub = stubModel([{ verdict: "excellent", missing: [], note: "" }]);
  await assert.rejects(
    () => createLlmGenerator({ cfg: CFG }).gradeOpen({ question, answer: "something" }),
    /verdict/,
  );
  stub.restore();
});

/* ── The schema asks for what it needs ───────────────────────────────── */

test("a multiple choice REQUIRES its options — the bug that made it always fail", () => {
  // One schema served all three types, so `options` could not be in `required`
  // (a blank has none). The grammar therefore permitted omitting them, the
  // model obligingly did, and the validator rejected every multiple choice for
  // having no options. Three attempts, every time, guaranteed.
  const stub = stubModel([{
    target: "t", stem: "Which?", answer: "a",
    options: ["a", "b", "c", "d"], answerIndex: 0,
    proofQuote: "The classic estimate is seven items", explanation: "—",
  }]);
  void createLlmGenerator({ cfg: CFG }).generate({ chunk: CHUNK, siblings: [], config: ONE_CHOICE, anchor: ANCHOR })
    .then(() => {}, () => {});
  return new Promise(resolve => setTimeout(resolve, 20)).then(() => {
    const schema = stub.bodies[0].format;
    stub.restore();
    assert.ok(schema.required.includes("options"), "a choice must be unable to come back without options");
    assert.ok(schema.required.includes("answerIndex"));
  });
});

test("a blank's schema does not mention options at all", async () => {
  const stub = stubModel([{ target: "t", answer: "rehearsal", proofQuote: "Rehearsal refreshes the trace", explanation: "—" }]);
  await createLlmGenerator({ cfg: CFG }).generate({ chunk: CHUNK, siblings: [], config: ONE_BLANK, anchor: ANCHOR });
  const schema = stub.bodies[0].format;
  stub.restore();

  // Absent, not optional. Constrained decoding can only produce what the
  // grammar allows, so a property that does not apply must not be there.
  assert.equal(schema.properties.options, undefined);
  assert.equal(schema.properties.answerIndex, undefined);
  assert.ok(!schema.required.includes("options"));
});

test("an open question requires its rubric, since grading is a comparison against it", async () => {
  const stub = stubModel([openReply()]);
  await createLlmGenerator({ cfg: CFG }).generate({ chunk: CHUNK, siblings: [], config: ONE_OPEN, anchor: ANCHOR });
  const schema = stub.bodies[0].format;
  stub.restore();
  assert.ok(schema.required.includes("rubric"));
});

/* ── Proof, when the quote does not match ────────────────────────────── */

test("an edited quote still cites, by finding the answer where it actually sits", async () => {
  // The commonest way a quote fails to match is the model editing it on the way
  // out — copying its own blanked stem back, tidying a bullet, adding an
  // ellipsis. The answer is still in the passage, and finding it there is a
  // real citation rather than a guess.
  // Asked as an open question: a blank now derives its stem from its quote and
  // rejects an answer that is not in it, so an edited quote can only reach the
  // proof logic on a type that quotes independently of its answer.
  const stub = stubModel([{
    target: "the estimate", stem: "How many items is the classic estimate?", answer: "seven",
    rubric: ["seven items", "later work said four"],
    proofQuote: "The classic estimate is … items", explanation: "—",
  }]);
  const round = await createLlmGenerator({ cfg: CFG })
    .generate({ chunk: CHUNK, siblings: [], config: ONE_OPEN, anchor: ANCHOR });
  stub.restore();

  const proof = round.questions[0].proof!;
  assert.equal(proof.verified, true, "the answer is in the passage even though the quote was edited");
  assert.ok(PASSAGE.includes(proof.text), "and what is shown is the passage's own words");
  assert.ok(proof.text.toLowerCase().includes("seven"));
});

test("an answer that is nowhere in the passage still claims nothing", async () => {
  const stub = stubModel([{
    target: "x", stem: "What is the capacity?", answer: "unlimited capacity",
    rubric: ["capacity is unlimited", "no limit applies"],
    proofQuote: "Working memory is unlimited", explanation: "—",
  }]);
  const round = await createLlmGenerator({ cfg: CFG })
    .generate({ chunk: CHUNK, siblings: [], config: ONE_OPEN, anchor: ANCHOR });
  stub.restore();
  assert.equal(round.questions[0].proof!.verified, false);
});

test("evidence in a bullet list stops at the bullet, not at the next full stop", async () => {
  // Study PDFs are full of slide-style lists where a full stop never arrives,
  // so bullets and newlines have to count as boundaries.
  const bullets = "Management of Hypertension • Take medication as prescribed • Monitor BP regularly • Stop smoking";
  const chunk: Chunk = { id: "src:2:beef", sourceId: "src:2", index: 0, text: bullets, start: 0, end: bullets.length };
  const stub = stubModel([{
    target: "monitoring", stem: "What should be monitored regularly?", answer: "BP",
    rubric: ["monitor blood pressure", "regularly"],
    proofQuote: "no such text anywhere", explanation: "—",
  }]);
  const round = await createLlmGenerator({ cfg: CFG })
    .generate({ chunk, siblings: [], config: ONE_OPEN, anchor: ANCHOR });
  stub.restore();

  const proof = round.questions[0].proof!;
  assert.equal(proof.verified, true);
  assert.ok(!proof.text.includes("Stop smoking"), `the span ran past the bullet: ${proof.text}`);
  assert.ok(proof.text.includes("Monitor BP regularly"));
});

/* ── Bounded output ──────────────────────────────────────────────────── */

test("every array the model may emit is bounded", async () => {
  // Under constrained decoding an unbounded array is a grammar that permits
  // another element forever, and a small model takes it: it emits option after
  // option, never closes the bracket, and runs to the context limit. That is
  // how a 3B ends up slower than a 7B — the larger model knew when to stop.
  const stub = stubModel([openReply()]);
  await createLlmGenerator({ cfg: CFG }).generate({ chunk: CHUNK, siblings: [], config: ONE_OPEN, anchor: ANCHOR });
  stub.restore();

  const body = stub.bodies[0];
  const walk = (node: any, path: string): void => {
    if (!node || typeof node !== "object") return;
    if (node.type === "array") {
      assert.ok(Number.isInteger(node.maxItems), `${path} is an unbounded array`);
    }
    for (const [key, child] of Object.entries(node)) walk(child, `${path}.${key}`);
  };
  walk(body.format, "schema");

  assert.ok(body.options.num_predict > 0, "a runaway generation must end as a retry, not a hang");
  assert.ok(body.options.num_predict <= 1024, "and the cap must be tight enough to matter");
});
