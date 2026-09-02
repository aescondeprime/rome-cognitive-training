/**
 * clockSettings — reading a clock in a chosen timezone, in 12- or 24-hour form.
 *
 * The important thing this module does *not* do is convert Kronos times.
 * Kronos stores a calendar day as `"YYYY-MM-DD"` and a start time as `"HH:MM"`,
 * deliberately never as a `Date` — see the note in `kronosTypes` — because a
 * scheduled item is a wall-clock intention ("anatomy at nine"), not an instant.
 * There is nothing to convert *from*, so changing the widget's zone changes the
 * clock and the date it shows, and leaves the agenda reading the times you
 * actually scheduled. `formatWallTime` therefore only ever restyles a string:
 * it never shifts it.
 */

export type ClockFormat = "12" | "24";

/** `null` means "whatever this machine is set to". */
export type ClockZone = string | null;

export const DEFAULT_CLOCK_FORMAT: ClockFormat = "12";

/**
 * A short list rather than the full IANA set.
 *
 * `Intl.supportedValuesOf("timeZone")` returns some four hundred entries, which
 * is a scrolling problem inside a 220px widget and a search box this widget has
 * no room for. These are the zones with real populations behind them, spread so
 * that most places are within an hour of one of them.
 */
export const CLOCK_ZONES: { id: string; label: string }[] = [
  { id: "Pacific/Honolulu",    label: "Honolulu" },
  { id: "America/Anchorage",   label: "Anchorage" },
  { id: "America/Los_Angeles", label: "Los Angeles" },
  { id: "America/Denver",      label: "Denver" },
  { id: "America/Chicago",     label: "Chicago" },
  { id: "America/New_York",    label: "New York" },
  { id: "America/Sao_Paulo",   label: "São Paulo" },
  { id: "UTC",                 label: "UTC" },
  { id: "Europe/London",       label: "London" },
  { id: "Europe/Paris",        label: "Paris" },
  { id: "Europe/Berlin",       label: "Berlin" },
  { id: "Europe/Moscow",       label: "Moscow" },
  { id: "Asia/Dubai",          label: "Dubai" },
  { id: "Asia/Kolkata",        label: "Kolkata" },
  { id: "Asia/Shanghai",       label: "Shanghai" },
  { id: "Asia/Tokyo",          label: "Tokyo" },
  { id: "Australia/Sydney",    label: "Sydney" },
  { id: "Pacific/Auckland",    label: "Auckland" },
];

/** What this machine is set to, for labelling the System option. */
export function systemZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Local";
  } catch {
    return "Local";
  }
}

/** "Asia/Tokyo" → "Tokyo"; an unlisted zone still gets a readable name. */
export function zoneLabel(zone: ClockZone): string {
  if (!zone) return "System";
  const known = CLOCK_ZONES.find(z => z.id === zone);
  if (known) return known.label;
  return zone.split("/").pop()!.replace(/_/g, " ");
}

export interface ZoneNow {
  year: number;
  /** 1–12. */
  month: number;
  day: number;
  /** 0–6, Sunday first — the index `DAYS`/`DAY_SHORT` are keyed by. */
  weekday: number;
  /** 0–23, always, whatever the display format is. */
  hour: number;
  minute: number;
  second: number;
  /** The zone's short name at this instant — "JST", "GMT+9". */
  abbreviation: string;
}

/**
 * The wall-clock reading of `date` in `zone`.
 *
 * Built from `formatToParts` rather than from a formatted string so the widget
 * can keep laying the clock out itself — the big hours, the blinking colon and
 * the seconds arc are three separate pieces of a design, not one locale string.
 *
 * `hourCycle: "h23"` rather than `hour12: false`, because the latter reports
 * midnight as hour 24 in several engines, and a widget that reads `24:07` for
 * seven minutes past midnight is simply wrong.
 *
 * The weekday is computed from the returned calendar date rather than asked for
 * as a localised name, which would then have to be mapped back to an index —
 * a round trip through a string for a number we can derive exactly.
 *
 * An unsupported or misspelt zone makes `Intl` throw. That is caught and the
 * machine's own zone is used, so a stale setting degrades to a correct clock
 * instead of a blank widget.
 */
export function zoneNow(date: Date, zone: ClockZone): ZoneNow {
  try {
    return read(date, zone ?? undefined);
  } catch {
    return read(date, undefined);
  }
}

/**
 * One formatter per zone, kept.
 *
 * The widget ticks every second for as long as it is on screen, and building an
 * `Intl.DateTimeFormat` is not free — it is the expensive half of this whole
 * module. The set of zones a session uses is tiny (usually one), so a plain Map
 * is the entire cache policy; there is nothing here to evict.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string | undefined): Intl.DateTimeFormat {
  const key = timeZone ?? "";
  const cached = formatters.get(key);
  if (cached) return cached;
  const built = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    timeZoneName: "short",
  });
  // Only cached once it has been built without throwing, so a bad zone is
  // rejected every time rather than poisoning the map with a broken entry.
  formatters.set(key, built);
  return built;
}

function read(date: Date, timeZone: string | undefined): ZoneNow {
  const parts = formatterFor(timeZone).formatToParts(date);

  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));

  return {
    year, month, day,
    // `Date.UTC` on the zone's own calendar date: no local offset can shift it,
    // which is the whole reason the date was pulled apart in the first place.
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    abbreviation: get("timeZoneName"),
  };
}

export interface ClockFace {
  /** Hours as shown: zero-padded in 24-hour form, bare in 12-hour form. */
  hours: string;
  minutes: string;
  seconds: string;
  /** "AM" / "PM" in 12-hour form, empty in 24-hour form. */
  meridiem: string;
}

export function clockFace(now: ZoneNow, format: ClockFormat): ClockFace {
  const minutes = String(now.minute).padStart(2, "0");
  const seconds = String(now.second).padStart(2, "0");
  if (format === "24") {
    return { hours: String(now.hour).padStart(2, "0"), minutes, seconds, meridiem: "" };
  }
  const hour12 = now.hour % 12 === 0 ? 12 : now.hour % 12;
  return { hours: String(hour12), minutes, seconds, meridiem: now.hour < 12 ? "AM" : "PM" };
}

/**
 * Restyle a Kronos `"HH:MM"` into the chosen format.
 *
 * No timezone anywhere in here, on purpose: see the note at the top. A
 * malformed value is handed back untouched rather than rendered as `NaN:NaN`.
 */
export function formatWallTime(value: string, format: ClockFormat): string {
  const [h, m] = value.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return value;
  const minutes = String(m).padStart(2, "0");
  if (format === "24") return `${String(h).padStart(2, "0")}:${minutes}`;
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${minutes} ${h < 12 ? "AM" : "PM"}`;
}
