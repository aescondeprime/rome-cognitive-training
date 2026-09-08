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

import { readAlerts } from "./alerts";
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
  /** Minutes before the start, comma-separated. `""` is no alert. */
  alerts?: string | null;
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
  /** The day this will land on, for the confirmation. Absent on a skip. */
  date?: string;
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

/**
 * Message for the one setup mistake that breaks everything downstream.
 *
 * Without the v2 columns nothing can be recorded, so every row looks brand new,
 * every push is a create, and the second attempt collides with the first — a
 * three-step failure whose symptom (a 412 naming an event you did not choose)
 * points nowhere near the cause. Said once, up front, instead.
 */
export const MIGRATION_REQUIRED =
  "ROME's database is missing the calendar-sync columns. " +
  "Run script/sql/2026-08-kronos-v2.sql in the Supabase SQL editor, then try again.";

/**
 * Have the v2 sync columns been applied?
 *
 * PostgREST's `select("*")` returns only columns that exist, so the absence of
 * the `ical_href` *key* on a row that came back from the server is a reliable
 * signal — much better than probing `information_schema` over the API, and it
 * costs nothing because the rows have already been read.
 *
 * Null when there are no rows to judge from, in which case there is nothing to
 * push either and the question does not arise.
 */
export function syncColumnsPresent(rows: RowsByKind): boolean | null {
  for (const kind of KRONOS_KINDS) {
    const row = (rows[kind] ?? [])[0];
    if (row) return "ical_href" in row && "synced_at" in row;
  }
  return null;
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
    alerts: readAlerts(row.alerts),
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
      kind, row, op: "create", date,
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
        alerts: input.alerts ?? [],
      }, now)
    : buildVevent({ ...input, created: now });

  return { kind, row, op: "update", date, href, ics, etag: row.ical_etag ?? null };
}

/** `"YYYY-MM-DD"` for an instant, in the machine's local zone. */
export function localDay(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}


// ══════════════════════════════════════════════════════════════════════════
// DELETIONS — the orphan sweep
// ══════════════════════════════════════════════════════════════════════════
//
// Push alone cannot see a row that no longer exists, so a Kronos item you
// delete leaves its event in Apple Calendar forever. The way out is to look at
// what is actually on the server and find things ROME put there that ROME no
// longer has a reason to keep.
//
// ── Matching on the href, not the UID ───────────────────────────────────────
//
// ROME names every resource it creates `rome-<kind>-<id>.ics`, and that
// filename is enough to identify it. Matching on the href means the sweep needs
// only the listing that `sync-collection` already returns — no bodies, no
// multiget of the whole calendar on every cycle.
//
// It also draws the blast radius exactly where it should be: an event you
// created in Apple Calendar has a UID and a filename of Apple's choosing, so it
// can never match this pattern and can never be swept. **The sweep can only
// ever delete ROME's own events.**
//
// ── What counts as an orphan ────────────────────────────────────────────────
//
// Not "the row was deleted" but "the row is not on the Kronos calendar" — which
// also covers an assignment whose date was cleared, or one turned back into a
// library template. If ROME draws it on no day, it should not sit on a day in
// Apple Calendar. A row that is merely *unchanged* is very much still there.

export interface DeleteAction {
  href: string;
  etag: string | null;
  kind: KronosKind;
  id: number;
  /** The row's title while ROME still holds the row; null once it is gone. */
  title: string | null;
  /** Shown in the confirmation. */
  reason: string;
}

const ROME_RESOURCE = /(?:^|\/)rome-(routine|assignment|event|general)-(\d+)\.ics$/;

/** `(kind, id)` for a ROME-authored resource, or null for anything else. */
export function romeKeyFromHref(href: string): { kind: KronosKind; id: number } | null {
  const m = ROME_RESOURCE.exec(String(href ?? "").trim());
  return m ? { kind: m[1] as KronosKind, id: Number(m[2]) } : null;
}

export function rowKey(kind: KronosKind, id: number): string {
  return `${kind}-${id}`;
}

/**
 * The rows that belong on the calendar right now.
 *
 * Derived from the push plan rather than recomputed, so the two halves of a
 * cycle can never disagree about whether an item is placed. `create`, `update`
 * and a skip of "unchanged" all mean it is there; every other skip means it is
 * not, and the reason travels with it into the deletion.
 */
export function livePlacementKeys(plan: PushPlan): Set<string> {
  const live = new Set<string>();
  for (const action of plan.actions) {
    const placed = action.op !== "skip" || action.reason === "unchanged" || action.reason?.startsWith("created in Apple");
    if (placed) live.add(rowKey(action.kind, action.row.id));
  }
  return live;
}

/**
 * What the confirmation should say about a key that is no longer placed.
 *
 * A row ROME still holds can be named and explained; a row that is simply gone
 * has neither a title nor a reason beyond its absence, and saying that plainly
 * beats inventing one.
 */
function describeOrphan(
  plan: PushPlan, kind: KronosKind, id: number,
): { title: string | null; reason: string } {
  const action = plan.actions.find(a => a.kind === kind && a.row.id === id);
  if (!action) return { title: null, reason: "deleted from Kronos" };
  return {
    title: action.row.title ?? null,
    reason: action.reason ? `no longer on the calendar (${action.reason})` : "no longer on the calendar",
  };
}

export interface RemoteResource { href: string; etag: string | null }

/**
 * Which of the server's resources ROME should remove.
 *
 * `remote` is the listing as the server gave it. Anything outside ROME's naming
 * scheme is skipped without comment — it is not ours to reason about.
 */
export function planDeletes(
  remote: RemoteResource[],
  plan: PushPlan,
): { deletes: DeleteAction[]; romeResources: number } {
  const live = livePlacementKeys(plan);
  const deletes: DeleteAction[] = [];
  let romeResources = 0;

  for (const resource of remote) {
    const key = romeKeyFromHref(resource.href);
    if (!key) continue;                 // not ROME's; not ours to touch
    romeResources += 1;
    if (live.has(rowKey(key.kind, key.id))) continue;
    const { title, reason } = describeOrphan(plan, key.kind, key.id);
    deletes.push({ href: resource.href, etag: resource.etag, kind: key.kind, id: key.id, title, reason });
  }

  return { deletes, romeResources };
}

/** Never fewer than this, however small the calendar. */
export const DELETE_GUARD_FLOOR = 5;
export const DELETE_GUARD_FRACTION = 0.25;

/**
 * Is this many deletions too many to do without asking again?
 *
 * A stale token, a wrong calendar or a half-read listing all present exactly as
 * "everything is an orphan", and an unguarded sweep would faithfully empty
 * somebody's calendar. Past the threshold the cycle refuses and says so; the
 * user can look, and delete by hand if that really is what they meant.
 */
export function deleteGuardExceeded(deleteCount: number, romeResources: number): boolean {
  return deleteCount > Math.max(DELETE_GUARD_FLOOR, Math.ceil(romeResources * DELETE_GUARD_FRACTION));
}

export function deleteGuardMessage(deleteCount: number, romeResources: number): string {
  return (
    `Sync stopped: this would delete ${deleteCount} of ${romeResources} ROME events on iCloud. ` +
    `That is more than a normal cleanup, so nothing was changed. ` +
    `If it is right, remove them in Apple Calendar yourself.`
  );
}

/**
 * The one-line confirmation for a dry run.
 *
 * Written as a sentence rather than a table because it is shown once, to
 * someone deciding whether to let this touch their real calendar — and now
 * that a cycle can remove things, leaving deletions out of that sentence
 * would be the worst possible omission.
 */
export function describeCycle(plan: PushPlan, deleteCount: number): string {
  const parts: string[] = [];
  if (plan.creates) parts.push(`create ${plan.creates} event${plan.creates === 1 ? "" : "s"}`);
  if (plan.updates) parts.push(`update ${plan.updates}`);
  if (deleteCount) parts.push(`delete ${deleteCount}`);
  if (!parts.length) return "Nothing to send — iCloud is already up to date.";
  const last = parts.pop()!;
  const list = parts.length ? `${parts.join(", ")} and ${last}` : last;
  return `ROME will ${list} in your iCloud calendar.`;
}
