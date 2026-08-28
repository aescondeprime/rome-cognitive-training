/**
 * RRULE ↔ routine.
 *
 * The refusals matter more than the translations. A rule ROME approximates
 * instead of refusing becomes wrong events on the user's phone, and "last
 * Friday of the month" quietly becoming "every Friday" is twenty-six of them.
 *
 * Run: npm run test:kronos
 */

process.env.TZ = "America/Los_Angeles";

import test from "node:test";
import assert from "node:assert/strict";

import {
  localDateToUntil,
  readRrule,
  routineFromRrule,
  rruleFromRoutine,
  untilToLocalDate,
} from "../rrule";

// ── Writing ─────────────────────────────────────────────────────────────────

test("a daily routine is FREQ=DAILY", () => {
  assert.equal(
    rruleFromRoutine({ recurrence: "daily", days_of_week: null, start_date: "", end_date: "" }),
    "FREQ=DAILY",
  );
});

test("a weekly routine lists its days in week order", () => {
  assert.equal(
    rruleFromRoutine({ recurrence: "weekly", days_of_week: [5, 1, 3], end_date: "" }),
    "FREQ=WEEKLY;BYDAY=MO,WE,FR",
  );
});

test("the month window becomes UNTIL", () => {
  const rule = rruleFromRoutine({ recurrence: "daily", days_of_week: [], end_date: "2026-08-31" });
  // 23:59:59 on Aug 31 in PDT is 06:59:59 UTC on Sep 1. Getting this wrong by a
  // day only shows up on the final occurrence, which is the one nobody checks.
  assert.equal(rule, "FREQ=DAILY;UNTIL=20260901T065959Z");
});

test("no window means no UNTIL", () => {
  assert.ok(!rruleFromRoutine({ recurrence: "daily", end_date: null }).includes("UNTIL"));
  assert.ok(!rruleFromRoutine({ recurrence: "daily", end_date: "not a date" }).includes("UNTIL"));
});

test("a weekly routine with no days selected is written as daily", () => {
  // It has no occurrences at all. Emitting FREQ=WEEKLY with no BYDAY would mean
  // "whatever weekday DTSTART lands on" — a schedule the user never chose.
  assert.equal(rruleFromRoutine({ recurrence: "weekly", days_of_week: [], end_date: "" }), "FREQ=DAILY");
});

test("out-of-range weekday numbers are dropped rather than emitted", () => {
  assert.equal(
    rruleFromRoutine({ recurrence: "weekly", days_of_week: [1, 9, -2, 6] as number[], end_date: "" }),
    "FREQ=WEEKLY;BYDAY=MO,SA",
  );
});

// ── Reading ─────────────────────────────────────────────────────────────────

test("a rule ROME wrote reads back as the same routine", () => {
  const written = rruleFromRoutine({ recurrence: "weekly", days_of_week: [1, 3, 5], end_date: "2026-08-31" });
  const rule = routineFromRrule(written)!;
  assert.equal(rule.recurrence, "weekly");
  assert.deepEqual(rule.daysOfWeek, [1, 3, 5]);
  assert.equal(rule.until, "2026-08-31", "the inclusive end date survives the UTC round trip");
});

test("FREQ=DAILY;BYDAY=… is accepted and normalised to weekly", () => {
  // Legal, means exactly what a weekly routine means, and refusing it would
  // push a perfectly representable routine into the read-only bucket.
  const rule = routineFromRrule("FREQ=DAILY;BYDAY=TU,TH")!;
  assert.equal(rule.recurrence, "weekly");
  assert.deepEqual(rule.daysOfWeek, [2, 4]);
});

test("WKST is ignored rather than refused", () => {
  assert.ok(readRrule("FREQ=WEEKLY;BYDAY=MO;WKST=SU").ok);
});

test("INTERVAL=1 is accepted; any other interval is not", () => {
  assert.ok(readRrule("FREQ=DAILY;INTERVAL=1").ok);
  const refused = readRrule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO");
  assert.equal(refused.ok, false);
  assert.match((refused as { reason: string }).reason, /every 2/);
});

test("a bare date UNTIL is accepted, as servers emit for all-day events", () => {
  assert.equal(untilToLocalDate("20260831"), "2026-08-31");
  assert.equal(routineFromRrule("FREQ=DAILY;UNTIL=20260831")!.until, "2026-08-31");
});

test("UNTIL round-trips through both directions", () => {
  assert.equal(untilToLocalDate(localDateToUntil("2026-01-15")), "2026-01-15", "PST");
  assert.equal(untilToLocalDate(localDateToUntil("2026-07-15")), "2026-07-15", "PDT");
  assert.equal(localDateToUntil(""), "");
  assert.equal(untilToLocalDate(""), "");
});

// ── Refusals ────────────────────────────────────────────────────────────────

const REFUSED: Array<[string, RegExp]> = [
  ["FREQ=MONTHLY;BYDAY=-1FR", /monthly/],
  ["FREQ=YEARLY;BYMONTH=3", /BYMONTH|yearly/],
  ["FREQ=WEEKLY;BYDAY=1MO", /specific occurrence/],
  ["FREQ=DAILY;COUNT=10", /number of occurrences/],
  ["FREQ=MONTHLY;BYSETPOS=-1;BYDAY=FR", /monthly|BYSETPOS/],
  ["FREQ=WEEKLY;BYDAY=MO;BYMONTHDAY=1", /BYMONTHDAY/],
  ["FREQ=HOURLY", /hourly/],
  ["BYDAY=MO", /unnamed schedule/],
  ["", /no recurrence rule/],
];

for (const [rrule, reason] of REFUSED) {
  test(`refuses "${rrule || "(empty)"}" with a reason a person can read`, () => {
    const read = readRrule(rrule);
    assert.equal(read.ok, false, `${rrule} should not be representable`);
    assert.match((read as { reason: string }).reason, reason);
    assert.equal(routineFromRrule(rrule), null);
  });
}

test("an unrecognised weekday is refused, not silently dropped", () => {
  const read = readRrule("FREQ=WEEKLY;BYDAY=XX");
  assert.equal(read.ok, false);
  assert.match((read as { reason: string }).reason, /XX/);
});

test("WEEKLY with no BYDAY is readable but leaves the weekday to the caller", () => {
  // It means "the weekday DTSTART falls on", and this module has never seen
  // DTSTART. Answering with an empty day list is how it says so.
  const read = readRrule("FREQ=WEEKLY");
  assert.equal(read.ok, true);
  assert.deepEqual((read as { rule: { daysOfWeek: number[] } }).rule.daysOfWeek, []);
});
