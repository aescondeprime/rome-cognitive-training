/**
 * Tests for the Flashcard Archive's shaping rules.
 *
 * The store is ROME's existing `recall_items`, so persistence and scheduling
 * are already covered by what was there. What is new is the shaping: what a
 * question becomes as a card, whether the same question can land twice, and how
 * folders fall out of the `category` column.
 *
 * The duplicate rule is the one that matters most. Cards written from Quantum
 * Recall are written from *rounds*, and a passage comes round again — an archive
 * that quietly accumulated the same question three times would make the drills
 * reading it worse rather than better.
 *
 * Run with `npm run test:recall`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alreadyArchived, archivableFrom, cardFromQuestion, cardTags, DEFAULT_FOLDER,
  foldersOf, isDue, type Flashcard,
} from "../flashcards";
import type { Graded, Question, Round } from "../recallRound";

const ROUND: Round = {
  sourceId: "src:1", chunkId: "src:1:abcd", chunkHash: "abcd", chunkIndex: 4,
  excerpt: "Rehearsal refreshes the trace, which is why interference is costly.",
  questions: [],
};

function question(over: Partial<Question> = {}): Question {
  return {
    id: "q1", type: "blank", stem: "______ refreshes the trace",
    answer: "Rehearsal", explanation: "",
    proof: { start: 0, end: 29, text: "Rehearsal refreshes the trace", verified: true },
    ...over,
  };
}

function card(over: Partial<Flashcard> = {}): Flashcard {
  return {
    id: 1, front: "f", back: "b", category: DEFAULT_FOLDER, tags: "[]",
    nextReviewAt: 0, intervalDays: 1, easeFactor: 2.5, repetitions: 0,
    lastReviewedAt: null, createdAt: 0, ...over,
  };
}

/* ── Shaping a card ──────────────────────────────────────────────────── */

test("a card keeps the question as asked and the answer with its evidence", () => {
  // Making the card here rather than from the source is the point: at this
  // moment the answer has a verified sentence attached to it.
  const made = cardFromQuestion(question(), ROUND);
  assert.equal(made.front, "______ refreshes the trace");
  assert.match(made.back, /^Rehearsal/);
  assert.match(made.back, /“Rehearsal refreshes the trace”/);
  assert.equal(made.category, DEFAULT_FOLDER);
});

test("an unverified proof is not quoted onto the card", () => {
  // The same rule as everywhere else: nothing is presented as the document's
  // words unless it was found in the document.
  const made = cardFromQuestion(question({ proof: { start: 0, end: 5, text: "invented", verified: false } }), ROUND);
  assert.equal(made.back, "Rehearsal");
  assert.ok(!made.back.includes("invented"));
});

test("a proof identical to the answer is not repeated", () => {
  const made = cardFromQuestion(question({
    answer: "Rehearsal refreshes the trace",
    proof: { start: 0, end: 29, text: "Rehearsal refreshes the trace", verified: true },
  }), ROUND);
  assert.equal(made.back, "Rehearsal refreshes the trace");
});

test("a card carries where it came from", () => {
  const made = cardFromQuestion(question({ type: "choice" }), ROUND);
  assert.deepEqual(JSON.parse(made.tags), ["quantum-recall", "choice", "passage-5"]);
});

test("a folder can be chosen at the point of keeping", () => {
  assert.equal(cardFromQuestion(question(), ROUND, "pharmacology").category, "pharmacology");
  assert.equal(cardFromQuestion(question(), ROUND, "   ").category, DEFAULT_FOLDER);
});

/* ── Duplicates ──────────────────────────────────────────────────────── */

test("the same question cannot be archived twice, however it is spaced", () => {
  // Passages come round again by design, so this will happen constantly.
  const existing = [card({ front: "  ______   refreshes the trace " })];
  assert.equal(alreadyArchived(existing, question()), true);
  assert.equal(alreadyArchived(existing, question({ stem: "What does rehearsal do?" })), false);
});

test("a question with no answer is not offered as a card", () => {
  const graded: Graded[] = [
    { question: question(), answer: { value: "x", elapsedMs: 0, expired: false }, verdict: "correct" },
    { question: question({ id: "q2", answer: "  " }), answer: { value: null, elapsedMs: 0, expired: true }, verdict: "missed" },
  ];
  assert.deepEqual(archivableFrom(graded).map(item => item.id), ["q1"]);
});

/* ── Folders ─────────────────────────────────────────────────────────── */

test("folders come from the category column, with the default first", () => {
  const folders = foldersOf([
    card({ id: 1, category: "pharmacology" }),
    card({ id: 2, category: "general" }),
    card({ id: 3, category: "anatomy" }),
    card({ id: 4, category: "pharmacology" }),
  ]);
  assert.deepEqual(folders, [
    { name: "general", count: 1 },
    { name: "anatomy", count: 1 },
    { name: "pharmacology", count: 2 },
  ]);
});

test("a card with no folder falls into the default rather than a blank one", () => {
  assert.deepEqual(foldersOf([card({ category: "" }), card({ id: 2, category: "  " })]), [{ name: DEFAULT_FOLDER, count: 2 }]);
});

test("tags survive a malformed column", () => {
  assert.deepEqual(cardTags(card({ tags: '["a","b"]' })), ["a", "b"]);
  assert.deepEqual(cardTags(card({ tags: "not json" })), []);
  assert.deepEqual(cardTags(card({ tags: null })), []);
});

test("due is decided by the schedule the review endpoint owns", () => {
  assert.equal(isDue(card({ nextReviewAt: 500 }), 1000), true);
  assert.equal(isDue(card({ nextReviewAt: 2000 }), 1000), false);
  assert.equal(isDue(card({ nextReviewAt: null }), 1000), true, "a card never reviewed is due");
});
