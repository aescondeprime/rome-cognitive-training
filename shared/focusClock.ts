/**
 * The focus clock — the arithmetic, on its own.
 *
 * Pausing and extending make "how long is left?" less obvious than it looks:
 * paused time cannot count against the cycle, a cycle that has run out stops
 * counting entirely while it waits to be answered, and an extension granted
 * five minutes after the bell must not have those five minutes taken out of it.
 * All of that is here, pure and testable, rather than inside a React component
 * where it can only be checked by watching a clock for twenty-five minutes.
 */

export interface FocusTimer {
  startedAt: number;
  /** Total planned seconds, including every extension. */
  durationSeconds: number;
  kronosAssignmentId: number | null;
  /** When the clock was paused, or null while it runs. */
  pausedAt: number | null;
  /** Total time spent paused, so a pause does not eat the cycle. */
  pausedMs: number;
  /**
   * When the clock reached zero.
   *
   * The cycle is not over at zero — it is *waiting on an answer*. Auto-
   * completing there quietly marked tasks done that were abandoned halfway,
   * which is worse than asking.
   */
  endedAt: number | null;
  /** What has already been said aloud, so a reload does not repeat it. */
  announced: { five?: boolean; one?: boolean; done?: boolean; nudge?: boolean };
}

/** Accept a timer written by any earlier version, or reject it as absent. */
export function normalizeTimer(value: any): FocusTimer | null {
  if (!value || typeof value !== "object") return null;
  const startedAt = Number(value.startedAt);
  const durationSeconds = Number(value.durationSeconds);
  if (!Number.isFinite(startedAt) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
  return {
    startedAt,
    durationSeconds,
    kronosAssignmentId: typeof value.kronosAssignmentId === "number" ? value.kronosAssignmentId : null,
    pausedAt: typeof value.pausedAt === "number" ? value.pausedAt : null,
    pausedMs: Number.isFinite(Number(value.pausedMs)) ? Math.max(0, Number(value.pausedMs)) : 0,
    endedAt: typeof value.endedAt === "number" ? value.endedAt : null,
    announced: value.announced && typeof value.announced === "object" ? { ...value.announced } : {},
  };
}

export function elapsedSeconds(timer: FocusTimer, now = Date.now()): number {
  const stoppedAt = timer.pausedAt ?? timer.endedAt ?? now;
  return Math.max(0, Math.floor((stoppedAt - timer.startedAt - timer.pausedMs) / 1000));
}

export function remainingSeconds(timer: FocusTimer, now = Date.now()): number {
  return Math.max(0, timer.durationSeconds - elapsedSeconds(timer, now));
}

/**
 * Add or remove time.
 *
 * Signed, so undoing an extension is the same operation in reverse. Two rules
 * it exists to keep: a cycle can never be shortened below where the clock
 * already is, and time added after the bell starts from now rather than from
 * the moment it rang — otherwise the minutes spent answering "no, I need
 * longer" come straight back out of the extension.
 */
export function extendTimer(timer: FocusTimer, minutes: number, now = Date.now()): FocusTimer {
  const added = Math.round(minutes) * 60;
  if (!added) return timer;
  const reopening = added > 0 && timer.endedAt !== null;
  return {
    ...timer,
    durationSeconds: Math.max(elapsedSeconds(timer, now) + 30, timer.durationSeconds + added),
    pausedMs: reopening ? timer.pausedMs + Math.max(0, now - (timer.endedAt ?? now)) : timer.pausedMs,
    endedAt: added > 0 ? null : timer.endedAt,
    announced: added > 0 ? { ...timer.announced, five: false, one: false, done: false, nudge: false } : timer.announced,
  };
}

/** "twenty-four minutes", spoken rather than displayed. */
export function spokenRemaining(seconds: number): string {
  if (seconds <= 0) return "no time";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 1) return `${rest} second${rest === 1 ? "" : "s"}`;
  if (minutes < 3 && rest > 5) return `${minutes} minute${minutes === 1 ? "" : "s"} and ${rest} seconds`;
  return `${minutes + (rest >= 30 ? 1 : 0)} minutes`;
}

/** "24:13", for the clock on screen. */
export function formatRemaining(seconds: number): string {
  const safe = Math.max(0, seconds);
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}
