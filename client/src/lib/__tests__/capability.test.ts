/**
 * Capability ledger — the arithmetic, without a browser.
 *
 * Everything under test is pure; the storage half of `capabilityStore` needs a
 * `window` and is exercised by using the app. What is worth testing here is
 * the tier boundaries, because a boundary off by one is invisible until the
 * day the bar says Confidence 3 and the panel says you need 0 more credit.
 *
 * Run: npm run test:capability
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TIER_BASE,
  addEntry,
  clampCredit,
  confidenceFor,
  creditToReach,
  emptyCapability,
  removeEntry,
  removeEntryForTask,
  tierProgress,
  totalCredit,
  updateEntry,
} from "../capabilityStore";

// ── The curve ───────────────────────────────────────────────────────────────

test("reaching a tier costs the triangular sum of the base", () => {
  assert.equal(creditToReach(0), 0);
  assert.equal(creditToReach(1), TIER_BASE);
  assert.equal(creditToReach(2), TIER_BASE * 3);
  assert.equal(creditToReach(5), TIER_BASE * 15);
});

test("you start at Confidence 1 with nothing banked", () => {
  const c = confidenceFor(0);
  assert.equal(c.tier, 1);
  assert.equal(c.into, 0);
  assert.equal(c.span, TIER_BASE);
  assert.equal(tierProgress(c), 0);
});

test("a tier boundary promotes exactly on the threshold, not one past it", () => {
  assert.equal(confidenceFor(TIER_BASE - 1).tier, 1);
  assert.equal(confidenceFor(TIER_BASE).tier, 2);
  assert.equal(confidenceFor(TIER_BASE).into, 0);
});

test("progress inside a tier is measured against that tier's own span", () => {
  // Confidence 2 spans 2 × base, starting at 1 × base.
  const c = confidenceFor(TIER_BASE * 2);
  assert.equal(c.tier, 2);
  assert.equal(c.span, TIER_BASE * 2);
  assert.equal(c.into, TIER_BASE);
  assert.equal(tierProgress(c), 0.5);
});

test("tiers get progressively more expensive", () => {
  const spans = [1, 2, 3, 4].map(n => confidenceFor(creditToReach(n)).span);
  for (let i = 1; i < spans.length; i++) assert.ok(spans[i] > spans[i - 1]);
});

test("negative and junk totals resolve to the floor rather than throwing", () => {
  assert.equal(confidenceFor(-500).tier, 1);
  assert.equal(confidenceFor(Number.NaN).tier, 1);
});

// ── Entries ─────────────────────────────────────────────────────────────────

test("credit is clamped, and zero is a legitimate value", () => {
  assert.equal(clampCredit(-4), 0);
  assert.equal(clampCredit(0), 0);
  assert.equal(clampCredit("12"), 12);
  assert.equal(clampCredit(9e9), 10_000);
  assert.equal(clampCredit("nonsense"), 0);
});

test("an entry adds its credit to the total", () => {
  let s = emptyCapability();
  s = addEntry(s, "Wrote the parser", 30);
  s = addEntry(s, "Fixed the grid", 20);
  assert.equal(totalCredit(s), 50);
  assert.equal(confidenceFor(totalCredit(s)).tier, 2);
});

test("a blank label is not an entry", () => {
  const s = addEntry(emptyCapability(), "   ", 40);
  assert.equal(s.entries.length, 0);
});

test("checking a task off twice credits it once", () => {
  let s = emptyCapability();
  s = addEntry(s, "Ship it", 10, "stabilizer", "task-1");
  s = addEntry(s, "Ship it", 10, "stabilizer", "task-1");
  assert.equal(s.entries.length, 1);
  assert.equal(totalCredit(s), 10);
});

test("removing an entry takes its credit back — including across a boundary", () => {
  let s = emptyCapability();
  s = addEntry(s, "Big one", TIER_BASE);
  assert.equal(confidenceFor(totalCredit(s)).tier, 2);

  const id = s.entries[0].id;
  s = removeEntry(s, id);
  assert.equal(totalCredit(s), 0);
  assert.equal(confidenceFor(totalCredit(s)).tier, 1);
});

test("un-completing a task removes the entry it created", () => {
  let s = emptyCapability();
  s = addEntry(s, "Draft", 15, "stabilizer", "task-9");
  s = addEntry(s, "Unrelated", 5, "manual");
  s = removeEntryForTask(s, "task-9");
  assert.equal(s.entries.length, 1);
  assert.equal(totalCredit(s), 5);
});

test("editing an entry's credit moves the total", () => {
  let s = addEntry(emptyCapability(), "Reviewed", 10);
  const id = s.entries[0].id;
  s = updateEntry(s, id, { credit: 45 });
  assert.equal(totalCredit(s), 45);
  s = updateEntry(s, id, { label: "  Reviewed properly  " });
  assert.equal(s.entries[0].label, "Reviewed properly");
  assert.equal(s.entries[0].credit, 45, "editing the label leaves the credit alone");
});

test("an empty label edit is ignored rather than blanking the entry", () => {
  let s = addEntry(emptyCapability(), "Kept", 10);
  s = updateEntry(s, s.entries[0].id, { label: "   " });
  assert.equal(s.entries[0].label, "Kept");
});

test("newest entry is first, so the ledger reads as a log", () => {
  let s = emptyCapability();
  s = addEntry(s, "First", 1);
  s = addEntry(s, "Second", 1);
  assert.equal(s.entries[0].label, "Second");
});
