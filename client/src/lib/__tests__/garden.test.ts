/**
 * Deterministic tests for the Contingency Garden model.
 *
 * The canvas is judged by eye; the rules under it are not. The terminal-goal
 * rule, the layout arithmetic, the order a plan is carried out in, and the way
 * durations chain into Kronos all look plausible on screen while being wrong.
 *
 * Run with `npm run test:garden`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyGarden, addBranch, updateBranch, setGoal, removeBranch, isTerminal, canSprout,
  addChecklistItem, toggleChecklistItem, addPlan, removePlan, toggleBranchPlan,
  planOrder, planDuration, layoutGarden, retidy, schedulePlan, addDays, scheduleNotes,
  childrenOf, subtreeIds, depthOf, clampDuration, COL_W, ROW_H,
} from "../gardenStore";

function seed() {
  // root ─┬─ a ─── a1
  //       └─ b
  let s = addBranch(emptyGarden(), null, { action: "Root action", durationMinutes: 30 });
  const root = s.branches[0].id;
  s = addBranch(s, root, { action: "A", label: "if funded", durationMinutes: 60 });
  const a = s.branches[1].id;
  s = addBranch(s, root, { action: "B", label: "if stalled", durationMinutes: 45 });
  const b = s.branches[2].id;
  s = addBranch(s, a, { action: "A1", durationMinutes: 15 });
  const a1 = s.branches[3].id;
  return { s, root, a, b, a1 };
}

test("a goal makes a branch terminal and blocks sprouting", () => {
  let { s, a1 } = seed();
  assert.equal(canSprout(s.branches.find(x => x.id === a1)!), true);
  s = setGoal(s, a1, "Signed contract in hand");
  assert.equal(isTerminal(s.branches.find(x => x.id === a1)!), true);
  const before = s.branches.length;
  s = addBranch(s, a1, { action: "should be refused" });
  assert.equal(s.branches.length, before, "a terminal branch must refuse children");
});

test("a branch that already has children cannot be made terminal", () => {
  let { s, a } = seed();
  s = setGoal(s, a, "Done");
  assert.equal(s.branches.find(x => x.id === a)!.goal, "", "refused, not silently applied");
});

test("clearing a goal lets a branch sprout again", () => {
  let { s, a1 } = seed();
  s = setGoal(s, a1, "Endpoint");
  s = setGoal(s, a1, "");
  s = addBranch(s, a1, { action: "now allowed" });
  assert.equal(childrenOf(s, a1).length, 1);
});

test("removing a branch removes its whole subtree", () => {
  let { s, root, a } = seed();
  assert.equal(subtreeIds(s, a).length, 2);
  s = removeBranch(s, a);
  assert.equal(s.branches.length, 2, "root and B survive");
  assert.equal(childrenOf(s, root).length, 1);
});

test("depth and duration clamping", () => {
  const { s, a1 } = seed();
  assert.equal(depthOf(s, a1), 2);
  assert.equal(clampDuration(-5), 1);
  assert.equal(clampDuration(99999), 1440);
  assert.equal(clampDuration("nope"), 30);
});

test("plan tagging is a toggle, and removing a plan untags everything", () => {
  let { s, root, a } = seed();
  s = toggleBranchPlan(s, root, "A");
  s = toggleBranchPlan(s, a, "A");
  assert.equal(planOrder(s, "A").length, 2);
  s = toggleBranchPlan(s, a, "A");
  assert.equal(planOrder(s, "A").length, 1);
  s = toggleBranchPlan(s, a, "A");
  s = removePlan(s, "A");
  assert.equal(planOrder(s, "A").length, 0);
  assert.equal(s.branches.every(b => b.plans.length === 0), true);
});

test("plan order is depth-first and survives a skipped generation", () => {
  let { s, root, a1, b } = seed();
  s = toggleBranchPlan(s, root, "A");
  s = toggleBranchPlan(s, a1, "A");
  s = toggleBranchPlan(s, b, "A");
  assert.deepEqual(planOrder(s, "A").map(x => x.action), ["Root action", "A1", "B"]);
  assert.equal(planDuration(s, "A"), 30 + 15 + 45);
});

test("addPlan hands out the next free letter and stops at H", () => {
  let s = emptyGarden();
  assert.deepEqual(s.plans.map(p => p.letter), ["A"]);
  for (let i = 0; i < 10; i++) s = addPlan(s);
  assert.deepEqual(s.plans.map(p => p.letter), "ABCDEFGH".split(""));
});

test("layout: depth is the column, leaves take rows, parents sit at the midpoint", () => {
  const { s, root, a, b, a1 } = seed();
  const laid = layoutGarden(s);
  const at = (id: string) => laid.find(l => l.branch.id === id)!;

  assert.equal(at(root).x, 0);
  assert.equal(at(a).x, COL_W);
  assert.equal(at(a1).x, COL_W * 2);

  assert.equal(at(a1).y, 0);
  assert.equal(at(b).y, ROW_H);
  assert.equal(at(a).y, 0);
  assert.equal(at(root).y, ROW_H / 2);
});

test("a manual position wins and retidy gives it back", () => {
  let { s, a } = seed();
  s = updateBranch(s, a, { pos: { x: 999, y: 42 } });
  const pinned = layoutGarden(s).find(l => l.branch.id === a)!;
  assert.equal(pinned.x, 999);
  assert.equal(pinned.pinned, true);
  s = retidy(s);
  assert.equal(layoutGarden(s).find(l => l.branch.id === a)!.x, COL_W);
});

test("checklist add and toggle", () => {
  let { s, a } = seed();
  s = addChecklistItem(s, a, "  ");
  assert.equal(s.branches.find(x => x.id === a)!.checklist.length, 0);
  s = addChecklistItem(s, a, "Call the vendor");
  const item = s.branches.find(x => x.id === a)!.checklist[0];
  assert.equal(item.done, false);
  s = toggleChecklistItem(s, a, item.id);
  assert.equal(s.branches.find(x => x.id === a)!.checklist[0].done, true);
});

test("scheduling chains actions back to back", () => {
  const { s, root, a, a1 } = seed();
  let g = toggleBranchPlan(s, root, "A");
  g = toggleBranchPlan(g, a, "A");
  g = toggleBranchPlan(g, a1, "A");
  const slots = schedulePlan(planOrder(g, "A"), "2026-03-10", "09:00");
  assert.deepEqual(slots.map(x => x.startTime), ["09:00", "09:30", "10:30"]);
  assert.equal(slots.every(x => x.date === "2026-03-10"), true);
});

test("a plan that runs past midnight moves onto the next day", () => {
  let s = addBranch(emptyGarden(), null, { action: "Long haul", durationMinutes: 600 });
  const first = s.branches[0].id;
  s = addBranch(s, first, { action: "After", durationMinutes: 60 });
  s = toggleBranchPlan(s, first, "A");
  s = toggleBranchPlan(s, s.branches[1].id, "A");
  const slots = schedulePlan(planOrder(s, "A"), "2026-12-31", "20:00");
  assert.deepEqual(slots.map(x => [x.date, x.startTime]), [
    ["2026-12-31", "20:00"],
    ["2027-01-01", "06:00"],
  ]);
});

test("addDays crosses months and years", () => {
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});

test("schedule notes carry the label, goal and checklist", () => {
  let { s, a1 } = seed();
  s = updateBranch(s, a1, { label: "if the site is dry" });
  s = setGoal(s, a1, "Foundation poured");
  s = addChecklistItem(s, a1, "Book the mixer");
  const notes = scheduleNotes(s.branches.find(x => x.id === a1)!);
  assert.match(notes, /Contingency: if the site is dry/);
  assert.match(notes, /Goal: Foundation poured/);
  assert.match(notes, /\[ \] Book the mixer/);
});
