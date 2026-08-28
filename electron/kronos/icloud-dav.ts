/**
 * iCloud CalDAV — the only file in the sync that touches the network.
 *
 * Everything above this reads what comes back (`dav-xml.ts`) or interprets it
 * (`ical.ts`, `rrule.ts`); everything below it is the engine's decisions. This
 * layer's whole job is to get bytes to and from Apple without losing any.
 *
 * `fetch` is injected rather than closed over, so the tests drive the whole
 * client against captured responses with no network and no credentials.
 *
 * ── Four things that are specific to iCloud ─────────────────────────────────
 *
 * **1. The account lives on a partition host.** `caldav.icloud.com` redirects
 * to `pNN-caldav.icloud.com`, and which N is account-specific and can change.
 * Redirects are therefore followed **manually**: an automatic redirect on a
 * request with a body is entitled to drop that body or downgrade the method to
 * GET, and a PROPFIND that arrives as a bodyless GET returns something that
 * parses to nothing at all. The new origin is remembered for the session, and
 * every href we store is a **path**, never an absolute URL — bake `p42-` into
 * stored data and the day Apple moves the account every row 404s.
 *
 * **2. Bodies are read as bytes.** `ical.ts` unfolds before decoding because a
 * fold can split a UTF-8 sequence; `res.text()` would decode first and the
 * character would already be two U+FFFD by the time the parser saw it. See
 * `looksMangled` for the one case where that cannot be avoided.
 *
 * **3. The first sync is a `sync-collection` with an empty token**, not a
 * PROPFIND followed by a token request. The two-step version has a window
 * between the listing and the token where a change lands and is never reported
 * again — an event created in that gap stays invisible until something else
 * forces a full resync.
 *
 * **4. An expired sync token is not an error.** It comes back as a
 * `valid-sync-token` precondition and means "start over", which is routine
 * housekeeping. Surfacing it to the user as a sync failure trains them to
 * ignore the one indicator that matters.
 */

import { readCalendars, parseMultistatus, preconditionCodes, textOf, type DavCalendar } from "./dav-xml";

export const ICLOUD_ROOT = "https://caldav.icloud.com";

/** Hrefs per calendar-multiget. Apple tolerates more; this keeps bodies sane. */
const MULTIGET_BATCH = 50;

/** A redirect chain longer than this is a loop, not a partition move. */
const MAX_HOPS = 5;

/**
 * `ROME_ICLOUD_DEBUG=1` prints one line per request: method, path, status,
 * milliseconds. Never headers — those carry the password.
 */
const DEBUG = process.env.ROME_ICLOUD_DEBUG === "1";

function trace(line: string): void {
  if (DEBUG) console.log(`[icloud] ${line}`);
}

// ── Errors ──────────────────────────────────────────────────────────────────

export type DavErrorKind =
  | "auth"              // 401 — wrong Apple ID, or the app-specific password was revoked
  | "forbidden"         // 403 — often a VEVENT written into a VTODO collection
  | "notfound"          // 404
  | "precondition"      // 412 — the ETag moved under us
  | "syncTokenExpired"  // start over; not a failure
  | "network"           // never reached Apple
  | "timeout"           // reached Apple, and it went quiet
  | "server"            // 5xx
  | "unexpected";

export class DavError extends Error {
  readonly kind: DavErrorKind;
  readonly status: number;
  /** Response body, truncated. Never contains credentials — see `request`. */
  readonly detail: string;

  constructor(message: string, kind: DavErrorKind, status = 0, detail = "") {
    super(message);
    this.name = "DavError";
    this.kind = kind;
    this.status = status;
    this.detail = detail.slice(0, 600);
  }

  /**
   * What to put in front of a person.
   *
   * `last_error` is rendered verbatim in the sync panel, so "401" has to become
   * a sentence that names the thing they can fix. A revoked app-specific
   * password is the single most likely failure after setup and it must not
   * present as "something went wrong".
   */
  get userMessage(): string {
    switch (this.kind) {
      case "auth":
        return "Apple rejected the app-specific password. Generate a new one at appleid.apple.com and paste it in again.";
      case "forbidden":
        return "Apple refused the request. If this started after choosing a calendar, that calendar may not accept events.";
      case "notfound":
        return "That calendar is no longer on iCloud. Reconnect and choose one again.";
      case "precondition":
        return "The event changed on iCloud while ROME was writing it.";
      case "network":
        return "Could not reach iCloud.";
      case "timeout":
        // Worth its own kind. "Could not reach iCloud" sends someone to check
        // their wifi when the connection was fine and the server simply never
        // answered — a different problem with a different fix.
        return "iCloud accepted the connection but did not answer in time.";
      case "server":
        return `iCloud returned an error (${this.status}). It usually clears on its own.`;
      default:
        return this.message;
    }
  }
}

// ── Wire types ──────────────────────────────────────────────────────────────

export interface DavCredentials {
  /** The Apple ID email. */
  username: string;
  /** An app-specific password. The real Apple ID password is always rejected. */
  password: string;
}

export interface RawResponse {
  status: number;
  headers: Headers;
  bytes: Uint8Array;
  /** The body decoded as UTF-8. Safe for XML; see the header for `.ics`. */
  text: string;
}

export interface SyncChange {
  /** Path-only. */
  href: string;
  etag: string | null;
  /** Present when the server volunteered the body; null means fetch it. */
  ics: string | null;
  deleted: boolean;
}

export interface SyncResult {
  token: string | null;
  changes: SyncChange[];
  /**
   * The server capped the response. The token is still valid — call again with
   * it to collect the rest. Ignoring this silently syncs a prefix of a large
   * calendar and looks like data loss.
   */
  truncated: boolean;
}

export interface ResourceBody {
  href: string;
  etag: string | null;
  ics: string;
  /**
   * The body came back through XML with replacement characters in it, which
   * means a fold split a UTF-8 sequence somewhere upstream. The caller should
   * re-read this one resource with `getEvent`, which reads raw octets.
   */
  mangled: boolean;
}

export interface PutResult {
  /** Null when Apple did not return one — common, and not an error. */
  etag: string | null;
  status: number;
  created: boolean;
}

export interface FetchLike {
  (url: string, init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    redirect: "manual";
    signal?: AbortSignal;
  }): Promise<Response>;
}

export interface IcloudDavOptions {
  credentials: DavCredentials;
  /** Defaults to `ICLOUD_ROOT`. */
  root?: string;
  /** Injected for tests. Defaults to global `fetch`. */
  fetchImpl?: FetchLike;
  /** Per-request timeout. */
  timeoutMs?: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function escapeXml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * An href reduced to a path.
 *
 * Stored hrefs must never carry the partition hostname; see the header. Also
 * normalises the absolute URLs some servers return in `<href>` while others
 * return paths, so the two are comparable.
 */
export function toPath(href: string, base = ICLOUD_ROOT): string {
  const raw = String(href ?? "").trim();
  if (!raw) return "";
  try {
    return new URL(raw, base).pathname;
  } catch {
    return raw;
  }
}

/**
 * Did a fold split a UTF-8 sequence upstream?
 *
 * Calendar bodies delivered inside a multistatus have been through an XML
 * decode before we ever see them, so `unfoldBytes` never got its chance. A
 * replacement character is the tell, and the fix is to re-read that one
 * resource with a plain GET where the octets survive.
 */
export function looksMangled(ics: string): boolean {
  return ics.includes("�");
}

/**
 * Is this worth retrying one resource at a time?
 *
 * Only for failures that are about the *request shape or the moment*, never for
 * an auth or permission failure — retrying those just makes the same mistake
 * fifty times and looks like a brute-force attempt from Apple's side.
 */
function isRetryableBatchFailure(error: unknown): boolean {
  return error instanceof DavError && (error.kind === "timeout" || error.kind === "server");
}

function basicAuth(credentials: DavCredentials): string {
  const pair = `${credentials.username}:${credentials.password}`;
  return `Basic ${Buffer.from(pair, "utf8").toString("base64")}`;
}

// ── The client ──────────────────────────────────────────────────────────────

export class IcloudDav {
  private readonly credentials: DavCredentials;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  /** Moves to the account's partition host on the first redirect. */
  private origin: string;

  private principalPath = "";
  private homePath = "";

  constructor(options: IcloudDavOptions) {
    this.credentials = options.credentials;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init as RequestInit));
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.origin = new URL(options.root ?? ICLOUD_ROOT).origin;
  }

  /** The partition host currently in use. Diagnostics only — never stored. */
  get currentOrigin(): string {
    return this.origin;
  }

  // ── Transport ─────────────────────────────────────────────────────────────

  private async request(
    method: string,
    path: string,
    options: { body?: string; depth?: "0" | "1"; headers?: Record<string, string> } = {},
  ): Promise<RawResponse> {
    let url = new URL(path || "/", this.origin).toString();

    for (let hop = 0; hop < MAX_HOPS; hop += 1) {
      const headers: Record<string, string> = {
        Authorization: basicAuth(this.credentials),
        "User-Agent": "ROME/1.0",
        ...(options.depth ? { Depth: options.depth } : {}),
        ...(options.body ? { "Content-Type": "application/xml; charset=utf-8" } : {}),
        ...options.headers,
      };

      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
      const startedAt = Date.now();
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method,
          headers,
          body: options.body,
          redirect: "manual",
          signal: controller.signal,
        });
      } catch (error) {
        // Deliberately does not echo the error object: an undici failure can
        // carry the request headers, and those hold the password.
        const elapsed = Date.now() - startedAt;
        trace(`${method} ${path} ${timedOut ? "TIMEOUT" : "NETWORK"} ${elapsed}ms`);
        if (timedOut) {
          throw new DavError(
            `${method} ${path} timed out after ${Math.round(this.timeoutMs / 1000)}s.`,
            "timeout",
          );
        }
        throw new DavError(`${method} ${path} could not reach iCloud.`, "network");
      } finally {
        clearTimeout(timer);
      }
      trace(`${method} ${path} ${response.status} ${Date.now() - startedAt}ms`);

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          throw new DavError(`${method} ${path} redirected with no destination.`, "unexpected", response.status);
        }
        const next = new URL(location, url);
        // The partition move. Remembered so the rest of the session goes
        // straight there rather than bouncing through the front door.
        if (next.origin !== this.origin) this.origin = next.origin;
        url = next.toString();
        continue;   // same method, same body — the reason this is manual
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      return {
        status: response.status,
        headers: response.headers,
        bytes,
        text: new TextDecoder("utf-8").decode(bytes),
      };
    }

    throw new DavError(`${method} ${path} redirected too many times.`, "unexpected");
  }

  /** Maps a status onto a kind, reading the body for DAV preconditions. */
  private fail(method: string, path: string, response: RawResponse): DavError {
    const codes = preconditionCodes(response.text);
    if (codes.includes("valid-sync-token")) {
      return new DavError("The sync token has expired.", "syncTokenExpired", response.status);
    }
    const kind: DavErrorKind =
      response.status === 401 ? "auth"
        : response.status === 403 ? "forbidden"
          : response.status === 404 ? "notfound"
            : response.status === 412 ? "precondition"
              : response.status >= 500 ? "server"
                : "unexpected";
    return new DavError(`${method} ${path} failed with ${response.status}.`, kind, response.status, response.text);
  }

  private expect(method: string, path: string, response: RawResponse, ok: number[]): RawResponse {
    if (!ok.includes(response.status)) throw this.fail(method, path, response);
    return response;
  }

  // ── Discovery ─────────────────────────────────────────────────────────────

  /**
   * Principal, then calendar home.
   *
   * Two round trips rather than one because the home set lives on the
   * principal, and the principal's location is what the partition redirect is
   * usually announcing.
   */
  async discover(): Promise<{ principalPath: string; homePath: string; origin: string }> {
    const principalBody =
      `<?xml version="1.0" encoding="utf-8"?>` +
      `<D:propfind xmlns:D="DAV:"><D:prop><D:current-user-principal/></D:prop></D:propfind>`;

    const first = await this.request("PROPFIND", "/", { body: principalBody, depth: "0" });
    this.expect("PROPFIND", "/", first, [207]);

    const principal = parseMultistatus(first.text).responses
      .map(r => textOf(r.props["current-user-principal"]))
      .find(Boolean);
    if (!principal) {
      throw new DavError("iCloud did not return a principal for this account.", "unexpected", first.status, first.text);
    }
    this.principalPath = toPath(principal, this.origin);

    const homeBody =
      `<?xml version="1.0" encoding="utf-8"?>` +
      `<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">` +
      `<D:prop><C:calendar-home-set/></D:prop></D:propfind>`;

    const second = await this.request("PROPFIND", this.principalPath, { body: homeBody, depth: "0" });
    this.expect("PROPFIND", this.principalPath, second, [207]);

    const home = parseMultistatus(second.text).responses
      .map(r => textOf(r.props["calendar-home-set"]))
      .find(Boolean);
    if (!home) {
      throw new DavError("iCloud did not return a calendar home for this account.", "unexpected", second.status, second.text);
    }
    this.homePath = toPath(home, this.origin);

    return { principalPath: this.principalPath, homePath: this.homePath, origin: this.origin };
  }

  /**
   * Calendars that can hold events.
   *
   * The filtering lives in `readCalendars`, which drops anything whose
   * component set excludes VEVENT — Reminders lists come back in this same
   * response, look like calendars, and reject every event written to them.
   */
  async listCalendars(): Promise<DavCalendar[]> {
    if (!this.homePath) await this.discover();

    const body =
      `<?xml version="1.0" encoding="utf-8"?>` +
      `<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" ` +
      `xmlns:CS="http://calendarserver.org/ns/" xmlns:IC="http://apple.com/ns/ical/">` +
      `<D:prop>` +
      `<D:resourcetype/><D:displayname/>` +
      `<C:supported-calendar-component-set/>` +
      `<CS:getctag/><IC:calendar-color/>` +
      `</D:prop></D:propfind>`;

    const response = await this.request("PROPFIND", this.homePath, { body, depth: "1" });
    this.expect("PROPFIND", this.homePath, response, [207]);

    return readCalendars(response.text).map(calendar => ({
      ...calendar,
      href: toPath(calendar.href, this.origin),
    }));
  }

  /**
   * A dedicated calendar, and the reason the setup flow recommends one.
   *
   * Syncing into an existing personal calendar turns every ROME routine into a
   * real repeating event on the user's phone, and undoing that later is manual
   * cleanup event by event. A calendar of its own can be deleted in one go.
   */
  async makeCalendar(displayName: string, color = "#D4AF37FF"): Promise<string> {
    if (!this.homePath) await this.discover();

    const slug = `rome-${Math.random().toString(36).slice(2, 10)}`;
    const path = `${this.homePath.replace(/\/?$/, "/")}${slug}/`;

    const body =
      `<?xml version="1.0" encoding="utf-8"?>` +
      `<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:IC="http://apple.com/ns/ical/">` +
      `<D:set><D:prop>` +
      `<D:displayname>${escapeXml(displayName)}</D:displayname>` +
      `<IC:calendar-color>${escapeXml(color)}</IC:calendar-color>` +
      `<C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set>` +
      `</D:prop></D:set></C:mkcalendar>`;

    const response = await this.request("MKCALENDAR", path, { body });
    this.expect("MKCALENDAR", path, response, [201, 207]);
    return path;
  }

  // ── Sync ──────────────────────────────────────────────────────────────────

  /**
   * Changes since `token`, or everything when it is null.
   *
   * An empty `<sync-token/>` is the RFC 6578 way of saying "initial sync", and
   * it returns the full set *and* the new token in one response — which is why
   * there is no separate listing step anywhere in this client.
   *
   * `calendar-data` is requested alongside the etag. Apple usually declines to
   * include it here; when it does, `ics` is null and the caller multigets.
   * Asking costs nothing and saves a round trip on the servers that oblige.
   */
  async syncCollection(calendarPath: string, token: string | null): Promise<SyncResult> {
    const body =
      `<?xml version="1.0" encoding="utf-8"?>` +
      `<D:sync-collection xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">` +
      (token ? `<D:sync-token>${escapeXml(token)}</D:sync-token>` : `<D:sync-token/>`) +
      `<D:sync-level>1</D:sync-level>` +
      `<D:prop><D:getetag/><C:calendar-data/></D:prop>` +
      `</D:sync-collection>`;

    const response = await this.request("REPORT", calendarPath, { body, depth: "0" });
    this.expect("REPORT", calendarPath, response, [207]);

    const parsed = parseMultistatus(response.text);
    const changes: SyncChange[] = [];
    let truncated = false;

    for (const item of parsed.responses) {
      const href = toPath(item.href, this.origin);
      if (!href) continue;

      // A response-level status is the server talking about the resource
      // rather than its properties. 404 is a deletion — the only way one is
      // ever reported — and 507 means the answer was capped.
      if (item.status === 404 || item.status === 410) {
        changes.push({ href, etag: null, ics: null, deleted: true });
        continue;
      }
      if (item.status === 507) {
        truncated = true;
        continue;
      }

      const etag = textOf(item.props["getetag"]) || null;
      const data = textOf(item.props["calendar-data"]);
      changes.push({ href, etag, ics: data || null, deleted: false });
    }

    if (/number-of-matches-within-limits/.test(response.text)) truncated = true;

    return { token: parsed.syncToken, changes, truncated };
  }

  /**
   * Bodies for a set of hrefs, batched.
   *
   * Batching is internal because the batch size is a property of the protocol
   * and the server, not of the caller's loop.
   */
  async multiget(calendarPath: string, hrefs: string[]): Promise<ResourceBody[]> {
    const unique = [...new Set(hrefs.map(h => toPath(h, this.origin)).filter(Boolean))];
    const out: ResourceBody[] = [];

    for (let i = 0; i < unique.length; i += MULTIGET_BATCH) {
      const batch = unique.slice(i, i + MULTIGET_BATCH);
      const body =
        `<?xml version="1.0" encoding="utf-8"?>` +
        `<C:calendar-multiget xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">` +
        `<D:prop><D:getetag/><C:calendar-data/></D:prop>` +
        batch.map(href => `<D:href>${escapeXml(href)}</D:href>`).join("") +
        `</C:calendar-multiget>`;

      // No Depth header. RFC 4791 §7.9: for calendar-multiget it "MUST be
      // ignored by the server and SHOULD NOT be sent by the client", because
      // the hrefs already say exactly which resources are wanted. Sending
      // `Depth: 0` here is what iCloud stopped answering.
      let response: RawResponse;
      try {
        response = await this.request("REPORT", calendarPath, { body });
        this.expect("REPORT", calendarPath, response, [207]);
      } catch (error) {
        // A batch that timed out or 5xx'd is retried one resource at a time.
        // `getEvent` is a plain GET, which no server has an opinion about, and
        // the engine needs that path anyway for bodies the XML decode mangled.
        if (!isRetryableBatchFailure(error)) throw error;
        trace(`multiget batch failed (${(error as DavError).kind}) — falling back to ${batch.length} GETs`);
        for (const href of batch) {
          const single = await this.getEvent(href);
          if (!single) continue;
          const ics = new TextDecoder("utf-8").decode(single.bytes);
          out.push({ href, etag: single.etag, ics, mangled: false });
        }
        continue;
      }

      for (const item of parseMultistatus(response.text).responses) {
        const ics = textOf(item.props["calendar-data"]);
        if (!ics) continue;
        out.push({
          href: toPath(item.href, this.origin),
          etag: textOf(item.props["getetag"]) || null,
          ics,
          mangled: looksMangled(ics),
        });
      }
    }

    return out;
  }

  /**
   * One resource, read as raw octets.
   *
   * The repair path for `mangled`, and the only read in the client that gives
   * `ical.ts` the bytes it wants. Returns null for a resource that has since
   * been deleted, which is an ordinary race rather than a failure.
   */
  async getEvent(href: string): Promise<{ etag: string | null; bytes: Uint8Array } | null> {
    const path = toPath(href, this.origin);
    const response = await this.request("GET", path, { headers: { Accept: "text/calendar" } });
    if (response.status === 404 || response.status === 410) return null;
    this.expect("GET", path, response, [200]);
    return { etag: response.headers.get("etag"), bytes: response.bytes };
  }

  // ── Write ─────────────────────────────────────────────────────────────────

  /**
   * Create or replace one event.
   *
   * `ifMatch` guards a replace; `ifNoneMatch` guards a create against
   * clobbering something that appeared since we last looked. Passing neither is
   * a blind write and is deliberately possible only by asking for it.
   *
   * **Apple frequently answers without an ETag**, because it rewrites the
   * resource server-side. That is not an error and not a conflict: the caller
   * re-reads the one href rather than assuming its stored etag still holds.
   * Treating a missing ETag as a mismatch makes every cycle rewrite every
   * event, which is how an account ends up rate-limited.
   */
  async putEvent(
    href: string,
    ics: string,
    options: { ifMatch?: string | null; ifNoneMatch?: boolean } = {},
  ): Promise<PutResult> {
    const path = toPath(href, this.origin);
    const headers: Record<string, string> = { "Content-Type": "text/calendar; charset=utf-8" };
    if (options.ifMatch) headers["If-Match"] = options.ifMatch;
    else if (options.ifNoneMatch) headers["If-None-Match"] = "*";

    const response = await this.request("PUT", path, { body: ics, headers });
    this.expect("PUT", path, response, [200, 201, 204]);

    return {
      etag: response.headers.get("etag"),
      status: response.status,
      created: response.status === 201,
    };
  }

  /**
   * Remove one event.
   *
   * A 404 counts as success: the goal state is "not there", and something else
   * having got there first is not a problem to report.
   */
  async deleteEvent(href: string, ifMatch?: string | null): Promise<boolean> {
    const path = toPath(href, this.origin);
    const headers: Record<string, string> = {};
    if (ifMatch) headers["If-Match"] = ifMatch;

    const response = await this.request("DELETE", path, { headers });
    if (response.status === 404 || response.status === 410) return false;
    this.expect("DELETE", path, response, [200, 204]);
    return true;
  }
}
