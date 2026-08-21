/**
 * Deterministic tests for the MIDAS store.
 *
 * The dashboard's geometry is judged by eye, but the arithmetic under it is not:
 * which scale is scored from what, how a blend is weighted, and whether an
 * untracked scale drags the composite down are all things that look right on
 * screen while being wrong.
 *
 * Run with `npm run test:midas`. No DOM — `loadMidas` falls back to the empty
 * state when there is no storage object, which is exactly the path under test.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MIDAS_SCALES, DEFAULT_SCALE_IDS, emptyState, loadMidas, addScale, removeScale,
  addSkill, removeSkill, updateSkill, skillsFor, scaleScore, compositeIndex,
  profileSpread, scaleMeta, clampLevel,
} from "../midasStore";

test("catalogue ids are unique and every default exists", () => {
  const ids = MIDAS_SCALES.map(s => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of DEFAULT_SCALE_IDS) assert.ok(scaleMeta(id), `${id} missing from catalogue`);
});

test("only cognitive scales claim a measured domain", () => {
  // Mapping a drill onto an intelligence would be a claim the data cannot
  // support: a Corsi score is evidence about Corsi, not about spatial ability.
  for (const s of MIDAS_SCALES) {
    if (s.group === "intelligence") assert.equal(s.domain, undefined, `${s.id} should not claim trial data`);
    else assert.ok(s.domain, `${s.id} should map to a domain`);
  }
});

test("loadMidas falls back to the empty state without a storage object", () => {
  const s = loadMidas();
  assert.deepEqual(s.scales, DEFAULT_SCALE_IDS);
  assert.equal(s.skills.length, 0);
});

test("scales are add-once and unknown ids are refused", () => {
  let s = emptyState();
  s = addScale(s, "musical");
  s = addScale(s, "musical");
  assert.equal(s.scales.filter(id => id === "musical").length, 1);
  const before = s.scales.length;
  s = addScale(s, "not_a_scale");
  assert.equal(s.scales.length, before);
});

test("removing a scale takes its skills with it", () => {
  let s = addScale(emptyState(), "musical");
  s = addSkill(s, "musical", "Sight-reading", 40);
  s = addSkill(s, "logical", "Proof technique", 60);
  assert.equal(s.skills.length, 2);
  s = removeScale(s, "musical");
  assert.equal(skillsFor(s, "musical").length, 0);
  assert.equal(s.skills.length, 1);
});

test("blank skill names are refused and levels are clamped", () => {
  let s = emptyState();
  s = addSkill(s, "logical", "   ");
  assert.equal(s.skills.length, 0);
  s = addSkill(s, "logical", "Estimation", 400);
  assert.equal(s.skills[0].level, 100);
  s = updateSkill(s, s.skills[0].id, { level: -50 });
  assert.equal(s.skills[0].level, 0);
  assert.equal(clampLevel("nonsense"), 0);
});

test("a level change inside the hour rewrites the point instead of appending", () => {
  let s = addSkill(emptyState(), "logical", "Estimation", 10);
  const id = s.skills[0].id;
  assert.equal(s.skills[0].history.length, 1);
  s = updateSkill(s, id, { level: 20 });
  s = updateSkill(s, id, { level: 30 });
  assert.equal(s.skills[0].history.length, 1, "same-hour edits collapse");
  assert.equal(s.skills[0].history[0].level, 30);
});

test("removing a skill leaves the rest alone", () => {
  let s = addSkill(addSkill(emptyState(), "logical", "A"), "logical", "B");
  s = removeSkill(s, s.skills[0].id);
  assert.equal(s.skills.length, 1);
  assert.equal(s.skills[0].name, "B");
});

test("scoring picks the right source and weights the blend toward you", () => {
  assert.deepEqual(scaleScore([], null), { value: 0, source: "empty" });
  assert.deepEqual(scaleScore([], 70), { value: 70, source: "measured" });

  const skills = [{ level: 80 }, { level: 40 }] as any;
  assert.deepEqual(scaleScore(skills, null), { value: 60, source: "self" });

  // 60 * 0.6 + 20 * 0.4 = 44 — the self-rating dominates, by design.
  assert.deepEqual(scaleScore(skills, 20), { value: 44, source: "blend" });
});

test("composite ignores unscored scales; spread reports the shape", () => {
  const scores = [
    { value: 80, source: "self" }, { value: 40, source: "measured" }, { value: 0, source: "empty" },
  ] as any;
  assert.equal(compositeIndex(scores), 60, "the empty scale must not drag the mean to 40");
  assert.equal(profileSpread(scores), 40);
  assert.equal(compositeIndex([]), 0);
  assert.equal(profileSpread([{ value: 50, source: "self" }] as any), 0);
});
