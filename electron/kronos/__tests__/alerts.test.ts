/**
 * Alerts — the VALARM half.
 *
 * Two things carry the weight here: the wire format Apple reads back into its
 * own menu, and the ownership rule that decides which alarms ROME may delete.
 * The second one is the dangerous half — a bug there silently removes a
 * reminder somebody set on their phone.
 *
 * Run: npm run test:kronos
 */

process.env.TZ = "America/Los_Angeles";

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  ALERT_PRESETS, MAX_ALERTS, alertLabel, minutesFromTrigger, normalizeAlerts,
  readAlerts, triggerFor, writeAlerts,
} from "../alerts";
import { buildVevent, patchVevent, readRomeAlerts, readVevent, toLines } from "../ical";

function readUp(relative: string, levels = 6): string | null {
  let dir = process.cwd();
  for (let i = 0; i <= levels; i += 1) {
    try {
      return readFileSync(path.join(dir, relative), "utf8");
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

// ── The stored column ───────────────────────────────────────────────────────

test("the column round-trips, and an empty one means no alert", () => {
  assert.deepEqual(readAlerts(""), []);
  assert.deepEqual(readAlerts(null), []);
  assert.deepEqual(readAlerts(undefined), []);
  assert.deepEqual(readAlerts("15"), [15]);
  assert.deepEqual(readAlerts("15,1440"), [15, 1440]);
  assert.equal(writeAlerts([1440, 15]), "15,1440");
});

test("0 is a real alert, not an absent one", () => {
  // "At time of item" and "no alert" are different answers, and a truthiness
  // check anywhere in this path collapses them into each other.
  assert.deepEqual(readAlerts("0"), [0]);
  assert.equal(writeAlerts([0]), "0");
  assert.equal(triggerFor(0), "-PT0S");
});

test("junk in the column never reaches iCloud", () => {
  // Three writers touch this column and a sync engine reads it. A cycle that
  // throws on a stray comma is worse than one that ignores it.
  assert.deepEqual(readAlerts("15,,abc,30"), [15, 30]);
  assert.deepEqual(readAlerts("-5"), []);          // an alarm after the start
  assert.deepEqual(readAlerts("999999"), []);      // past any sane bound
  assert.deepEqual(readAlerts("15,15"), [15]);     // duplicates collapse
});

test("the list is sorted and capped, so equal intent produces equal bytes", () => {
  // Unsorted input would produce two different .ics bodies for the same two
  // alerts, and the next cycle would read that as an edit and push again.
  assert.deepEqual(normalizeAlerts([1440, 15]), normalizeAlerts([15, 1440]));
  assert.equal(normalizeAlerts([5, 15, 30, 60]).length, MAX_ALERTS);
});

// ── The wire format ─────────────────────────────────────────────────────────

test("triggers are written in the largest whole unit", () => {
  // Apple's UI reads the duration back: `-P1D` shows as "1 day before", while
  // the equally-correct `-PT1440M` shows as "Custom".
  assert.equal(triggerFor(5), "-PT5M");
  assert.equal(triggerFor(60), "-PT1H");
  assert.equal(triggerFor(120), "-PT2H");
  assert.equal(triggerFor(1440), "-P1D");
  assert.equal(triggerFor(2880), "-P2D");
  assert.equal(triggerFor(10080), "-P1W");
  assert.equal(triggerFor(90), "-PT90M");   // no unit fits; minutes is honest
});

test("every preset survives a round trip through the wire format", () => {
  for (const preset of ALERT_PRESETS) {
    assert.equal(minutesFromTrigger(triggerFor(preset)), preset, String(preset));
  }
});

test("triggers ROME cannot represent read as null, not as zero", () => {
  assert.equal(minutesFromTrigger("PT15M"), null);        // *after* the start
  assert.equal(minutesFromTrigger("20260907T170000Z"), null);
  assert.equal(minutesFromTrigger("nonsense"), null);
  assert.equal(minutesFromTrigger(""), null);
  // Compound durations are legal and must not be misread.
  assert.equal(minutesFromTrigger("-P1DT2H30M"), 1440 + 150);
});

test("labels read the way Apple's menu does", () => {
  assert.equal(alertLabel(0), "At time of item");
  assert.equal(alertLabel(1), "1 minute before");
  assert.equal(alertLabel(15), "15 minutes before");
  assert.equal(alertLabel(60), "1 hour before");
  assert.equal(alertLabel(1440), "1 day before");
  assert.equal(alertLabel(10080), "1 week before");
});

// ── Building ────────────────────────────────────────────────────────────────

test("a built event carries its alarms, and they read back", () => {
  const ics = buildVevent({
    uid: "rome-event-1@rome.local", summary: "Dentist",
    date: "2026-09-10", time: "09:00", durationMinutes: 60, alerts: [15, 1440],
  });
  assert.ok(ics.includes("BEGIN:VALARM"));
  assert.ok(ics.includes("TRIGGER:-PT15M"));
  assert.ok(ics.includes("TRIGGER:-P1D"));
  assert.ok(ics.includes("ACTION:DISPLAY"));
  // The notification says the item's name rather than "Event".
  assert.ok(ics.includes("DESCRIPTION:Dentist"));
  assert.deepEqual(readRomeAlerts(ics), [15, 1440]);
});

test("no alerts means no VALARM at all", () => {
  const ics = buildVevent({
    uid: "rome-event-1@rome.local", summary: "Quiet",
    date: "2026-09-10", time: "09:00", alerts: [],
  });
  assert.ok(!ics.includes("VALARM"));
});

// ── Ownership: the half that can destroy something ──────────────────────────

const WITH_USER_ALARM = [
  "BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT",
  "UID:rome-event-7@rome.local",
  "DTSTAMP:20260901T120000Z",
  "DTSTART:20260910T160000Z",
  "DTEND:20260910T170000Z",
  "SUMMARY:Dentist",
  // Set on the phone: no ROME marker anywhere in it.
  "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Leave now",
  "TRIGGER:-PT45M", "UID:8A1F-APPLE-ALARM", "END:VALARM",
  "END:VEVENT", "END:VCALENDAR",
].join("\r\n");

test("an alarm set on the phone is never reported as ROME's", () => {
  assert.deepEqual(readRomeAlerts(WITH_USER_ALARM), []);
});

test("a push replaces ROME's alarms and leaves the user's alone", () => {
  // First push: ROME adds its own beside the one already there.
  const once = patchVevent(WITH_USER_ALARM, { summary: "Dentist", alerts: [15] });
  assert.ok(once.includes("TRIGGER:-PT45M"), "the phone's alarm survived");
  assert.deepEqual(readRomeAlerts(once), [15]);

  // Second push, different alert: ROME's is replaced, not duplicated.
  const twice = patchVevent(once, { summary: "Dentist", alerts: [30] });
  assert.ok(twice.includes("TRIGGER:-PT45M"), "the phone's alarm still survived");
  assert.deepEqual(readRomeAlerts(twice), [30]);
  assert.equal(twice.split("BEGIN:VALARM").length - 1, 2, "one theirs, one ours");
});

test("clearing the alerts removes ROME's and only ROME's", () => {
  const once = patchVevent(WITH_USER_ALARM, { summary: "Dentist", alerts: [15] });
  const cleared = patchVevent(once, { summary: "Dentist", alerts: [] });
  assert.deepEqual(readRomeAlerts(cleared), []);
  assert.ok(cleared.includes("TRIGGER:-PT45M"), "the phone's alarm survived the clear");
  assert.equal(cleared.split("BEGIN:VALARM").length - 1, 1);
});

test("a patch that says nothing about alerts touches no alarm at all", () => {
  // The default for the whole patch path: unmentioned means untouched. A push
  // that only moved the date must not disturb a reminder.
  const once = patchVevent(WITH_USER_ALARM, { summary: "Dentist", alerts: [15] });
  const moved = patchVevent(once, { date: "2026-09-11", time: "09:00", durationMinutes: 60 });
  assert.deepEqual(readRomeAlerts(moved), [15]);
  assert.ok(moved.includes("TRIGGER:-PT45M"));
});

test("an alarm ROME wrote is still ROME's after Apple strips the X- property", () => {
  // Apple's Calendar rewrites an event it edits and may drop unknown X-
  // properties. The alarm UID is how a client tracks a snooze, so it is kept —
  // which is why ownership is claimed by either marker, not both.
  const once = patchVevent(WITH_USER_ALARM, { summary: "Dentist", alerts: [15] });
  const stripped = toLines(once).filter(l => !l.startsWith("X-ROME-ALARM")).join("\r\n");
  assert.deepEqual(readRomeAlerts(stripped), [15]);
});

test("the VALARM's own DESCRIPTION is still not the event's", () => {
  // The depth-aware lookup, re-checked now that ROME writes alarms with a
  // DESCRIPTION of their own that happens to equal the title.
  const ics = buildVevent({
    uid: "rome-event-1@rome.local", summary: "Dentist",
    description: "Bring the referral", date: "2026-09-10", time: "09:00", alerts: [15],
  });
  assert.equal(readVevent(ics)?.description, "Bring the referral");
});

// ── The two copies of the preset list ───────────────────────────────────────

test("ALERT_PRESETS matches the renderer's copy", () => {
  // `electron/` cannot import from `client/`, so the list exists twice. A
  // preset added on one side only is a value the user can pick and the engine
  // will never send.
  const source = readUp("client/src/lib/kronosAlerts.ts");
  if (!source) return;   // not run from the repo; nothing to compare against
  const m = /export const ALERT_PRESETS = \[([^\]]+)\]/.exec(source);
  assert.ok(m, "the renderer's ALERT_PRESETS could not be found");
  const theirs = m![1].split(",").map(v => Number(v.trim())).filter(Number.isFinite);
  assert.deepEqual(theirs, [...ALERT_PRESETS]);

  const cap = /export const MAX_ALERTS = (\d+)/.exec(source);
  assert.ok(cap, "the renderer's MAX_ALERTS could not be found");
  assert.equal(Number(cap![1]), MAX_ALERTS);
});
