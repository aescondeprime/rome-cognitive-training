/**
 * The sleep period — one at a time, stored where the focus cycle is stored.
 *
 * Same shape as `focusSession.ts` and for the same reason: four things care
 * about whether a period is running, and none of them can own it. The top bar
 * draws the moon, the wake word has to go quiet, the alarm has to ring whether
 * or not any of that is on screen, and Akira sets and cancels periods by voice.
 *
 * What is deliberately *not* here is a countdown. A focus cycle is twenty-five
 * minutes and you watch the clock; a sleep period is nine hours and watching it
 * is the opposite of the point. The period is drawn on the Kronos calendar,
 * where a nine-hour block belongs, and nowhere else — and it is removed from
 * there the moment you wake, because a block that says you are asleep is a lie
 * the instant you are not.
 */

import {
  IDLE_SLEEP, normalizePeriod, resolveSleep, sleepPhase as phaseOf, sleepStatus as computeStatus,
  type SleepPeriod, type SleepRequest, type SleepStatus,
} from "@shared/sleepClock";
import { apiRequest } from "@/lib/queryClient";

export {
  IDLE_SLEEP, alarmGain, alarmProgress, alarmStartsAt, clockLabel, describePeriod, sleepPhase,
  spokenSpan, type SleepPeriod, type SleepPhase, type SleepStatus,
} from "@shared/sleepClock";

/** The colour a sleep block takes on the calendar. Indigo: nothing else uses it. */
const SLEEP_COLOR = "hsl(248 45% 58%)";

export function storageKey(profileId: number | undefined): string {
  return `rome_sleep_v1:${profileId ?? "default"}`;
}

export function readPeriod(profileId: number | undefined): SleepPeriod | null {
  try {
    return normalizePeriod(JSON.parse(localStorage.getItem(storageKey(profileId)) ?? "null"));
  } catch {
    return null;
  }
}

export function writePeriod(profileId: number | undefined, period: SleepPeriod | null): void {
  if (period) localStorage.setItem(storageKey(profileId), JSON.stringify(period));
  else localStorage.removeItem(storageKey(profileId));
  window.dispatchEvent(new CustomEvent("rome:sleep:refresh"));
}

export function sleepStatus(profileId: number | undefined, now = Date.now()): SleepStatus {
  return computeStatus(readPeriod(profileId), now);
}

function localDateStr(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localTimeStr(at: number): string {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function notifyKronos(): void {
  window.dispatchEvent(new CustomEvent("rome:kronos:refresh"));
}

async function ensureCalendarId(): Promise<number | null> {
  try {
    const existing = await apiRequest("GET", "/api/kronos/calendars").then(r => r.json());
    if (Array.isArray(existing) && existing[0]?.id) return Number(existing[0].id);
    const created = await apiRequest("POST", "/api/kronos/calendars", { name: "My Calendar" }).then(r => r.json());
    return created?.id ? Number(created.id) : null;
  } catch {
    return null;
  }
}

/**
 * Set or start a period.
 *
 * One at a time. A second one is refused rather than silently replacing the
 * first: "sleep until seven" said twice by someone half asleep should not
 * quietly move an alarm they already set.
 *
 * The clock is authoritative the moment this returns; the calendar block is
 * attached afterwards and never awaited, for the reason `startFocus` learned —
 * a Supabase round trip between "knock out" and anything happening is long
 * enough for Akira to report the action as still running.
 */
export function setSleep(
  profileId: number | undefined,
  request: SleepRequest,
  now = Date.now(),
): SleepPeriod {
  const existing = readPeriod(profileId);
  if (existing && phaseOf(existing, now) !== "idle") {
    throw new Error("A sleep period is already set. Cancel it first if you want a different one.");
  }
  // A period the clock has given up on is cleared rather than overwritten, so
  // its calendar block goes with it instead of being orphaned by the new one
  // taking its place in storage.
  if (existing) cancelSleep(profileId);
  const resolved = resolveSleep(request, now);
  const period: SleepPeriod = {
    id: crypto.randomUUID(),
    label: resolved.label,
    startsAt: resolved.startsAt,
    endsAt: resolved.endsAt,
    kronosItemId: null,
    ringingSince: null,
    createdAt: now,
  };
  writePeriod(profileId, period);
  void attachCalendarBlock(profileId, period);
  return period;
}

/**
 * Draw the period on the calendar, after the fact.
 *
 * A **General** rather than an assignment: sleep is not work with a deadline,
 * and the neutral type is what the fourth one exists for. Kronos stores a day
 * plus a start time plus a duration, and a duration that runs past midnight is
 * already how a 23:30 item ending at 00:15 is represented — so a period that
 * crosses into tomorrow needs nothing special.
 *
 * Abandoned if the period was cancelled while this was in flight: a calendar
 * block for a period that no longer exists is worse than no block at all.
 */
async function attachCalendarBlock(profileId: number | undefined, period: SleepPeriod): Promise<void> {
  try {
    const calendarId = await ensureCalendarId();
    if (!calendarId) return;
    const minutes = Math.max(1, Math.round((period.endsAt - period.startsAt) / 60_000));
    const response = await apiRequest("POST", `/api/kronos/calendars/${calendarId}/generals`, {
      title: period.label,
      color: SLEEP_COLOR,
      start_time: localTimeStr(period.startsAt),
      duration_minutes: minutes,
      item_date: localDateStr(period.startsAt),
      notes: "Sleep period · removed from the calendar when you wake",
      saved: false,
    });
    const created = await response.json();
    const id = created?.id ?? null;
    if (id === null) return;
    const current = readPeriod(profileId);
    if (current?.id !== period.id || current.kronosItemId !== null) return;
    writePeriod(profileId, { ...current, kronosItemId: Number(id) });
    notifyKronos();
  } catch { /* the period runs offline */ }
}

/** Remember that the alarm has started, so a reload resumes the ramp rather than restarting it. */
export function markRinging(profileId: number | undefined, at = Date.now()): void {
  const period = readPeriod(profileId);
  if (!period || period.ringingSince !== null) return;
  writePeriod(profileId, { ...period, ringingSince: at });
}

/**
 * Take the block off the calendar.
 *
 * Failure is not surfaced. Waking up has already happened by the time this
 * runs, and an error toast about a calendar row is not what anyone needs at
 * that moment; the row is orphaned at worst, and the next iCloud sweep will
 * name it.
 */
async function removeCalendarBlock(period: SleepPeriod | null): Promise<void> {
  if (!period?.kronosItemId) return;
  try {
    await apiRequest("DELETE", `/api/kronos/generals/${period.kronosItemId}`);
    notifyKronos();
  } catch { /* left for the sweep */ }
}

export interface WakeResult {
  woke: boolean;
  label: string;
  /** How long the period actually ran, end to end. */
  sleptMs: number;
  /** How far past the wake time the alarm was left going. */
  overslept: number;
}

/**
 * End the period — the Tab key, and the only thing that stops the alarm.
 *
 * Removing the calendar block is part of waking rather than a tidy-up
 * afterwards, because the block is a claim about the present tense.
 */
export function wakeNow(profileId: number | undefined, now = Date.now()): WakeResult {
  const period = readPeriod(profileId);
  if (!period) return { woke: false, label: "", sleptMs: 0, overslept: 0 };
  writePeriod(profileId, null);
  void removeCalendarBlock(period);
  return {
    woke: true,
    label: period.label,
    sleptMs: Math.max(0, now - period.startsAt),
    overslept: Math.max(0, now - period.endsAt),
  };
}

/** Call the whole thing off, whether it had begun or not. */
export function cancelSleep(profileId: number | undefined): { cancelled: boolean; label: string } {
  const period = readPeriod(profileId);
  if (!period) return { cancelled: false, label: "" };
  writePeriod(profileId, null);
  void removeCalendarBlock(period);
  return { cancelled: true, label: period.label };
}

/** Move the wake time of a period already set — "give me another twenty minutes". */
export function extendSleep(profileId: number | undefined, minutes: number): SleepPeriod {
  const period = readPeriod(profileId);
  if (!period) throw new Error("No sleep period is set.");
  const added = Math.round(minutes) * 60_000;
  if (!added) throw new Error("Say how many minutes to add.");
  const endsAt = period.endsAt + added;
  if (endsAt <= Date.now()) throw new Error("That would put the wake time in the past.");
  const next = { ...period, endsAt, ringingSince: null };
  writePeriod(profileId, next);
  if (period.kronosItemId) {
    void apiRequest("PATCH", `/api/kronos/generals/${period.kronosItemId}`, {
      duration_minutes: Math.max(1, Math.round((endsAt - period.startsAt) / 60_000)),
    }).then(notifyKronos).catch(() => undefined);
  }
  return next;
}

/** Whether the wake word should be listening. Exported for the one place that asks. */
export function wakeWordSuppressed(status: SleepStatus): boolean {
  return status.phase === "asleep";
}
