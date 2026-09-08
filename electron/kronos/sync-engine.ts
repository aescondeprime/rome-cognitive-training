/**
 * The push half of the sync: ROME → iCloud.
 *
 * Deciding what to send is `sync-plan.ts` and is pure. This file is the part
 * that carries the plan out and records what happened — the loop, the guards
 * and the writeback.
 *
 * ── Push only, and what that means today ────────────────────────────────────
 *
 * Items created or edited in ROME appear in Apple Calendar. Nothing comes back
 * yet, and **a routine deleted in ROME is not yet deleted from iCloud** — push
 * alone cannot see a row that no longer exists. Both arrive with the pull side,
 * which is the half that knows what the server is holding. This is stated in
 * the panel rather than left to be discovered.
 *
 * ── The ping-pong guard ─────────────────────────────────────────────────────
 *
 * After a successful PUT the row is marked with `synced_at` set to **the
 * `updated_at` the engine read at the start of the cycle**, not to the current
 * time, and the writeback endpoint deliberately does not bump `updated_at`.
 *
 * That makes the race resolve in the safe direction: if the user edits a row
 * while it is being pushed, its `updated_at` moves past the value we write, the
 * row comes out still dirty, and the next cycle sends the newer version. The
 * alternative — stamping `Date.now()` — would mark the user's unsent edit as
 * already synced and quietly lose it.
 *
 * ── Nothing writes without being asked, yet ─────────────────────────────────
 *
 * `runCycle` takes `dryRun`, and the panel calls it that way first. There is no
 * timer in this phase: a background poller that started writing to somebody's
 * real calendar the moment they finished typing a password would be the wrong
 * order of operations. Scheduling arrives once pulling and the delete guard do.
 */

import { readVevent } from "./ical";
import { DavError, IcloudDav, looksMangled } from "./icloud-dav";
import {
  KRONOS_KINDS, KIND_FIELDS, MIGRATION_REQUIRED, deleteGuardExceeded, deleteGuardMessage,
  emptyRows, localDay, planDeletes, planPush, syncColumnsPresent,
  type DeleteAction, type KronosKind, type KronosRow, type PushAction, type PushPlan, type RowsByKind,
} from "./sync-plan";

export interface SyncCalendar { id: number; name: string }

export interface CycleReport {
  ok: boolean;
  dryRun: boolean;
  /**
   * How many rows of each kind the engine actually read.
   *
   * The first question when a preview comes back empty is not "what did it
   * decide" but "did it see my item at all", and those have completely
   * different causes. Reporting the counts separates them in one glance.
   */
  read: Record<KronosKind, number>;
  /** The profile the engine read as. A surprise here is the bug above. */
  readingAs: { id: number; name: string } | null;
  plan: PushPlan;
  /** ROME events on iCloud that no longer belong on the Kronos calendar. */
  deletes: DeleteAction[];
  /** Set when the sweep could not run. Deletions were skipped, not attempted. */
  deleteNote: string | null;
  pushed: number;
  /** Resources actually removed from iCloud this cycle. */
  removed: number;
  failed: number;
  /** One line per failure, already translated for a person. */
  problems: string[];
  finishedAt: number;
}

export type SyncState = "idle" | "syncing" | "error";

export interface SyncStatus {
  state: SyncState;
  lastSyncAt: number | null;
  lastError: string | null;
  lastPushed: number;
  /** Rows the last plan would send. Refreshed by every cycle, dry or not. */
  pending: number;
}

export interface SyncEngineOptions {
  /** Loopback base for the Express server, e.g. `http://127.0.0.1:5000`. */
  serverBase: string;
  /**
   * The renderer's session token, or null.
   *
   * Without it the Express server has no idea who is asking and falls back to
   * `storage.getActiveProfileId()` — which is not necessarily the profile the
   * window is signed in as. The engine then reads a different person's
   * calendar, finds none of your items, and pushes theirs. It is a silent,
   * total mismatch, and it cost a debugging session to find.
   */
  getSessionToken: () => string | null;
  /** The linked iCloud calendar path, or "" when not configured. */
  getCalendarPath: () => string;
  getClient: () => IcloudDav | null;
  onStatus?: (status: SyncStatus) => void;
}

export class KronosSyncEngine {
  private readonly options: SyncEngineOptions;
  private running = false;
  private status_: SyncStatus = {
    state: "idle", lastSyncAt: null, lastError: null, lastPushed: 0, pending: 0,
  };

  constructor(options: SyncEngineOptions) {
    this.options = options;
  }

  status(): SyncStatus {
    return { ...this.status_ };
  }

  private setStatus(patch: Partial<SyncStatus>): void {
    this.status_ = { ...this.status_, ...patch };
    this.options.onStatus?.(this.status());
  }

  /**
   * One cycle.
   *
   * Serialised: a second call while one is in flight is refused rather than
   * queued. Two concurrent cycles would both read the same dirty rows and both
   * push them, and the second PUT would fail its `If-Match` against the etag
   * the first one just changed — a self-inflicted conflict.
   */
  async runCycle(options: { dryRun?: boolean } = {}): Promise<CycleReport> {
    const dryRun = Boolean(options.dryRun);

    if (this.running) {
      return this.report(dryRun, emptyPlan(), 0, 0, ["A sync is already running."], false);
    }

    const client = this.options.getClient();
    const calendarPath = this.options.getCalendarPath();
    if (!client || !calendarPath) {
      return this.report(dryRun, emptyPlan(), 0, 0, ["No iCloud calendar is linked."], false);
    }

    this.running = true;
    if (!dryRun) this.setStatus({ state: "syncing", lastError: null });

    try {
      const profile = await this
        .api<{ id: number; name: string }>("GET", "/api/active-profile")
        .catch(() => null);

      const calendar = await this.romeCalendar();
      if (!calendar) {
        return this.report(dryRun, emptyPlan(), 0, 0, ["ROME has no calendar to sync."], false);
      }

      const rows = await this.readRows(calendar.id);

      // Checked before planning, and on a dry run too, so Preview is where you
      // find this out rather than halfway through a partial write.
      if (syncColumnsPresent(rows) === false) {
        this.setStatus({ state: "error", lastError: MIGRATION_REQUIRED });
        return this.report(dryRun, emptyPlan(), 0, 0, [MIGRATION_REQUIRED], false);
      }

      const read = countRows(rows);
      const plan = planPush(rows, calendarPath);

      // What is actually on the calendar, so orphans can be found. Only hrefs
      // and etags — no bodies — because ROME's own resources are identifiable
      // by filename alone.
      const sweep = await this.planSweep(client, calendarPath, plan);
      if (sweep.abort) {
        this.setStatus({ state: "error", lastError: sweep.abort });
        return this.report(dryRun, plan, 0, 0, [sweep.abort], false, read, profile, [], sweep.note);
      }
      const deletes = sweep.deletes;

      this.setStatus({ pending: plan.creates + plan.updates + deletes.length });

      // One line per manual sync, in the terminal running `desktop:dev`. Not a
      // hot path, and it is the difference between "the preview says nothing"
      // and knowing whether the rows were even read.
      console.log(
        `[kronos] ${dryRun ? "preview" : "sync"} · as ${profile?.name ?? "?"}(${profile?.id ?? "?"})` +
        ` cal=${calendar.id} · read ` +
        KRONOS_KINDS.map(k => `${k}=${read[k]}`).join(" ") +
        ` · create=${plan.creates} update=${plan.updates} delete=${deletes.length} skip=${plan.skipped}`,
      );

      if (dryRun) {
        this.setStatus({ state: "idle" });
        return this.report(true, plan, 0, 0, [], true, read, profile, deletes, sweep.note);
      }

      let pushed = 0;
      const problems: string[] = [];

      for (const action of plan.actions) {
        if (action.op === "skip") continue;
        try {
          const outcome = await this.push(client, action);
          pushed += 1;
          if (!outcome.recorded) {
            problems.push(`${titleOf(action)}: sent to iCloud, but ROME could not record it — ${outcome.note}`);
          }
        } catch (error) {
          problems.push(describeFailure(action, error));
          // Keep going. One event Apple refuses should not strand the other
          // forty — and the failure is reported rather than swallowed.
        }
      }

      // Deletions last. If a push failed, the row is still meant to be there,
      // and removing things before confirming the additions landed is the
      // wrong order to fail in.
      let removed = 0;
      for (const action of deletes) {
        try {
          await client.deleteEvent(action.href, action.etag);
          removed += 1;
        } catch (error) {
          problems.push(
            `Could not remove ${action.title ?? `${action.kind} #${action.id}`} from iCloud: ` +
            (error instanceof DavError ? error.userMessage : "unknown error."),
          );
        }
      }

      this.setStatus({
        state: problems.length ? "error" : "idle",
        lastSyncAt: Date.now(),
        lastPushed: pushed,
        lastError: problems[0] ?? null,
        pending: Math.max(0, plan.creates + plan.updates + deletes.length - pushed - removed),
      });

      return this.report(
        false, plan, pushed, problems.length, problems, problems.length === 0,
        read, profile, deletes, sweep.note, removed,
      );
    } catch (error) {
      const message = error instanceof DavError ? error.userMessage : "The sync could not run.";
      this.setStatus({ state: "error", lastError: message });
      return this.report(dryRun, emptyPlan(), 0, 1, [message], false);
    } finally {
      this.running = false;
    }
  }

  // ── One action ────────────────────────────────────────────────────────────

  private async push(client: IcloudDav, action: PushAction): Promise<PushOutcome> {
    const { kind, row, href, ics } = action;
    if (!href || !ics) return { recorded: true };

    let result: Awaited<ReturnType<IcloudDav["putEvent"]>>;
    if (action.op === "create") {
      try {
        result = await client.putEvent(href, ics, { ifNoneMatch: true });
      } catch (error) {
        // `If-None-Match: *` refused: something is already at this href. The
        // href is derived from the row id, so the overwhelmingly likely cause
        // is a previous cycle that pushed successfully and then failed to
        // record it — the write landed, the bookkeeping did not.
        //
        // Retrying as an update makes a create idempotent, which is what turns
        // "run it again" from a source of unexplained conflicts into the
        // obvious thing that works.
        if (!(error instanceof DavError) || error.kind !== "precondition") throw error;
        const existing = await client.getEvent(href).catch(() => null);
        result = existing
          ? await client.putEvent(href, ics, { ifMatch: existing.etag })
          // Refused as existing, yet not readable. This href is in ROME's own
          // `rome-<kind>-<id>.ics` namespace, so whatever is there is ours from
          // an earlier run; an unconditional write is the way out of a loop
          // that would otherwise fail identically forever.
          : await client.putEvent(href, ics, {});
      }
    } else {
      result = await client.putEvent(href, ics, { ifMatch: action.etag ?? null });
    }

    // Apple frequently rewrites the resource and answers without an ETag. Read
    // the one href back rather than storing null: an unknown etag means the
    // next update has no `If-Match` to offer, and a stale one means every
    // future cycle sees a phantom conflict and rewrites the whole calendar.
    let etag = result.etag;
    let raw = ics;
    if (!etag) {
      const reread = await client.getEvent(href).catch(() => null);
      if (reread) {
        etag = reread.etag;
        const decoded = new TextDecoder("utf-8").decode(reread.bytes);
        if (!looksMangled(decoded)) raw = decoded;
      }
    }

    // From here the event *is* on iCloud. A failure to record that is a
    // different kind of problem from a failure to send, and reporting it as
    // "could not be sent" would have someone hunting a network fault while the
    // event sits in their calendar. Almost always the v2 migration.
    try {
      await this.markSynced(kind, row, { href, etag, raw });
    } catch (error) {
      return { recorded: false, note: describeWritebackFailure(error) };
    }
    return { recorded: true };
  }

  /**
   * Record that this row is now on iCloud.
   *
   * `synced_at` is the `updated_at` we read, not the clock. See the header.
   */
  private async markSynced(
    kind: KronosKind,
    row: KronosRow,
    fields: { href: string; etag: string | null; raw: string },
  ): Promise<void> {
    await this.api("POST", `/api/kronos/sync/${KIND_FIELDS[kind].plural}/${row.id}`, {
      ical_uid: String(row.ical_uid || `rome-${kind}-${row.id}@rome.local`),
      ical_href: fields.href,
      ical_etag: fields.etag ?? "",
      ical_raw: fields.raw,
      sync_state: "linked",
      synced_at: Number(row.updated_at) || Date.now(),
    });
  }

  /**
   * Find ROME's events on iCloud that no longer belong there.
   *
   * Two ways this refuses rather than proceeds, both of which look identical to
   * "everything is an orphan" from inside a naive sweep:
   *
   * **A truncated listing.** The server capped its answer, so the resources it
   * did not mention are unknown, not absent. Deleting on a partial listing is
   * how you lose a calendar.
   *
   * **Too many at once.** Past the guard the whole cycle stops — pushes as
   * well — because a number that large means the premise is wrong, not that
   * there is a lot of tidying to do.
   *
   * A listing that simply fails is not fatal: deletions are skipped with a
   * note, and the pushes still go.
   */
  private async planSweep(
    client: IcloudDav,
    calendarPath: string,
    plan: PushPlan,
  ): Promise<{ deletes: DeleteAction[]; note: string | null; abort: string | null }> {
    let listing: Awaited<ReturnType<IcloudDav["syncCollection"]>>;
    try {
      listing = await client.syncCollection(calendarPath, null);
    } catch (error) {
      const why = error instanceof DavError ? error.userMessage : "the calendar could not be listed.";
      return { deletes: [], abort: null, note: `Deletions skipped — ${why}` };
    }

    if (listing.truncated) {
      return {
        deletes: [], abort: null,
        note: "Deletions skipped — iCloud returned only part of the calendar, so ROME cannot tell what is missing.",
      };
    }

    const remote = listing.changes
      .filter(change => !change.deleted)
      .map(change => ({ href: change.href, etag: change.etag }));

    const { deletes, romeResources } = planDeletes(remote, plan);

    if (deleteGuardExceeded(deletes.length, romeResources)) {
      return { deletes: [], note: null, abort: deleteGuardMessage(deletes.length, romeResources) };
    }

    await this.nameOrphans(client, calendarPath, deletes);
    return { deletes, note: null, abort: null };
  }

  /**
   * Fill in the titles of orphans whose Kronos row is gone.
   *
   * The row that had the name has been deleted, so ROME has nothing left to
   * call the event — but iCloud still holds it, SUMMARY and all. Reading those
   * bodies is what turns "assignment #42" in the confirmation into "Chapter 5",
   * and a confirmation you cannot read is not one.
   *
   * Only the unnamed ones, only after the guard has passed, so this is bounded
   * by `max(5, 25%)` rather than by the size of the calendar. Failing to read a
   * name is not a reason to abandon the sweep: the id is a worse label, not a
   * wrong one, so anything that goes wrong here leaves the fallback in place.
   */
  private async nameOrphans(
    client: IcloudDav, calendarPath: string, deletes: DeleteAction[],
  ): Promise<void> {
    const unnamed = deletes.filter(d => !d.title);
    if (!unnamed.length) return;

    try {
      const bodies = await client.multiget(calendarPath, unnamed.map(d => d.href));
      // Keyed by the resource's filename, not the whole href: the listing and
      // the multiget response can spell the same path differently (a partition
      // host, an escaped segment), and the filename is unique in a calendar and
      // is the very thing that identified these as ROME's in the first place.
      const byName = new Map(bodies.map(b => [resourceName(b.href), b]));
      for (const action of unnamed) {
        const body = byName.get(resourceName(action.href));
        if (!body) continue;
        // A mangled body is still fine to read a title out of: the damage is a
        // replacement character inside the text, not a structural break, and
        // the alternative on offer is no title at all.
        const summary = readVevent(body.ics)?.summary?.trim();
        if (summary) action.title = summary;
      }
    } catch {
      // Left unnamed on purpose. See the note above.
    }
  }

  // ── Reading ROME ──────────────────────────────────────────────────────────

  private async romeCalendar(): Promise<SyncCalendar | null> {
    const calendars = await this.api<SyncCalendar[]>("GET", "/api/kronos/calendars");
    return calendars?.[0] ?? null;
  }

  private async readRows(calendarId: number): Promise<RowsByKind> {
    const rows = emptyRows();
    await Promise.all(KRONOS_KINDS.map(async kind => {
      // A build running before the migration has no `generals` table. An empty
      // list is the right answer; the other three kinds still sync.
      rows[kind] = await this
        .api<KronosRow[]>("GET", `/api/kronos/calendars/${calendarId}/${KIND_FIELDS[kind].plural}`)
        .catch(() => []);
    }));
    return rows;
  }

  private async api<T = unknown>(method: string, pathname: string, body?: unknown): Promise<T> {
    const token = this.options.getSessionToken();
    const response = await fetch(`${this.options.serverBase}${pathname}`, {
      method,
      headers: {
        ...(token ? { "x-session-token": token } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });
    const text = await response.text();
    const value = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new Error(value?.error?.message ?? value?.error ?? `ROME API returned HTTP ${response.status}.`);
    }
    return value as T;
  }

  private report(
    dryRun: boolean, plan: PushPlan, pushed: number, failed: number,
    problems: string[], ok: boolean, read: Record<KronosKind, number> = noneRead(),
    readingAs: { id: number; name: string } | null = null,
    deletes: DeleteAction[] = [], deleteNote: string | null = null, removed = 0,
  ): CycleReport {
    return {
      ok, dryRun, read, readingAs, plan, deletes, deleteNote,
      pushed, removed, failed, problems, finishedAt: Date.now(),
    };
  }
}

function emptyPlan(): PushPlan {
  return { actions: [], creates: 0, updates: 0, skipped: 0 };
}

function noneRead(): Record<KronosKind, number> {
  return { routine: 0, assignment: 0, event: 0, general: 0 };
}

function countRows(rows: RowsByKind): Record<KronosKind, number> {
  const out = noneRead();
  for (const kind of KRONOS_KINDS) out[kind] = (rows[kind] ?? []).length;
  return out;
}

interface PushOutcome {
  /** False when the event reached iCloud but ROME failed to write it down. */
  recorded: boolean;
  note?: string;
}

function titleOf(action: PushAction): string {
  return String(action.row.title ?? `#${action.row.id}`);
}

export function describeFailure(action: PushAction, error: unknown): string {
  const title = titleOf(action);
  if (error instanceof DavError) {
    // The same 412 means opposite things on the two paths, and `DavError` only
    // knows the status. On an update it is "someone edited this while we were
    // writing"; on a create it is "there is already something at that address"
    // — and telling someone their event changed on iCloud when they were
    // creating it sends them looking for an edit that never happened.
    if (error.kind === "precondition" && action.op === "create") {
      return `${title}: something already exists at ${action.href} on iCloud, and ROME could not read it to merge.`;
    }
    return `${title}: ${error.userMessage}`;
  }
  return `${title}: could not be sent.`;
}

/**
 * Why the bookkeeping failed.
 *
 * The overwhelmingly likely cause on a first run is the v2 migration not having
 * been applied, which shows up as PostgREST refusing a column it cannot find.
 * Saying so beats a generic failure that leaves someone re-pressing Send.
 */
export function describeWritebackFailure(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? "");
  if (/column|schema cache|PGRST\d+|does not exist/i.test(text)) {
    return "the sync columns are missing. Run script/sql/2026-08-kronos-v2.sql in Supabase, then sync again.";
  }
  return text || "the ROME server rejected the update.";
}

export { localDay };

/** The last path segment of an href — the `.ics` filename. */
export function resourceName(href: string): string {
  const path = String(href ?? "").split("?")[0].replace(/\/+$/, "");
  return path.slice(path.lastIndexOf("/") + 1);
}
