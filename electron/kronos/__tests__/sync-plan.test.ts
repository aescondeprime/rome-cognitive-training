/**
 * What a push cycle decides to do.
 *
 * This is the half of the engine worth testing hardest, because it is the half
 * that decides whether something lands in a real calendar. Every case here is
 * one someone's data will hit: a library template that must not become an
 * event, a row edited while the last cycle was still running, an event the user
 * decorated with an alarm on their phone.
 *
 * Run: npm run test:kronos
 */

process.env.TZ = "America/Los_Angeles";

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { readVevent } from "../ical";
import {
  KIND_FIELDS, KRONOS_KINDS, describePlan, emptyRows, isLocallyDirty,
  localDay, placementDate, planPush, romeHref,
  type KronosKind, type KronosRow, type RowsByKind,
} from "../sync-plan";

const CAL = "/1234567/calendars/rome/";
const NOW = Date.UTC(2026, 8, 3, 17, 0, 0);   // 2026-09-03 10:00 PDT

function rows(patch: Partial<RowsByKind>): RowsByKind {
  return { ...emptyRows(), ...patch };
}

/** A placement: dirty, dated, never pushed. */
function routine(over: Partial<KronosRow> = {}): KronosRow {
  return {
    id: 1, title: "Morning workout", start_time: "07:00", duration_minutes: 45,
    saved: false, recurrence: "daily", days_of_week: [],
    start_date: "2026-09-01", end_date: "2026-09-30",
    notes: "", updated_at: 1000, synced_at: null, ...over,
  };
}

function assignment(over: Partial<KronosRow> = {}): KronosRow {
  return {
    id: 2, title: "Chapter 5", start_time: "09:00", duration_minutes: 90,
    saved: false, due_date: "2026-09-10", instructions: "Read it",
    updated_at: 1000, synced_at: null, ...over,
  };
}

const only = (plan: ReturnType<typeof planPush>) => plan.actions[0];

/** Find a repo-relative file by walking up from the working directory. */
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

// ── Skips ───────────────────────────────────────────────────────────────────

test("a library template never becomes an event", () => {
  // It is not drawn on any day in ROME; putting it on the user's phone would
  // show them something ROME itself does not.
  const action = only(planPush(rows({ routine: [routine({ saved: true })] }), CAL, NOW));
  assert.equal(action.op, "skip");
  assert.equal(action.reason, "library template");
});

test("a row with no date is a half-finished thought, not a calendar entry", () => {
  const action = only(planPush(rows({ assignment: [assignment({ due_date: "" })] }), CAL, NOW));
  assert.equal(action.op, "skip");
  assert.equal(action.reason, "no date");
});

test("an untitled row is skipped", () => {
  const action = only(planPush(rows({ assignment: [assignment({ title: "   " })] }), CAL, NOW));
  assert.equal(action.op, "skip");
  assert.equal(action.reason, "no title");
});

test("a weekly routine with no days has no occurrences and is skipped", () => {
  const action = only(planPush(
    rows({ routine: [routine({ recurrence: "weekly", days_of_week: [] })] }), CAL, NOW));
  assert.equal(action.op, "skip");
  assert.match(String(action.reason), /no days/);
});

test("an event ROME cannot represent is never pushed back", () => {
  // `foreign` is set by the pull side. Pushing it would flatten whatever Apple
  // feature it uses into the two-case grammar Kronos can express.
  const action = only(planPush(
    rows({ event: [{ id: 9, title: "Standup", event_date: "2026-09-10", start_time: "09:00",
      duration_minutes: 30, sync_state: "foreign", ical_href: `${CAL}x.ics`, updated_at: 2, synced_at: 1 }] }),
    CAL, NOW));
  assert.equal(action.op, "skip");
  assert.match(String(action.reason), /Apple Calendar/);
});

// ── Dirtiness ───────────────────────────────────────────────────────────────

test("dirty is strictly greater, which is the ping-pong guard", () => {
  assert.equal(isLocallyDirty({ id: 1, updated_at: 100, synced_at: 99 }), true);
  // Equal means the last thing that touched this row was our own writeback.
  // Treat that as dirty and the engine pushes the same row forever.
  assert.equal(isLocallyDirty({ id: 1, updated_at: 100, synced_at: 100 }), false);
  assert.equal(isLocallyDirty({ id: 1, updated_at: 100, synced_at: null }), true);
});

test("an unchanged row is left alone", () => {
  const action = only(planPush(
    rows({ assignment: [assignment({ ical_href: `${CAL}a.ics`, updated_at: 500, synced_at: 500 })] }),
    CAL, NOW));
  assert.equal(action.op, "skip");
  assert.equal(action.reason, "unchanged");
});

// ── Creating ────────────────────────────────────────────────────────────────

test("a row iCloud has never seen is created, at a stable href", () => {
  const action = only(planPush(rows({ routine: [routine()] }), CAL, NOW));
  assert.equal(action.op, "create");
  assert.equal(action.href, `${CAL}rome-routine-1.ics`);
  assert.equal(romeHref(CAL, "routine", 1), action.href);

  const vevent = readVevent(action.ics!)!;
  assert.equal(vevent.summary, "Morning workout");
  assert.equal(vevent.romeKind, "routine");
  assert.equal(vevent.romeId, "1");
  assert.equal(vevent.durationMinutes, 45);
});

test("a routine carries a rule; a one-shot does not", () => {
  const withRule = readVevent(only(planPush(rows({ routine: [routine()] }), CAL, NOW)).ics!)!;
  assert.match(withRule.rrule, /FREQ=DAILY/);
  assert.match(withRule.rrule, /UNTIL=/, "the month window becomes the bound");

  const oneShot = readVevent(only(planPush(rows({ assignment: [assignment()] }), CAL, NOW)).ics!)!;
  assert.equal(oneShot.rrule, "");
});

test("a weekly routine's days become BYDAY", () => {
  const action = only(planPush(
    rows({ routine: [routine({ recurrence: "weekly", days_of_week: [1, 3, 5] })] }), CAL, NOW));
  assert.match(readVevent(action.ics!)!.rrule, /FREQ=WEEKLY;BYDAY=MO,WE,FR/);
});

test("a routine is anchored at the start of its window", () => {
  assert.equal(placementDate("routine", routine(), "2026-09-03"), "2026-09-01");
});

test("a pre-v2 routine with no window anchors at today, not at the epoch", () => {
  // Anchoring it at its creation date would emit an unbounded daily series
  // stretching back however far, which makes Apple Calendar crawl.
  assert.equal(placementDate("routine", routine({ start_date: "" }), "2026-09-03"), "2026-09-03");
  assert.equal(localDay(NOW), "2026-09-03");
});

// ── Updating ────────────────────────────────────────────────────────────────

const APPLE_DECORATED = [
  "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ROME//Kronos Keep//EN", "BEGIN:VEVENT",
  "UID:rome-assignment-2@rome.local",
  "DTSTART:20260910T160000Z", "DTEND:20260910T173000Z",
  "SUMMARY:Chapter 5", "SEQUENCE:1", "DTSTAMP:20260901T000000Z",
  "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Reminder", "TRIGGER:-PT15M", "END:VALARM",
  "ATTENDEE;CN=\"Priya\":mailto:priya@example.com",
  "END:VEVENT", "END:VCALENDAR",
].join("\r\n");

test("an update patches the stored file, keeping what the user added on their phone", () => {
  const action = only(planPush(rows({
    assignment: [assignment({
      title: "Chapter 5 — revised",
      ical_href: `${CAL}rome-assignment-2.ics`,
      ical_etag: '"e1"',
      ical_raw: APPLE_DECORATED,
      updated_at: 900, synced_at: 500,
    })],
  }), CAL, NOW));

  assert.equal(action.op, "update");
  assert.equal(action.etag, '"e1"', "so the PUT can carry an If-Match");

  const ics = action.ics!;
  assert.ok(ics.includes("BEGIN:VALARM"), "the alarm survived");
  assert.ok(ics.includes("TRIGGER:-PT15M"));
  assert.ok(ics.includes("mailto:priya@example.com"), "so did the attendee");
  assert.equal(readVevent(ics)!.summary, "Chapter 5 — revised");
  assert.equal(readVevent(ics)!.sequence, 2, "and SEQUENCE moved on");
});

test("without a stored file the event is rebuilt rather than skipped", () => {
  const action = only(planPush(rows({
    assignment: [assignment({ ical_href: `${CAL}a.ics`, ical_raw: "", updated_at: 900, synced_at: 500 })],
  }), CAL, NOW));
  assert.equal(action.op, "update");
  assert.equal(readVevent(action.ics!)!.summary, "Chapter 5");
});

// ── The plan as a whole ─────────────────────────────────────────────────────

test("counts add up, and every row produces exactly one action", () => {
  const plan = planPush(rows({
    routine: [routine(), routine({ id: 11, saved: true })],
    assignment: [assignment({ ical_href: `${CAL}a.ics`, updated_at: 9, synced_at: 1 })],
    event: [{ id: 3, title: "Talk", event_date: "2026-09-12", start_time: "10:00", duration_minutes: 60, updated_at: 1 }],
    general: [{ id: 4, title: "Parcel", item_date: "", start_time: "12:00", duration_minutes: 15, updated_at: 1 }],
  }), CAL, NOW);

  assert.equal(plan.actions.length, 5);
  assert.equal(plan.creates, 2);   // routine 1, event 3
  assert.equal(plan.updates, 1);   // assignment
  assert.equal(plan.skipped, 2);   // template, undated general
});

test("the summary is a sentence, and says so when there is nothing to do", () => {
  assert.match(describePlan(planPush(emptyRows(), CAL, NOW)), /already up to date/);
  assert.match(describePlan(planPush(rows({ routine: [routine()] }), CAL, NOW)), /create 1 event/);
  assert.match(
    describePlan(planPush(rows({ routine: [routine(), routine({ id: 2 })] }), CAL, NOW)),
    /create 2 events/,
  );
});

// ── The two copies of the type registry ─────────────────────────────────────

test("KIND_FIELDS matches the renderer's registry", () => {
  // `electron/` cannot import from `client/`, so the per-kind field names exist
  // twice. Checked here rather than hoped at: a rename on one side that misses
  // the other sends every item of that type to the wrong date column.
  // Walked up from the working directory rather than resolved against the
  // module's own path: `import.meta` does not typecheck under the Electron
  // tsconfig (module: CommonJS) and `__dirname` does not exist under ESM, so
  // neither works in both places this file is compiled and run.
  const source = readUp("client/src/lib/kronosTypes.ts");
  if (source === null) assert.fail("could not find the renderer registry to compare against");

  for (const kind of KRONOS_KINDS) {
    const start = source.indexOf(`  ${kind}: {`);
    assert.notEqual(start, -1, `${kind} missing from the renderer registry`);
    const block = source.slice(start, source.indexOf("\n  },", start));
    const fields = KIND_FIELDS[kind as KronosKind];

    assert.ok(block.includes(`plural: "${fields.plural}"`), `${kind}: plural differs`);
    assert.ok(block.includes(`detailField: "${fields.detailField}"`), `${kind}: detailField differs`);
    assert.ok(
      block.includes(fields.dateField === null ? "dateField: null" : `dateField: "${fields.dateField}"`),
      `${kind}: dateField differs`,
    );
  }
});
