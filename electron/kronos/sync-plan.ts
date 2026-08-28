/**
 * What a push cycle would do — decided as a pure function, before anything
 * touches the network.
 *
 * Splitting the decision from the doing is what makes this testable at all. A
 * sync engine that interleaves "work out what changed" with "send it" can only
 * be tested against a live server, which means it is tested rarely, by hand,
 * against one person's calendar. Here the whole decision is a function from
 * rows to a list of actions, and the executor is a loop that carries them out.
 *
 * It is also what makes a dry run honest: the confirmation shown before the
 * first write is *this* plan, not an estimate of it.
 *
 * ── The rules, in the order they are applied ────────────────────────────────
 *
 * 1. **A template is not an event.** `saved = true` rows live in the library
 *    and are never drawn on the Kronos grid; pushing them would put things on
 *    the user's phone that ROME itself does not show on any day.
 * 2. **A row with nothing to place is skipped**, with a reason. An assignment
 *    with an empty `due_date` is a half-finished thought, not a calendar entry.
 * 3. **Locally dirty is `updated_at > synced_at`, strictly.** This is the
 *    ping-pong guard. The writeback sets `synced_at` to the `updated_at` the
 *    engine already read, so a row edited *during* a cycle comes out still
 *    dirty and is pushed next time — the race resolves in the safe direction.
 * 4. **An update patches `ical_raw` when we have it.** Regenerating the file
 *    would drop the alarms, invitees and `X-APPLE-*` properties the user added
 *    on their phone. Only a resource ROME has never seen is built from scratch.
 */

import { buildVevent, patchVevent, romeUid, type VeventInput } from "./ical";
import { rruleFromRoutine } from "./rrule";

export const KRONOS_KINDS = ["routine", "assignment", "event", "general"] as const;
export type KronosKind = (typeof KRONOS_KINDS)[number];

/**
 * The per-kind differences, in one place.
 *
 * A deliberate second copy of what `client/src/lib/kronosTypes.ts` holds for
 * the renderer: the main process cannot import from `client/`, and a shared
 * module under `shared/` would drag the renderer's colour and icon vocabulary
 * into Electron for the sake of two field names. Four entries, and the two
 * copies are checked against each other by a test rather than by hope.
 */
export const KIND_FIELDS: Record<KronosKind, { plural: string; dateField: string | null; detailField: string }> = {
  routine: { plural: "routines", dateField: null, detailField: "notes" },
  assignment: { plural: "assignments", dateField: "due_date", detailField: "instructions" },
  event: { plural: "events", dateField: "event_date", detailField: "preparations" },
  general: { plural: "generals", dateField: "item_date", detailField: "notes" },
};

export interface KronosRow {
  id: number;
  title?: string;
  start_time?: string;
  duration_minutes?: number;
  saved?: boolean;
  updated_at?: number;
  synced_at?: number | null;
  ical_uid?: string | null;
  ical_href?: string | null;
  ical_etag?: string | null;
  ical_raw?: string | null;
  sync_state?: string | null;
  // routine
  recurrence?: string | null;
  days_of_week?: number[] | null;
  start_date?: string | null;
  end_date?: string | null;
  // the date and text columns, one pair live per kind
  due_date?: string | null;
  event_date?: string | null;
  item_date?: string | null;
  notes?: string | null;
  instructions?: string | null;
  preparations?: string | null;
  [key: string]: unknown;
}

export type RowsByKind = Record<KronosKind, KronosRow[]>;

export interface PushAction {
  kind: KronosKind;
  row: KronosRow;
  op: "create" | "update" | "skip";
  /** Path-only. Absent on a skip. */
  href?: string;
  /** The body to PUT. Absent on a skip. */
  ics?: string;
  /** For `If-Match` on an update. Null when Apple never gave us one. */
  etag?: string | null;
  /** Present on a skip, and written to be read by a person. */
  reason?: string;
}

export interface PushPlan {
  actions: PushAction[];
  creates: number;
  updates: number;
  skipped: number;
}

export function emptyRows(): RowsByKind {
  return { routine: [], assignment: [], event: [], general: [] };
}

/** Strictly greater. See rule 3 in the header — this is the ping-pong guard. */
export function isLocallyDirty(row: KronosRow): boolean {
  const updated = Number(row.updated_at) || 0;
  const synced = Number(row.synced_at) || 0;
  return updated > synced;
}

/** The filename ROME gives a resource it creates. Stable, and recognisable. */
export function romeHref(calendarPath: string, kind: KronosKind, id: number): string {
  return `${calendarPath.replace(/\/?$/, "/")}rome-${kind}-${id}.ics`;
}

/**
 * The day a row sits on, or "" when it has none.
 *
 * A routine's day is the start of its window: that is the anchor `DTSTART`
 * needs, and the `RRULE` carries the rest. A routine with no window at all is a
 * pre-v2 row that repeats forever — anchored at today so it does not become an
 * infinite series stretching back to whenever it was created.
 */
export function placementDate(kind: KronosKind, row: KronosRow, today: string): string {
  if (kind === "routine") return String(row.start_date || "").trim() || today;
  const field = KIND_FIELDS[kind].dateField!;
  return String(row[field] ?? "").trim();
}

/** The VEVENT a row should become. */
export function veventFor(kind: KronosKind, row: KronosRow, today: string): VeventInput {
  const detail = String(row[KIND_FIELDS[kind].detailField] ?? "");
  return {
    uid: String(row.ical_uid || romeUid(kind, row.id)),
    summary: String(row.title ?? "Untitled"),
    description: detail,
    date: placementDate(kind, row, today),
    time: String(row.start_time || "09:00"),
    durationMinutes: Math.max(1, Number(row.duration_minutes) || 60),
    rrule: kind === "routine" ? rruleFromRoutine(row) : null,
    romeKind: kind,
    romeId: row.id,
  };
}

/**
 * Decide the whole cycle.
 *
 * `now` is injected so the tests are not a function of the wall clock, and so
 * a dry run and the run that follows it agree about what "today" means.
 */
export function planPush(
  rows: RowsByKind,
  calendarPath: string,
  now: number = Date.now(),
): PushPlan {
  const today = localDay(now);
  const actions: PushAction[] = [];

  for (const kind of KRONOS_KINDS) {
    for (const row of rows[kind] ?? []) {
      actions.push(planRow(kind, row, calendarPath, today, now));
    }
  }

  return {
    actions,
    creates: actions.filter(a => a.op === "create").length,
    updates: actions.filter(a => a.op === "update").length,
    skipped: actions.filter(a => a.op === "skip").length,
  };
}

function planRow(
  kind: KronosKind,
  row: KronosRow,
  calendarPath: string,
  today: string,
  now: number,
): PushAction {
  const skip = (reason: string): PushAction => ({ kind, row, op: "skip", reason });

  // 1 · Templates are library entries, not days on a calendar.
  if (row.saved) return skip("library template");

  if (!String(row.title ?? "").trim()) return skip("no title");

  // 2 · Nothing to place it on.
  const date = placementDate(kind, row, today);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return skip("no date");

  // A routine whose weekly rule selects no days has no occurrences at all.
  if (kind === "routine" && String(row.recurrence) === "weekly" && !(row.days_of_week ?? []).length) {
    return skip("weekly routine with no days selected");
  }

  // An event ROME did not author and cannot represent. `foreign` is set by the
  // pull side; pushing it back would flatten whatever Apple feature it uses.
  if (row.sync_state === "foreign") return skip("created in Apple Calendar; ROME cannot represent it");

  const href = String(row.ical_href || "").trim();

  // 3 · Never seen by iCloud → create.
  if (!href) {
    return {
      kind, row, op: "create",
      href: romeHref(calendarPath, kind, row.id),
      ics: buildVevent({ ...veventFor(kind, row, today), created: now }),
    };
  }

  if (!isLocallyDirty(row)) return skip("unchanged");

  // 4 · Patch the stored original so the user's own additions survive.
  const input = veventFor(kind, row, today);
  const raw = String(row.ical_raw || "");
  const ics = raw
    ? patchVevent(raw, {
        summary: input.summary,
        description: input.description,
        date: input.date,
        time: input.time,
        durationMinutes: input.durationMinutes,
        rrule: input.rrule ?? null,
        romeKind: kind,
        romeId: row.id,
      }, now)
    : buildVevent({ ...input, created: now });

  return { kind, row, op: "update", href, ics, etag: row.ical_etag ?? null };
}

/** `"YYYY-MM-DD"` for an instant, in the machine's local zone. */
export function localDay(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * A one-line summary for the dry-run confirmation.
 *
 * Written as a sentence rather than a table because it is shown once, in a
 * dialog, to someone deciding whether to let this touch their real calendar.
 */
export function describePlan(plan: PushPlan): string {
  if (plan.creates === 0 && plan.updates === 0) return "Nothing to send — iCloud is already up to date.";
  const parts: string[] = [];
  if (plan.creates) parts.push(`create ${plan.creates} event${plan.creates === 1 ? "" : "s"}`);
  if (plan.updates) parts.push(`update ${plan.updates}`);
  return `ROME will ${parts.join(" and ")} in your iCloud calendar.`;
}
