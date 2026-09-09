/**
 * The sleep clock.
 *
 * Everything here is a rule about time that can only be observed by waiting,
 * which is why none of it is observed by waiting: the clock is a parameter.
 * The cases that matter are the ones nobody would test by hand — a period
 * spanning midnight, a nap too short to give the alarm its five minutes, and
 * an alarm that has to keep going after the period it belongs to has ended.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  ALARM_MAX_DB, ALARM_MIN_GAIN, ALARM_PEAK_GAIN, ALARM_RAMP_DB, DEFAULT_ALARM_VOICE,
  alarmGain, alarmLeadMs, alarmProgress, alarmStartsAt, dbToGain, describePeriod, gainToDb,
  normalizePeriod, normalizeVoice, nextClockTime, parseClockTime, resolveSleep, sleepPhase,
  sleepStatus, spokenSpan, type SleepPeriod,
} from "@shared/sleepClock";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function period(overrides: Partial<SleepPeriod> = {}): SleepPeriod {
  const startsAt = overrides.startsAt ?? 1_000_000_000_000;
  return {
    id: "p1",
    label: "Sleep",
    startsAt,
    endsAt: startsAt + 8 * HOUR,
    kronosItemId: null,
    ringingSince: null,
    createdAt: startsAt,
    ...overrides,
  };
}

// ── Phases ──────────────────────────────────────────────────────────────────

test("a period set for later is armed, not running", () => {
  const p = period({ startsAt: 2_000 });
  assert.equal(sleepPhase(p, 1_000), "armed");
  assert.equal(sleepPhase(p, 2_000), "asleep");
});

test("the alarm starts five minutes before the end and never before", () => {
  const p = period();
  assert.equal(sleepPhase(p, p.endsAt - 5 * MINUTE - 1), "asleep");
  assert.equal(sleepPhase(p, p.endsAt - 5 * MINUTE), "ringing");
});

test("the alarm does not stop at the end of the period", () => {
  const p = period();
  // The whole point: nothing but a keypress ends this, so there is no later
  // time at which the phase goes quiet on its own.
  assert.equal(sleepPhase(p, p.endsAt), "ringing");
  assert.equal(sleepPhase(p, p.endsAt + 4 * HOUR), "ringing");
});

test("a nap too short for five minutes gets half of itself instead", () => {
  const p = period({ startsAt: 0, endsAt: 6 * MINUTE });
  assert.equal(alarmLeadMs(p), 3 * MINUTE);
  assert.equal(alarmStartsAt(p), 3 * MINUTE);
  // Otherwise a six-minute nap would ring for five of its six minutes.
  assert.equal(sleepPhase(p, 2 * MINUTE), "asleep");
  assert.equal(sleepPhase(p, 3 * MINUTE), "ringing");
});

test("no period at all is idle, and idle carries nothing", () => {
  assert.equal(sleepPhase(null, 1), "idle");
  assert.equal(sleepStatus(null, 1).period, null);
  assert.equal(sleepStatus(null, 1).alarmProgress, 0);
});

// ── The ramp ────────────────────────────────────────────────────────────────

test("progress runs 0 to 1 across the lead window and pins there", () => {
  const p = period();
  assert.equal(alarmProgress(p, alarmStartsAt(p)), 0);
  assert.equal(alarmProgress(p, alarmStartsAt(p) + 2.5 * MINUTE), 0.5);
  assert.equal(alarmProgress(p, p.endsAt), 1);
  assert.equal(alarmProgress(p, p.endsAt + HOUR), 1);
  assert.equal(alarmProgress(p, p.startsAt), 0);
});

test("the ramp is a constant-decibel climb, not a linear one", () => {
  assert.equal(alarmGain(0), ALARM_MIN_GAIN);
  assert.equal(alarmGain(1), ALARM_PEAK_GAIN);

  // Halfway through the five minutes should still be quiet. On a linear ramp
  // it would be at half volume, which spends most of the window already loud
  // — the opposite of waking someone gently and then insistently.
  const half = alarmGain(0.5);
  assert.ok(half < 0.2, `halfway should still be quiet, got ${half}`);
  assert.ok(Math.abs(half - Math.sqrt(ALARM_MIN_GAIN * ALARM_PEAK_GAIN)) < 1e-9);

  let previous = 0;
  for (let step = 0; step <= 20; step += 1) {
    const value = alarmGain(step / 20);
    assert.ok(value > previous, "the ramp must never go backwards");
    previous = value;
  }
});

test("progress outside the window cannot push the gain out of range", () => {
  assert.equal(alarmGain(-5), ALARM_MIN_GAIN);
  assert.equal(alarmGain(9), ALARM_PEAK_GAIN);
});

// ── The peak, and the scale the editor speaks in ────────────────────────────

test("lowering the peak lowers the whole curve rather than flattening it", () => {
  const peak = dbToGain(65);
  assert.ok(Math.abs(alarmGain(1, peak) - peak) < 1e-12, "the climb still ends at the peak");

  // The ramp is a fixed range *below* the peak, so the climb is the same climb
  // whatever it is set to. A fixed floor instead would give a quiet peak almost
  // no ramp — it would start most of the way up and the first four minutes
  // would do nothing at all.
  const quiet = alarmGain(0, peak) / alarmGain(1, peak);
  const loud = alarmGain(0, ALARM_PEAK_GAIN) / alarmGain(1, ALARM_PEAK_GAIN);
  assert.ok(Math.abs(quiet - loud) < 1e-12, "the same ratio start to finish");
  assert.ok(Math.abs(20 * Math.log10(quiet) + ALARM_RAMP_DB) < 1e-9, "and it is ALARM_RAMP_DB wide");
});

test("the dB scale is a true relative scale with 85 at full output", () => {
  assert.equal(dbToGain(ALARM_MAX_DB), 1);
  assert.ok(Math.abs(dbToGain(65) - 0.1) < 1e-12, "twenty decibels down is a tenth");
  assert.ok(Math.abs(dbToGain(45) - 0.01) < 1e-12);
  // Clamped, so a value stored by a build with a wider range cannot produce a
  // gain above unity and clip the whole bus.
  assert.equal(dbToGain(120), 1);
  assert.equal(dbToGain(0), dbToGain(45));
  for (const db of [45, 58, 72, 85]) {
    assert.ok(Math.abs(gainToDb(dbToGain(db)) - db) < 1e-9, `round trip at ${db}`);
  }
});

test("an unknown alarm voice falls back rather than ringing silently", () => {
  assert.equal(normalizeVoice("siren"), "siren");
  assert.equal(normalizeVoice("chime"), "chime");
  // A layout stored by a build whose voice this one has since renamed. Left
  // alone it would schedule `undefined` and the alarm would make no sound.
  assert.equal(normalizeVoice("foghorn"), DEFAULT_ALARM_VOICE);
  assert.equal(normalizeVoice(undefined), DEFAULT_ALARM_VOICE);
  assert.equal(normalizeVoice(7), DEFAULT_ALARM_VOICE);
});

// ── Reading a time ──────────────────────────────────────────────────────────

test("clock times are read strictly", () => {
  assert.equal(parseClockTime("7"), 7 * 60);
  assert.equal(parseClockTime("07:00"), 7 * 60);
  assert.equal(parseClockTime("23:30"), 23 * 60 + 30);
  assert.equal(parseClockTime(" 6:05 "), 6 * 60 + 5);
  // Waking someone twelve hours late is the failure this is strict about.
  assert.equal(parseClockTime("25:00"), null);
  assert.equal(parseClockTime("7:75"), null);
  assert.equal(parseClockTime("7pm"), null);
  assert.equal(parseClockTime("half seven"), null);
  assert.equal(parseClockTime(""), null);
});

test("the next seven o'clock is strictly after the moment asked", () => {
  const sevenToday = new Date(2026, 8, 9, 7, 0, 0, 0).getTime();
  const sixThirty = new Date(2026, 8, 9, 6, 30, 0, 0).getTime();
  assert.equal(nextClockTime(7 * 60, sixThirty), sevenToday);

  // Asked at exactly seven, seven means tomorrow — an alarm that has already
  // finished is not an alarm.
  const tomorrow = new Date(2026, 8, 10, 7, 0, 0, 0).getTime();
  assert.equal(nextClockTime(7 * 60, sevenToday), tomorrow);
});

// ── Turning a sentence into two instants ────────────────────────────────────

test("a duration with no start time begins now", () => {
  const now = new Date(2026, 8, 9, 23, 0, 0, 0).getTime();
  const resolved = resolveSleep({ durationMinutes: 480 }, now);
  assert.equal(resolved.startsAt, now);
  assert.equal(resolved.endsAt, now + 8 * HOUR);
  assert.equal(resolved.label, "Sleep");
});

test("a wake time is anchored to the start, not to now", () => {
  const now = new Date(2026, 8, 9, 21, 0, 0, 0).getTime();
  // "Bedtime at half eleven, up at seven" is seven and a half hours. Anchored
  // to `now` instead, the seven o'clock would be tomorrow's and the period
  // would come out ten hours long.
  const resolved = resolveSleep({ startTime: "23:30", endTime: "07:00" }, now);
  assert.equal(resolved.startsAt, new Date(2026, 8, 9, 23, 30).getTime());
  assert.equal(resolved.endsAt, new Date(2026, 8, 10, 7, 0).getTime());
  assert.equal(resolved.endsAt - resolved.startsAt, 7.5 * HOUR);
});

test("a period that crosses midnight is just a period", () => {
  const now = new Date(2026, 8, 9, 23, 45, 0, 0).getTime();
  const resolved = resolveSleep({ endTime: "06:15" }, now);
  assert.equal(resolved.endsAt, new Date(2026, 8, 10, 6, 15).getTime());
  assert.ok(resolved.endsAt > resolved.startsAt);
});

test("a wake time wins over a duration when both are given", () => {
  const now = new Date(2026, 8, 9, 22, 0, 0, 0).getTime();
  const resolved = resolveSleep({ endTime: "06:00", durationMinutes: 30 }, now);
  assert.equal(resolved.endsAt, new Date(2026, 8, 10, 6, 0).getTime());
});

test("a period with no end is refused rather than never rung", () => {
  const now = Date.now();
  assert.throws(() => resolveSleep({}, now), /when to wake|how long/i);
  assert.throws(() => resolveSleep({ startTime: "23:30" }, now), /when to wake|how long/i);
});

test("times it could not read, and spans nobody meant, are refused", () => {
  const now = Date.now();
  assert.throws(() => resolveSleep({ endTime: "quarter past" }, now), /could not read/i);
  assert.throws(() => resolveSleep({ startTime: "99:00", durationMinutes: 60 }, now), /could not read/i);
  assert.throws(() => resolveSleep({ durationMinutes: 0 }, now), /how long|when to wake/i);
  // Rounds to nothing, so it is not a length at all rather than a short one.
  assert.throws(() => resolveSleep({ durationMinutes: 0.2 }, now), /how long/i);
  assert.throws(() => resolveSleep({ durationMinutes: 60 * 30 }, now), /longer than a day/i);

  // A wake time thirty seconds away is the one way to ask for a period too
  // short to be one.
  const almostSeven = new Date(2026, 8, 9, 6, 59, 30).getTime();
  assert.throws(() => resolveSleep({ endTime: "07:00" }, almostSeven), /under a minute/i);
});

test("the label is kept, trimmed, and never empty", () => {
  const now = Date.now();
  assert.equal(resolveSleep({ durationMinutes: 30, label: "  Nap " }, now).label, "Nap");
  assert.equal(resolveSleep({ durationMinutes: 30, label: "   " }, now).label, "Sleep");
});

// ── Reading back what was stored ────────────────────────────────────────────

test("a stored period is accepted, and a nonsensical one is not", () => {
  const stored = normalizePeriod({ id: "x", label: "Nap", startsAt: 10, endsAt: 20 });
  assert.equal(stored?.endsAt, 20);
  assert.equal(stored?.kronosItemId, null);
  assert.equal(stored?.ringingSince, null);

  assert.equal(normalizePeriod(null), null);
  assert.equal(normalizePeriod({ startsAt: 20, endsAt: 10 }), null);
  assert.equal(normalizePeriod({ startsAt: 10 }), null);
  assert.equal(normalizePeriod("asleep"), null);
});

test("what she says depends on which phase it is in", () => {
  const start = new Date(2026, 8, 9, 23, 30).getTime();
  const p = period({ startsAt: start, endsAt: new Date(2026, 8, 10, 7, 0).getTime() });

  assert.match(describePeriod(p, start - HOUR), /set for/i);
  assert.match(describePeriod(p, start + HOUR), /until/i);
  // Ringing says the one thing that is actionable and nothing else.
  assert.match(describePeriod(p, p.endsAt), /Tab/);
});

test("spans are spoken, not printed", () => {
  assert.equal(spokenSpan(30 * MINUTE), "30 minutes");
  assert.equal(spokenSpan(HOUR), "1 hour");
  assert.equal(spokenSpan(7.5 * HOUR), "7 hours and 30 minutes");
  assert.equal(spokenSpan(0), "0 minutes");
});
