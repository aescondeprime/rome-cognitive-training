/**
 * RRULE ↔ Kronos routine, over a two-case grammar and an honest refusal.
 *
 * A Kronos routine is either "every day" or "every week on these weekdays",
 * bounded by a start/end date window. RFC 5545 recurrence is enormously more
 * expressive than that — monthly by set position, yearly by week number,
 * intervals, counts, exception dates. This module translates the two cases ROME
 * can represent and **refuses everything else by name**.
 *
 * The refusal is the important half. An RRULE that gets silently approximated
 * turns "last Friday of the month" into "every Friday" in the user's real
 * calendar, on their phone, and the first they know about it is twenty-six
 * spurious events. `readRrule` returns a reason instead, the engine stores the
 * event as `foreign`, and ROME shows it without ever pushing it back.
 *
 * No expansion library is needed anywhere: `itemsForDate` in `KronosKeep.tsx`
 * already walks days and asks "does this routine fall here?", which is the only
 * expansion the app performs.
 */

export interface RoutineRule {
  recurrence: "daily" | "weekly";
  /** 0 = Sunday. Empty for a daily rule. */
  daysOfWeek: number[];
  /** Local `"YYYY-MM-DD"`, inclusive. Empty when the rule is unbounded. */
  until: string;
}

export type RruleReading =
  | { ok: true; rule: RoutineRule }
  | { ok: false; reason: string };

/** RFC 5545 weekday codes, indexed so the array position is the JS weekday. */
export const BYDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/**
 * Parts ROME understands. Anything outside this set means the rule describes
 * something Kronos has no way to store, and is grounds for refusal rather than
 * for dropping the part and carrying on.
 */
const KNOWN_PARTS = new Set(["FREQ", "UNTIL", "INTERVAL", "BYDAY", "WKST", "COUNT"]);

export function parseRruleParts(rrule: string): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const chunk of String(rrule ?? "").split(";")) {
    const eq = chunk.indexOf("=");
    if (eq === -1) continue;
    const key = chunk.slice(0, eq).trim().toUpperCase();
    if (key) parts[key] = chunk.slice(eq + 1).trim();
  }
  return parts;
}

/**
 * Read an RRULE into a Kronos routine, or say why it cannot be one.
 *
 * `FREQ=DAILY;BYDAY=MO,WE` is accepted and normalised to weekly — it means the
 * same thing, and refusing a rule ROME can represent perfectly would push a
 * plain weekly routine into the read-only `foreign` bucket for no reason.
 */
export function readRrule(rrule: string): RruleReading {
  const raw = String(rrule ?? "").trim();
  if (!raw) return { ok: false, reason: "no recurrence rule" };

  const parts = parseRruleParts(raw);

  for (const key of Object.keys(parts)) {
    if (!KNOWN_PARTS.has(key)) {
      return { ok: false, reason: `uses ${key}, which Kronos routines cannot express` };
    }
  }

  const freq = (parts.FREQ ?? "").toUpperCase();
  if (freq !== "DAILY" && freq !== "WEEKLY") {
    return { ok: false, reason: `repeats ${freq ? freq.toLowerCase() : "on an unnamed schedule"}` };
  }

  if (parts.COUNT) {
    // A count is a different shape of bound from a date window: "twelve more
    // times" cannot be stored as an end date without knowing every occurrence.
    return { ok: false, reason: "ends after a number of occurrences rather than on a date" };
  }

  if (parts.INTERVAL && Number(parts.INTERVAL) !== 1) {
    return { ok: false, reason: `repeats every ${parts.INTERVAL} rather than every one` };
  }

  let daysOfWeek: number[] = [];
  if (parts.BYDAY) {
    for (const token of parts.BYDAY.split(",")) {
      const code = token.trim().toUpperCase();
      if (!code) continue;
      // "1MO" / "-1FR" — an ordinal within the period. Weekly-with-ordinal is
      // not a thing Kronos can place, and quietly dropping the ordinal would
      // turn "first Monday" into "every Monday".
      if (!/^[A-Z]{2}$/.test(code)) {
        return { ok: false, reason: `picks a specific occurrence (${code}) within the period` };
      }
      const index = BYDAY_CODES.indexOf(code);
      if (index === -1) return { ok: false, reason: `unrecognised weekday ${code}` };
      if (!daysOfWeek.includes(index)) daysOfWeek.push(index);
    }
    daysOfWeek.sort((a, b) => a - b);
  }

  if (freq === "WEEKLY" && daysOfWeek.length === 0) {
    // WEEKLY with no BYDAY means "the weekday DTSTART falls on". The caller
    // knows DTSTART and this module does not, so it is resolved there.
    return { ok: true, rule: { recurrence: "weekly", daysOfWeek: [], until: untilToLocalDate(parts.UNTIL) } };
  }

  const recurrence: "daily" | "weekly" = daysOfWeek.length > 0 ? "weekly" : "daily";
  return { ok: true, rule: { recurrence, daysOfWeek, until: untilToLocalDate(parts.UNTIL) } };
}

/** Convenience wrapper for callers that only care whether it worked. */
export function routineFromRrule(rrule: string): RoutineRule | null {
  const read = readRrule(rrule);
  return read.ok ? read.rule : null;
}

export interface RoutineRow {
  recurrence?: string | null;
  days_of_week?: number[] | null;
  start_date?: string | null;
  end_date?: string | null;
}

/**
 * A Kronos routine → an RRULE value (no `RRULE:` prefix).
 *
 * `UNTIL` is written as the UTC instant of 23:59:59 local on the window's last
 * day, because the window is inclusive and UNTIL is an instant. Getting this
 * wrong by a day is the classic recurrence bug and it only shows up on the
 * final occurrence, which nobody looks at until it is missing.
 *
 * A weekly routine with no days selected has no occurrences at all, so it is
 * written as daily rather than as a rule that means "the DTSTART weekday" — the
 * latter would invent a schedule the user did not choose.
 */
export function rruleFromRoutine(routine: RoutineRow): string {
  const days = Array.isArray(routine.days_of_week)
    ? routine.days_of_week.filter(d => Number.isInteger(d) && d >= 0 && d <= 6)
    : [];
  const weekly = String(routine.recurrence ?? "daily").toLowerCase() === "weekly" && days.length > 0;

  const parts = weekly
    ? [`FREQ=WEEKLY`, `BYDAY=${[...days].sort((a, b) => a - b).map(d => BYDAY_CODES[d]).join(",")}`]
    : [`FREQ=DAILY`];

  const until = localDateToUntil(routine.end_date);
  if (until) parts.push(`UNTIL=${until}`);

  return parts.join(";");
}

/** `"2026-08-31"` → `"20260901T065959Z"` (in UTC-7). Empty in, empty out. */
export function localDateToUntil(endDate: string | null | undefined): string {
  const date = String(endDate ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const [y, m, d] = date.split("-").map(Number);
  const ms = new Date(y, m - 1, d, 23, 59, 59, 0).getTime();
  const dt = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${dt.getUTCFullYear()}${p(dt.getUTCMonth() + 1)}${p(dt.getUTCDate())}` +
    `T${p(dt.getUTCHours())}${p(dt.getUTCMinutes())}${p(dt.getUTCSeconds())}Z`
  );
}

/**
 * The inverse. Accepts both the datetime form and the bare date form (which is
 * what a server emits when DTSTART is a VALUE=DATE), and always answers in the
 * reader's local zone, since that is the zone `end_date` is expressed in.
 */
export function untilToLocalDate(until: string | null | undefined): string {
  const value = String(until ?? "").trim();
  if (!value) return "";

  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (dateOnly) return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`;

  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (!m) return "";
  const [, ys, ms_, ds, hs, mins, ss, z] = m;
  const ms = z
    ? Date.UTC(+ys, +ms_ - 1, +ds, +hs, +mins, +ss)
    : new Date(+ys, +ms_ - 1, +ds, +hs, +mins, +ss).getTime();
  const dt = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}
