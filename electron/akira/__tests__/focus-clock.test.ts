import test from "node:test";
import assert from "node:assert/strict";
import {
  elapsedSeconds, extendTimer, formatRemaining, normalizeTimer, remainingSeconds, spokenRemaining,
  type FocusTimer,
} from "../../../shared/focusClock";

const T0 = 1_700_000_000_000;

const timer = (overrides: Partial<FocusTimer> = {}): FocusTimer => ({
  startedAt: T0,
  durationSeconds: 25 * 60,
  kronosAssignmentId: null,
  pausedAt: null,
  pausedMs: 0,
  endedAt: null,
  announced: {},
  ...overrides,
});

test("the clock counts down while it runs", () => {
  const t = timer();
  assert.equal(remainingSeconds(t, T0), 1500);
  assert.equal(remainingSeconds(t, T0 + 60_000), 1440);
  assert.equal(remainingSeconds(t, T0 + 3_000_000), 0);
});

test("paused time does not come out of the cycle", () => {
  // Paused at ten minutes: the clock reads the same an hour later.
  const paused = timer({ pausedAt: T0 + 600_000 });
  assert.equal(remainingSeconds(paused, T0 + 600_000), 900);
  assert.equal(remainingSeconds(paused, T0 + 4_200_000), 900);

  // Resumed after that hour, the pause is banked rather than charged.
  const resumed = timer({ pausedAt: null, pausedMs: 3_600_000 });
  assert.equal(remainingSeconds(resumed, T0 + 4_200_000), 900);
});

test("a cycle that ran out stops counting while it waits for an answer", () => {
  const ended = timer({ endedAt: T0 + 1_500_000 });
  assert.equal(remainingSeconds(ended, T0 + 1_500_000), 0);
  assert.equal(elapsedSeconds(ended, T0 + 9_000_000), 1500);
});

test("time added after the bell starts from now, not from when it rang", () => {
  const ended = timer({ endedAt: T0 + 1_500_000 });
  // Five minutes pass while the user decides, then they ask for ten more.
  const extended = extendTimer(ended, 10, T0 + 1_800_000);
  assert.equal(extended.endedAt, null);
  // Ten real minutes left, not five: the deliberation is not charged to it.
  assert.equal(remainingSeconds(extended, T0 + 1_800_000), 600);
  // And the warnings are re-armed for the new stretch.
  assert.deepEqual(extended.announced, { five: false, one: false, done: false, nudge: false });
});

test("an extension can be taken back, but never below the current clock", () => {
  const running = timer();
  const longer = extendTimer(running, 10, T0 + 60_000);
  assert.equal(remainingSeconds(longer, T0 + 60_000), 2040);

  const undone = extendTimer(longer, -10, T0 + 60_000);
  assert.equal(undone.durationSeconds, running.durationSeconds);
  // Taking time back re-arms nothing: nothing new was granted.
  assert.deepEqual(undone.announced, longer.announced);

  // Twenty minutes in, removing an hour cannot rewind the cycle into the past.
  const clipped = extendTimer(running, -60, T0 + 1_200_000);
  assert.equal(clipped.durationSeconds, 1230);
  assert.equal(remainingSeconds(clipped, T0 + 1_200_000), 30);
});

test("a timer written before pausing existed still loads", () => {
  const legacy = normalizeTimer({ startedAt: T0, durationSeconds: 900, kronosAssignmentId: 4 });
  assert.ok(legacy);
  assert.equal(legacy!.pausedMs, 0);
  assert.equal(legacy!.pausedAt, null);
  assert.equal(legacy!.endedAt, null);
  assert.deepEqual(legacy!.announced, {});
  assert.equal(remainingSeconds(legacy!, T0 + 300_000), 600);

  assert.equal(normalizeTimer(null), null);
  assert.equal(normalizeTimer({ startedAt: T0, durationSeconds: 0 }), null);
});

test("time is spoken the way a person would say it", () => {
  assert.equal(spokenRemaining(1500), "25 minutes");
  assert.equal(spokenRemaining(1470), "25 minutes");
  assert.equal(spokenRemaining(100), "1 minute and 40 seconds");
  assert.equal(spokenRemaining(45), "45 seconds");
  assert.equal(spokenRemaining(0), "no time");
  assert.equal(formatRemaining(1500), "25:00");
  assert.equal(formatRemaining(-5), "00:00");
});
