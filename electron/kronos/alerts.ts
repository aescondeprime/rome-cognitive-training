/**
 * Alerts — the notification a calendar fires before an item starts.
 *
 * An alert is a VALARM inside the VEVENT, which means it is ordinary
 * iCalendar and syncs like everything else: set one here, and the phone that
 * subscribes to this calendar rings.
 *
 * ROME stores them as **minutes before the start**, comma-separated, in one
 * `alerts` text column — `"15,1440"` is fifteen minutes and one day. `0` means
 * at the time of the item. An empty string means no alert, which is what
 * everything created before this feature has, and it reads correctly without a
 * migration of the data.
 *
 * Kept deliberately dumb: a list of small integers has no timezone, no
 * ambiguity, and survives being read by the renderer, the server and this
 * engine without any of them agreeing on a library. The same list exists in
 * `client/src/lib/kronosAlerts.ts` — `electron/` cannot import from `client/` —
 * and a test asserts the two have not drifted.
 */

/** Apple Calendar's own menu, in minutes before the start. */
export const ALERT_PRESETS = [0, 5, 15, 30, 60, 120, 1440, 2880, 10080] as const;

/** No more than this many per item — matching Apple's "alert" + "second alert". */
export const MAX_ALERTS = 2;

export function alertLabel(minutes: number): string {
  if (minutes <= 0) return "At time of item";
  if (minutes % 10080 === 0) return plural(minutes / 10080, "week");
  if (minutes % 1440 === 0) return plural(minutes / 1440, "day");
  if (minutes % 60 === 0) return plural(minutes / 60, "hour");
  return plural(minutes, "minute");
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"} before`;
}

/**
 * The stored column → a clean list.
 *
 * Tolerant on the way in because this column is edited by three different
 * writers and read by a sync engine: anything unparseable is dropped rather
 * than crashing a cycle, duplicates collapse, and the result is sorted so two
 * equivalent spellings produce byte-identical iCalendar and do not look like an
 * edit to the change detector.
 */
export function readAlerts(value: unknown): number[] {
  if (Array.isArray(value)) return normalizeAlerts(value.map(Number));
  // The empty parts must be dropped *before* Number sees them: `Number("")` is
  // 0, and 0 is a real alert ("at time of item"). Without this every row with
  // an empty column — which is every row that existed before alerts did —
  // silently acquires an alarm on its next push.
  return normalizeAlerts(
    String(value ?? "").split(",").map(part => part.trim()).filter(Boolean).map(Number),
  );
}

export function normalizeAlerts(minutes: number[]): number[] {
  const seen = new Set<number>();
  for (const raw of minutes) {
    if (!Number.isFinite(raw)) continue;
    const value = Math.round(raw);
    // A negative offset would be an alarm *after* the start, which is not
    // something this UI can express and not something a reminder is for.
    if (value < 0 || value > 10080 * 8) continue;
    seen.add(value);
  }
  return Array.from(seen).sort((a, b) => a - b).slice(0, MAX_ALERTS);
}

/** A clean list → the stored column. */
export function writeAlerts(minutes: number[]): string {
  return normalizeAlerts(minutes).join(",");
}

/**
 * Minutes before → an iCalendar TRIGGER value.
 *
 * Emitted in the largest whole unit that fits, because Apple's UI reads the
 * duration back and shows "1 day before" for `-P1D` but "Custom" for the
 * equally-correct `-PT1440M`. The wire format decides what the user sees when
 * they open the event on their phone.
 */
export function triggerFor(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m === 0) return "-PT0S";
  if (m % 10080 === 0) return `-P${m / 10080}W`;
  if (m % 1440 === 0) return `-P${m / 1440}D`;
  if (m % 60 === 0) return `-PT${m / 60}H`;
  return `-PT${m}M`;
}

const DURATION = /^([+-]?)P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

/**
 * An iCalendar TRIGGER value → minutes before, or null.
 *
 * Null for anything ROME cannot represent: a trigger that fires *after* the
 * start, and `VALUE=DATE-TIME` triggers, which are an absolute instant rather
 * than an offset. Those belong to whoever wrote them and are left alone.
 */
export function minutesFromTrigger(value: string): number | null {
  const raw = String(value ?? "").trim().toUpperCase();
  const m = DURATION.exec(raw);
  if (!m) return null;
  if (m[1] !== "-" && raw !== "P" && !/^[-]/.test(raw)) {
    // A positive (or unsigned) duration is an offset *after* DTSTART.
    const total = weeks(m);
    return total === 0 ? 0 : null;
  }
  return weeks(m);
}

function weeks(m: RegExpExecArray): number {
  const w = Number(m[2] ?? 0), d = Number(m[3] ?? 0);
  const h = Number(m[4] ?? 0), mi = Number(m[5] ?? 0), s = Number(m[6] ?? 0);
  return w * 10080 + d * 1440 + h * 60 + mi + Math.round(s / 60);
}
