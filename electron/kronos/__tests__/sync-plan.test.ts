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
import { DavError } from "../icloud-dav";
import { describeFailure, describeWritebackFailure, resourceName } from "../sync-engine";
import {
  DELETE_GUARD_FLOOR, KIND_FIELDS, KRONOS_KINDS, MIGRATION_REQUIRED, deleteGuardExceeded,
  deleteGuardMessage, describeCycle, emptyRows, isLocallyDirty, livePlacementKeys, localDay,
  placementDate, planDeletes, planPush, romeHref, romeKeyFromHref, rowKey, syncColumnsPresent,
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
  assert.match(describeCycle(planPush(emptyRows(), CAL, NOW), 0), /already up to date/);
  assert.match(describeCycle(planPush(rows({ routine: [routine()] }), CAL, NOW), 0), /create 1 event/);
  assert.match(
    describeCycle(planPush(rows({ routine: [routine(), routine({ id: 2 })] }), CAL, NOW), 0),
    /create 2 events/,
  );
});

test("the summary names deletions, including a cycle that only deletes", () => {
  // The dangerous case is the sweep-only cycle: nothing to create, nothing to
  // update, and something about to leave a real calendar. A summary built from
  // the push plan alone would call that "already up to date".
  assert.match(describeCycle(planPush(emptyRows(), CAL, NOW), 2), /delete 2/);
  assert.doesNotMatch(describeCycle(planPush(emptyRows(), CAL, NOW), 2), /up to date/);
  assert.match(
    describeCycle(planPush(rows({ routine: [routine()] }), CAL, NOW), 3),
    /create 1 event and delete 3/,
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

// ── What a failure says ─────────────────────────────────────────────────────
//
// These strings are the entire interface after something goes wrong, and the
// first real run produced one that sent the user looking for an edit that had
// never happened. Worth pinning.

test("a 412 reads differently on a create than on an update", () => {
  const conflict = new DavError("412", "precondition", 412);

  const creating = describeFailure(
    { kind: "event", row: { id: 1, title: "Five North" }, op: "create", href: "/c/rome-event-1.ics" },
    conflict,
  );
  // "The event changed on iCloud while ROME was writing it" is true of an
  // If-Match failure and nonsense on an If-None-Match one — nothing changed,
  // there was already something there.
  assert.match(creating, /already exists/);
  assert.match(creating, /rome-event-1\.ics/, "and it names where");
  assert.doesNotMatch(creating, /changed on iCloud/);

  const updating = describeFailure(
    { kind: "event", row: { id: 1, title: "Five North" }, op: "update", href: "/c/rome-event-1.ics" },
    conflict,
  );
  assert.match(updating, /changed on iCloud/);
});

test("a missing sync column is named as the migration, not as a mystery", () => {
  for (const message of [
    `Could not find the 'synced_at' column of 'kronos_events' in the schema cache`,
    `column "ical_href" of relation "kronos_routines" does not exist`,
    "PGRST204",
  ]) {
    assert.match(describeWritebackFailure(new Error(message)), /2026-08-kronos-v2\.sql/);
  }
  assert.match(describeWritebackFailure(new Error("connect ECONNREFUSED")), /ECONNREFUSED/);
});

test("actions carry the day they will land on, for the confirmation", () => {
  const plan = planPush(rows({ assignment: [assignment()] }), CAL, NOW);
  assert.equal(plan.actions[0].op, "create");
  assert.equal(plan.actions[0].date, "2026-09-10");
});

test("a database without the sync columns is detected from the rows themselves", () => {
  // PostgREST returns only columns that exist, so a row that came back without
  // an `ical_href` key is one from a database the migration never touched.
  const migrated = rows({ assignment: [assignment({ ical_href: "", synced_at: null })] });
  assert.equal(syncColumnsPresent(migrated), true);

  const { ical_href, synced_at, ...preMigration } = assignment();
  assert.equal(syncColumnsPresent(rows({ assignment: [preMigration] })), false);

  // Nothing to judge from, and nothing to push either.
  assert.equal(syncColumnsPresent(emptyRows()), null);
});

test("the migration message names the file to run", () => {
  assert.match(MIGRATION_REQUIRED, /2026-08-kronos-v2\.sql/);
  assert.match(MIGRATION_REQUIRED, /Supabase/);
});

// ── The orphan sweep ────────────────────────────────────────────────────────
//
// The sweep deletes things from a real calendar, so the tests worth having are
// the ones that pin down what it must *never* touch.

test("only ROME's own resource names are ever recognised", () => {
  assert.deepEqual(romeKeyFromHref(`${CAL}rome-assignment-42.ics`), { kind: "assignment", id: 42 });
  assert.deepEqual(romeKeyFromHref("rome-routine-1.ics"), { kind: "routine", id: 1 });

  // Everything Apple Calendar itself creates. If any of these matched, the
  // sweep could delete an event the user made on their phone.
  for (const href of [
    `${CAL}1A2B3C4D-5E6F-7890-ABCD-EF1234567890.ics`,
    `${CAL}rome-assignment-42.ics.bak`,
    `${CAL}notrome-assignment-42.ics`,
    `${CAL}rome-meeting-42.ics`,        // not one of the four kinds
    `${CAL}rome-assignment-.ics`,
    `${CAL}rome-assignment-abc.ics`,
    "",
  ]) {
    assert.equal(romeKeyFromHref(href), null, href);
  }
});

test("a resource whose name is only a suffix of ROME's is not ROME's", () => {
  // Anchored on a path separator, so `xrome-event-3.ics` cannot slip through.
  assert.equal(romeKeyFromHref(`${CAL}xrome-event-3.ics`), null);
  assert.deepEqual(romeKeyFromHref(`${CAL}sub/rome-event-3.ics`), { kind: "event", id: 3 });
});

test("an unchanged row is still on the calendar", () => {
  // The single most destructive mistake available here: "nothing to push" read
  // as "nothing belongs there", which would sweep every synced item every time
  // the user changed nothing.
  const synced = assignment({ ical_href: `${CAL}rome-assignment-2.ics`, synced_at: 1000, updated_at: 1000 });
  const plan = planPush(rows({ assignment: [synced] }), CAL, NOW);
  assert.equal(only(plan).reason, "unchanged");
  assert.ok(livePlacementKeys(plan).has(rowKey("assignment", 2)));

  const { deletes } = planDeletes([{ href: `${CAL}rome-assignment-2.ics`, etag: '"a"' }], plan);
  assert.deepEqual(deletes, []);
});

test("creates and updates count as live, skips that mean 'not placed' do not", () => {
  const plan = planPush(rows({
    routine: [routine()],                                   // create
    assignment: [assignment({ id: 2, saved: true })],        // library template
    event: [{ id: 3, title: "Talk", event_date: "", updated_at: 1000, synced_at: null }],
  }), CAL, NOW);

  const live = livePlacementKeys(plan);
  assert.ok(live.has(rowKey("routine", 1)));
  assert.ok(!live.has(rowKey("assignment", 2)));
  assert.ok(!live.has(rowKey("event", 3)));
});

test("a row turned back into a template is swept, and says why", () => {
  const template = assignment({ saved: true, ical_href: `${CAL}rome-assignment-2.ics` });
  const plan = planPush(rows({ assignment: [template] }), CAL, NOW);

  const { deletes, romeResources } = planDeletes(
    [{ href: `${CAL}rome-assignment-2.ics`, etag: '"e1"' }], plan,
  );
  assert.equal(romeResources, 1);
  assert.equal(deletes.length, 1);
  assert.equal(deletes[0].id, 2);
  assert.equal(deletes[0].kind, "assignment");
  assert.equal(deletes[0].etag, '"e1"');
  assert.equal(deletes[0].title, "Chapter 5");
  assert.match(deletes[0].reason, /library template/);
});

test("a row deleted outright is swept, and is named as gone rather than guessed at", () => {
  // No action to look up: the row is not in the plan because it is not in the
  // database. There is no title left, and the reason should say so.
  const plan = planPush(emptyRows(), CAL, NOW);
  const { deletes } = planDeletes([{ href: `${CAL}rome-event-9.ics`, etag: null }], plan);
  assert.equal(deletes.length, 1);
  assert.equal(deletes[0].title, null);
  assert.equal(deletes[0].reason, "deleted from Kronos");
});

test("foreign resources are neither swept nor counted against the guard", () => {
  const plan = planPush(emptyRows(), CAL, NOW);
  const { deletes, romeResources } = planDeletes([
    { href: `${CAL}A1B2-apple.ics`, etag: '"x"' },
    { href: `${CAL}another-one.ics`, etag: '"y"' },
  ], plan);
  assert.deepEqual(deletes, []);
  assert.equal(romeResources, 0);
});

test("the mass-delete guard trips past max(5, a quarter of ROME's events)", () => {
  assert.equal(DELETE_GUARD_FLOOR, 5);

  // Small calendars: the floor governs, so ordinary tidying is never blocked.
  assert.equal(deleteGuardExceeded(5, 8), false);
  assert.equal(deleteGuardExceeded(6, 8), true);

  // Large ones: the fraction governs.
  assert.equal(deleteGuardExceeded(25, 100), false);
  assert.equal(deleteGuardExceeded(26, 100), true);

  // The failure this exists for — a wrong calendar or a half-read listing makes
  // every resource look like an orphan.
  assert.equal(deleteGuardExceeded(40, 40), true);

  const message = deleteGuardMessage(40, 40);
  assert.match(message, /40 of 40/);
  assert.match(message, /nothing was changed/);
});

test("orphan bodies are matched by filename, not by the whole href", () => {
  // The listing and the multiget response can spell the same resource
  // differently — an absolute URL on the partition host, a query string, a
  // trailing slash. The filename is unique in a calendar and is the thing that
  // identified the resource as ROME's to begin with.
  const name = "rome-assignment-42.ics";
  for (const href of [
    `${CAL}${name}`,
    `/${name}`,
    name,
    `https://p42-caldav.icloud.com${CAL}${name}`,
    `${CAL}${name}?x=1`,
  ]) {
    assert.equal(resourceName(href), name, href);
  }
});

// ── Alerts reaching the wire ────────────────────────────────────────────────

test("an item's alerts are pushed with it", () => {
  const plan = planPush(rows({ assignment: [assignment({ alerts: "15,1440" })] }), CAL, NOW);
  const action = only(plan);
  assert.equal(action.op, "create");
  assert.ok(action.ics!.includes("TRIGGER:-PT15M"));
  assert.ok(action.ics!.includes("TRIGGER:-P1D"));
});

test("a database without the alerts column pushes no alarms rather than failing", () => {
  // `alerts` arrived in a later migration than the sync columns, so a database
  // that ran one and not the other is a real state. PostgREST simply omits the
  // key, which must read as "no alert" and not as an alert at minute zero.
  const { alerts, ...noColumn } = assignment({ alerts: "" });
  const action = only(planPush(rows({ assignment: [noColumn] }), CAL, NOW));
  assert.equal(action.op, "create");
  assert.ok(!action.ics!.includes("VALARM"));
});
