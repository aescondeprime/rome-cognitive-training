/**
 * Alerts — the notification the calendar fires before an item starts.
 *
 * The renderer's half. An alert becomes a VALARM in the iCalendar body when
 * the item syncs, which is why the phone rings: it is ordinary calendar data,
 * not something ROME delivers itself. Nothing fires until an item has been
 * sent to iCloud.
 *
 * Stored as minutes-before, comma-separated, in one `alerts` text column —
 * `"15,1440"` is fifteen minutes and one day. `0` is at the time of the item;
 * `""` is no alert, which is what every item created before this feature has
 * and what every new one starts as.
 *
 * **This file is mirrored by `electron/kronos/alerts.ts`** — `electron/` cannot
 * import from `client/`, so the preset list and the parser exist twice, and a
 * test in `electron/kronos/__tests__/` asserts they have not drifted. A preset
 * added on one side and not the other is a value the user can pick and the
 * engine will not send.
 */

/** Apple Calendar's own menu, in minutes before the start. */
export const ALERT_PRESETS = [0, 5, 15, 30, 60, 120, 1440, 2880, 10080] as const;

/** Matching Apple's "alert" and "second alert". */
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
    if (value < 0 || value > 10080 * 8) continue;
    seen.add(value);
  }
  return Array.from(seen).sort((a, b) => a - b).slice(0, MAX_ALERTS);
}

export function writeAlerts(minutes: number[]): string {
  return normalizeAlerts(minutes).join(",");
}

/** "15 minutes before · 1 day before", or "" — the one-line summary on a row. */
export function alertSummary(value: unknown): string {
  return readAlerts(value).map(alertLabel).join(" · ");
}
