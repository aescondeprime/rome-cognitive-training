/**
 * Kronos Keep — the item-type registry.
 *
 * There are four kinds of thing on the calendar, and before this file existed
 * that fact was written out longhand in about twenty places: a union here, a
 * tab array there, a colour ternary in one component and a colour object in
 * another, an endpoint segment spelled by hand in six mutations. Adding a
 * fourth type meant finding all of them, and missing one was silent — the
 * agenda widget's `TypeDot` looked its type up in a bare object and rendered
 * `<path d={undefined}>` for anything it did not know.
 *
 * So: one entry per type, and every consumer reads from here.
 *
 * ── The one distinction worth understanding ─────────────────────────────────
 *
 * A row is either a **template** or a **placement**, and `saved` is the flag:
 *
 *   saved = true   a library template. Has no date. Never drawn on the grid.
 *   saved = false  a placement. Sits on exactly one day.
 *
 * They used to be the same row, which is why pulling a library item onto one
 * day took it off another — `handleQuickAdd` could only PATCH the date, and a
 * row has one date. Placing a template now clones it. `isPlacement()` is the
 * predicate that keeps templates off the calendar.
 *
 * Routines are the exception that proves it: a routine has no date column at
 * all, it has a recurrence and a *window*. See `withinWindow`.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export const KRONOS_TYPES = ["routine", "assignment", "event", "general"] as const;
export type ItemType = (typeof KRONOS_TYPES)[number];

/** The API path segment for a type — `/api/kronos/calendars/:id/<plural>`. */
export type KronosSegment = "routines" | "assignments" | "events" | "generals";

export interface KronosTypeMeta {
  id: ItemType;
  label: string;
  /** API path segment, and the plural used in prose. */
  plural: KronosSegment;
  /** Default colour for a new item of this type. */
  color: string;
  /**
   * The column holding the day this item sits on.
   *
   * `null` for routines: they are placed by recurrence over a date window, not
   * by a single date, which is why every "put this on that day" code path has
   * to special-case them.
   */
  dateField: "due_date" | "event_date" | "item_date" | null;
  /** The column holding this type's free text, and what to call it. */
  detailField: "notes" | "instructions" | "preparations";
  detailLabel: string;
  /** 18×18 stroke path for the agenda widget's `TypeDot`. */
  dotPath: string;
  /** One line, shown under the type's tab in the add panel. */
  hint: string;
}

// ── Colours ─────────────────────────────────────────────────────────────────
//
// Gold tracks the live accent in the renderer; the server writes the literal
// `hsl(43 88% 60%)` because it has no CSS custom properties. Both land in the
// same place visually, and a row's stored colour always wins over these.

export const GOLD   = "hsl(var(--accent-h) 88% 60%)";
export const BLUE   = "hsl(210 65% 62%)";
export const VIOLET = "hsl(270 60% 72%)";
export const GREEN  = "hsl(145 55% 50%)";

// ── The registry ────────────────────────────────────────────────────────────

export const KRONOS_TYPE: Record<ItemType, KronosTypeMeta> = {
  routine: {
    id: "routine",
    label: "Routine",
    plural: "routines",
    color: GOLD,
    dateField: null,
    detailField: "notes",
    detailLabel: "Notes",
    dotPath: "M4 4 L4 14 M4 9 L14 9 M14 4 L14 14",
    hint: "Repeats across a date window",
  },
  assignment: {
    id: "assignment",
    label: "Assignment",
    plural: "assignments",
    color: BLUE,
    dateField: "due_date",
    detailField: "instructions",
    detailLabel: "Instructions",
    dotPath: "M5 3 L13 3 L13 15 L5 15 Z M7 7 L11 7 M7 10 L11 10",
    hint: "One-shot, with a due date",
  },
  event: {
    id: "event",
    label: "Event",
    plural: "events",
    color: VIOLET,
    dateField: "event_date",
    detailField: "preparations",
    detailLabel: "Preparations",
    dotPath: "M3 6 L15 6 L15 15 L3 15 Z M7 3 L7 6 M11 3 L11 6",
    hint: "Happens once, with preparations",
  },
  general: {
    id: "general",
    label: "General",
    plural: "generals",
    color: GREEN,
    dateField: "item_date",
    detailField: "notes",
    detailLabel: "Notes",
    dotPath: "M9 3 L15 9 L9 15 L3 9 Z",
    hint: "Anything that is none of the above",
  },
};

export const KRONOS_TYPE_LIST: KronosTypeMeta[] = KRONOS_TYPES.map(t => KRONOS_TYPE[t]);

/** Safe lookup for values arriving from the server, which may be anything. */
export function kronosType(id: string | undefined | null): KronosTypeMeta | undefined {
  return id ? KRONOS_TYPE[id as ItemType] : undefined;
}

/** Colour for a type, falling back rather than returning `undefined`. */
export function typeColor(id: string | undefined | null, override?: string): string {
  return override || kronosType(id)?.color || GOLD;
}

const SEGMENTS = KRONOS_TYPES.map(t => KRONOS_TYPE[t].plural);

/** `"routines"` → `"routine"`. Used by the cancel capability and by imports. */
export function typeForSegment(segment: string): ItemType | undefined {
  return KRONOS_TYPES.find(t => KRONOS_TYPE[t].plural === segment);
}

export function isKronosSegment(segment: string): segment is KronosSegment {
  return SEGMENTS.includes(segment as KronosSegment);
}

// ── Templates and placements ────────────────────────────────────────────────

/**
 * Does this row belong on the calendar?
 *
 * A template (`saved`) does not: it is a thing you keep in the library to
 * place later, and drawing it would put it on whatever stale date it happened
 * to be created with.
 */
export function isPlacement(row: { saved?: boolean }): boolean {
  return !row.saved;
}

/**
 * The body for placing a template on a day.
 *
 * Everything except identity and library membership is carried across, so the
 * placement looks exactly like the template — but it is its own row, which is
 * the entire point. Routines carry a window instead of a date.
 */
export function placementBody(
  type: ItemType,
  template: Record<string, any>,
  dateStr: string,
): Record<string, unknown> {
  const meta = KRONOS_TYPE[type];
  const body: Record<string, unknown> = {
    title: template.title,
    color: template.color,
    start_time: template.start_time,
    duration_minutes: template.duration_minutes,
    [meta.detailField]: template[meta.detailField] ?? "",
    saved: false,
  };

  if (meta.dateField) {
    body[meta.dateField] = dateStr;
  } else {
    // A routine placed from the library keeps its recurrence and takes the
    // month of the day you dropped it on. Placing it on a single day would
    // mean inventing a one-day routine, which is an event with extra steps.
    const { start, end } = monthWindow(dateStr);
    body.recurrence = template.recurrence ?? "daily";
    body.days_of_week = template.days_of_week ?? null;
    body.start_date = start;
    body.end_date = end;
  }

  return body;
}

// ── Dates ───────────────────────────────────────────────────────────────────
//
// Everything here works on `"YYYY-MM-DD"` strings and never on `Date` objects,
// because the moment a calendar day becomes a `Date` it acquires a timezone
// and starts being the previous day for anyone west of UTC.

/** `(2026, 8, 3)` → `"2026-08-03"`. */
export function fmtDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseDate(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}

export function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

export function todayStr(now = new Date()): string {
  return fmtDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** First and last day of the month containing `dateStr`. */
export function monthWindow(dateStr: string): { start: string; end: string } {
  const { y, m } = parseDate(dateStr);
  return { start: fmtDate(y, m, 1), end: fmtDate(y, m, daysInMonth(y, m)) };
}

/**
 * Is `dateStr` inside a routine's window?
 *
 * An empty bound means unbounded on that side. That is deliberate: rows
 * written before the window existed have neither bound, and they keep
 * repeating exactly as they did until someone edits them. A migration that
 * guessed a window for them would silently delete history from the grid.
 *
 * Comparison is lexicographic, which is correct and fast for zero-padded
 * ISO dates and wrong for nothing.
 */
export function withinWindow(
  dateStr: string,
  start?: string | null,
  end?: string | null,
): boolean {
  if (start && dateStr < start) return false;
  if (end && dateStr > end) return false;
  return true;
}

/** Human label for a window, for the routine rows in the library. */
export function windowLabel(start?: string | null, end?: string | null): string {
  if (!start && !end) return "Always";
  const sameMonth =
    start && end && start.slice(0, 7) === end.slice(0, 7) &&
    start.endsWith("-01") &&
    end === monthWindow(start).end;
  if (sameMonth) {
    const { y, m } = parseDate(start!);
    return `${MONTHS_SHORT[m - 1]} ${y}`;
  }
  if (start && end) return `${start} → ${end}`;
  if (start) return `From ${start}`;
  return `Until ${end}`;
}

export const MONTHS_SHORT =
  ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
