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

import { DavError, IcloudDav, looksMangled } from "./icloud-dav";
import {
  KRONOS_KINDS, KIND_FIELDS, emptyRows, localDay, planPush,
  type KronosKind, type KronosRow, type PushAction, type PushPlan, type RowsByKind,
} from "./sync-plan";

export interface SyncCalendar { id: number; name: string }

export interface CycleReport {
  ok: boolean;
  dryRun: boolean;
  plan: PushPlan;
  pushed: number;
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
      const calendar = await this.romeCalendar();
      if (!calendar) {
        return this.report(dryRun, emptyPlan(), 0, 0, ["ROME has no calendar to sync."], false);
      }

      const rows = await this.readRows(calendar.id);
      const plan = planPush(rows, calendarPath);
      this.setStatus({ pending: plan.creates + plan.updates });

      if (dryRun) {
        this.setStatus({ state: "idle" });
        return this.report(true, plan, 0, 0, [], true);
      }

      let pushed = 0;
      const problems: string[] = [];

      for (const action of plan.actions) {
        if (action.op === "skip") continue;
        try {
          await this.push(client, action);
          pushed += 1;
        } catch (error) {
          problems.push(describeFailure(action, error));
          // Keep going. One event Apple refuses should not strand the other
          // forty — and the failure is reported rather than swallowed.
        }
      }

      this.setStatus({
        state: problems.length ? "error" : "idle",
        lastSyncAt: Date.now(),
        lastPushed: pushed,
        lastError: problems[0] ?? null,
        pending: Math.max(0, plan.creates + plan.updates - pushed),
      });

      return this.report(false, plan, pushed, problems.length, problems, problems.length === 0);
    } catch (error) {
      const message = error instanceof DavError ? error.userMessage : "The sync could not run.";
      this.setStatus({ state: "error", lastError: message });
      return this.report(dryRun, emptyPlan(), 0, 1, [message], false);
    } finally {
      this.running = false;
    }
  }

  // ── One action ────────────────────────────────────────────────────────────

  private async push(client: IcloudDav, action: PushAction): Promise<void> {
    const { kind, row, href, ics } = action;
    if (!href || !ics) return;

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
        if (!existing) throw error;
        result = await client.putEvent(href, ics, { ifMatch: existing.etag });
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

    await this.markSynced(kind, row, { href, etag, raw });
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
    const response = await fetch(`${this.options.serverBase}${pathname}`, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
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
    problems: string[], ok: boolean,
  ): CycleReport {
    return { ok, dryRun, plan, pushed, failed, problems, finishedAt: Date.now() };
  }
}

function emptyPlan(): PushPlan {
  return { actions: [], creates: 0, updates: 0, skipped: 0 };
}

function describeFailure(action: PushAction, error: unknown): string {
  const title = String(action.row.title ?? `#${action.row.id}`);
  if (error instanceof DavError) return `${title}: ${error.userMessage}`;
  return `${title}: could not be sent.`;
}

export { localDay };
