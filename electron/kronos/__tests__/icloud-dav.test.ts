/**
 * The iCloud CalDAV client, driven against captured responses.
 *
 * `fetch` is injected, so the whole client runs here with no network and no
 * credentials. What is worth testing is not "does it parse XML" — `dav-xml`
 * covers that — but the handful of behaviours that are specific to Apple and
 * silently wrong if you assume the RFC is the whole story: the partition
 * redirect, the missing ETag on PUT, deletions arriving as bare 404s, and an
 * expired sync token being routine rather than a failure.
 *
 * Run: npm run test:kronos
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  DavError,
  IcloudDav,
  escapeXml,
  looksMangled,
  toPath,
} from "../icloud-dav";

// ── Harness ─────────────────────────────────────────────────────────────────

interface Sent { url: string; method: string; headers: Record<string, string>; body?: string }

type Queued = { status: number; body?: string; headers?: Record<string, string>; hang?: boolean };

function stub(queue: Queued[]) {
  const sent: Sent[] = [];
  const fetchImpl = async (url: string, init: any) => {
    sent.push({ url, method: init.method, headers: init.headers, body: init.body });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected request: ${init.method} ${url}`);
    // A server that accepts the connection and then says nothing — which is
    // exactly what iCloud did to a multiget carrying a Depth header.
    if (next.hang) {
      await new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }
    // 204/205/304 must be constructed with a null body or `Response` throws —
    // and `request` turns any throw from fetch into a network error, so the
    // harness getting this wrong looks exactly like iCloud being unreachable.
    const nullBody = next.status === 204 || next.status === 205 || next.status === 304;
    return new Response(nullBody ? null : (next.body ?? null), {
      status: next.status,
      headers: next.headers ?? {},
    });
  };
  return { sent, fetchImpl: fetchImpl as any };
}

function client(queue: Queued[], timeoutMs?: number) {
  const s = stub(queue);
  return {
    sent: s.sent,
    dav: new IcloudDav({
      credentials: { username: "someone@example.com", password: "abcd-efgh-ijkl-mnop" },
      fetchImpl: s.fetchImpl,
      ...(timeoutMs ? { timeoutMs } : {}),
    }),
  };
}

const ms = (inner: string) =>
  `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" ` +
  `xmlns:CS="http://calendarserver.org/ns/" xmlns:IC="http://apple.com/ns/ical/">${inner}</D:multistatus>`;

const PRINCIPAL = ms(
  `<D:response><D:href>/</D:href><D:propstat><D:prop>` +
  `<D:current-user-principal><D:href>/1234567/principal/</D:href></D:current-user-principal>` +
  `</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`,
);

const HOME = ms(
  `<D:response><D:href>/1234567/principal/</D:href><D:propstat><D:prop>` +
  `<C:calendar-home-set><D:href>/1234567/calendars/</D:href></C:calendar-home-set>` +
  `</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`,
);

const discovery = [
  { status: 207, body: PRINCIPAL },
  { status: 207, body: HOME },
];

// ── Units ───────────────────────────────────────────────────────────────────

test("hrefs reduce to paths, whatever form the server used", () => {
  assert.equal(toPath("/1234567/calendars/home/a.ics"), "/1234567/calendars/home/a.ics");
  // The reason this exists: a stored absolute URL bakes in the partition host.
  assert.equal(toPath("https://p42-caldav.icloud.com/1234567/calendars/home/a.ics"), "/1234567/calendars/home/a.ics");
  assert.equal(toPath(""), "");
});

test("XML values are escaped, because a sync token is opaque server text", () => {
  assert.equal(escapeXml(`a&b<c>"d"'e'`), "a&amp;b&lt;c&gt;&quot;d&quot;&apos;e&apos;");
});

test("a replacement character marks a body that lost bytes on the way", () => {
  assert.equal(looksMangled("SUMMARY:café"), false);
  assert.equal(looksMangled("SUMMARY:caf�"), true);
});

// ── Transport ───────────────────────────────────────────────────────────────

test("the partition redirect is followed with the method and body intact", async () => {
  const { dav, sent } = client([
    { status: 302, headers: { location: "https://p42-caldav.icloud.com/" } },
    { status: 207, body: PRINCIPAL },
    { status: 207, body: HOME },
  ]);

  const found = await dav.discover();

  assert.equal(sent[0].method, "PROPFIND");
  assert.equal(sent[1].method, "PROPFIND", "an automatic redirect could have downgraded this to GET");
  assert.ok(sent[1].body?.includes("current-user-principal"), "and could have dropped the body");
  assert.equal(sent[1].url, "https://p42-caldav.icloud.com/");

  // The move sticks: everything after goes straight to the partition.
  assert.ok(sent[2].url.startsWith("https://p42-caldav.icloud.com/"));
  assert.equal(found.origin, "https://p42-caldav.icloud.com");
  assert.equal(found.homePath, "/1234567/calendars/");
});

test("a redirect with no destination is an error rather than a silent stop", async () => {
  const { dav } = client([{ status: 302 }]);
  await assert.rejects(() => dav.discover(), (e: DavError) => e.kind === "unexpected");
});

test("credentials are sent as Basic auth and never echoed into an error", async () => {
  const { dav, sent } = client([{ status: 207, body: PRINCIPAL }, { status: 207, body: HOME }]);
  await dav.discover();
  assert.equal(
    sent[0].headers.Authorization,
    "Basic " + Buffer.from("someone@example.com:abcd-efgh-ijkl-mnop").toString("base64"),
  );

  const failing = new IcloudDav({
    credentials: { username: "u@example.com", password: "secret-app-password" },
    fetchImpl: (async () => { throw new Error("boom: abcd-efgh"); }) as any,
  });
  await assert.rejects(() => failing.discover(), (error: DavError) => {
    assert.equal(error.kind, "network");
    // undici errors can carry the request headers, and those hold the password.
    assert.ok(!JSON.stringify(error).includes("secret-app-password"));
    assert.ok(!error.message.includes("secret-app-password"));
    return true;
  });
});

test("401 names the app-specific password, because that is the fixable thing", async () => {
  const { dav } = client([{ status: 401, body: "" }]);
  await assert.rejects(() => dav.discover(), (error: DavError) => {
    assert.equal(error.kind, "auth");
    assert.match(error.userMessage, /app-specific password/);
    return true;
  });
});

// ── Discovery ───────────────────────────────────────────────────────────────

test("calendars that cannot hold events are not offered", async () => {
  const { dav } = client([
    ...discovery,
    {
      status: 207,
      body: ms(
        `<D:response><D:href>https://p1-caldav.icloud.com/1234567/calendars/home/</D:href><D:propstat><D:prop>` +
        `<D:resourcetype><D:collection/><C:calendar/></D:resourcetype>` +
        `<D:displayname>Home</D:displayname>` +
        `<C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set>` +
        `</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>` +
        `<D:response><D:href>/1234567/calendars/tasks/</D:href><D:propstat><D:prop>` +
        `<D:resourcetype><D:collection/><C:calendar/></D:resourcetype>` +
        `<D:displayname>Reminders</D:displayname>` +
        `<C:supported-calendar-component-set><C:comp name="VTODO"/></C:supported-calendar-component-set>` +
        `</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`,
      ),
    },
  ]);

  const calendars = await dav.listCalendars();
  assert.deepEqual(calendars.map(c => c.displayName), ["Home"]);
  assert.equal(calendars[0].href, "/1234567/calendars/home/", "absolute hrefs are reduced to paths");
});

test("a new calendar is created as VEVENT-only, under the home set", async () => {
  const { dav, sent } = client([...discovery, { status: 201 }]);
  const path = await dav.makeCalendar("ROME", "#D4AF37FF");

  assert.equal(sent[2].method, "MKCALENDAR");
  assert.ok(path.startsWith("/1234567/calendars/rome-"));
  assert.ok(path.endsWith("/"));
  assert.ok(sent[2].body?.includes("<D:displayname>ROME</D:displayname>"));
  assert.ok(sent[2].body?.includes('name="VEVENT"'));
});

// ── sync-collection ─────────────────────────────────────────────────────────

const CAL = "/1234567/calendars/home/";

test("the first sync sends an empty token and gets the set and the token at once", async () => {
  const { dav, sent } = client([{
    status: 207,
    body: ms(
      `<D:response><D:href>${CAL}a.ics</D:href><D:propstat><D:prop>` +
      `<D:getetag>"e1"</D:getetag></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>` +
      `<D:sync-token>tok-1</D:sync-token>`,
    ),
  }]);

  const result = await dav.syncCollection(CAL, null);
  assert.ok(sent[0].body?.includes("<D:sync-token/>"), "an empty element is how RFC 6578 says 'everything'");
  assert.equal(sent[0].headers.Depth, "0");
  assert.equal(result.token, "tok-1");
  assert.deepEqual(result.changes, [{ href: `${CAL}a.ics`, etag: '"e1"', ics: null, deleted: false }]);
  assert.equal(result.truncated, false);
});

test("a deletion arrives as a bare 404 response with no properties", async () => {
  const { dav } = client([{
    status: 207,
    body: ms(
      `<D:response><D:href>${CAL}gone.ics</D:href><D:status>HTTP/1.1 404 Not Found</D:status></D:response>` +
      `<D:sync-token>tok-2</D:sync-token>`,
    ),
  }]);

  const result = await dav.syncCollection(CAL, "tok-1");
  assert.deepEqual(result.changes, [{ href: `${CAL}gone.ics`, etag: null, ics: null, deleted: true }]);
});

test("an existing token is escaped into the request", async () => {
  const { dav, sent } = client([{ status: 207, body: ms(`<D:sync-token>t2</D:sync-token>`) }]);
  await dav.syncCollection(CAL, 'https://p42/sync?a=1&b="2"');
  assert.ok(sent[0].body?.includes("a=1&amp;b=&quot;2&quot;"));
});

test("a capped response is reported, not quietly treated as the whole answer", async () => {
  const { dav } = client([{
    status: 207,
    body: ms(
      `<D:response><D:href>${CAL}a.ics</D:href><D:status>HTTP/1.1 507 Insufficient Storage</D:status></D:response>` +
      `<D:sync-token>tok-3</D:sync-token>`,
    ),
  }]);
  const result = await dav.syncCollection(CAL, "tok-2");
  assert.equal(result.truncated, true);
  assert.equal(result.changes.length, 0, "a cap is not a change");
  assert.equal(result.token, "tok-3", "and the token still advances");
});

test("an expired sync token is its own kind, because it is not a failure", async () => {
  const { dav } = client([{
    status: 403,
    body: `<?xml version="1.0"?><D:error xmlns:D="DAV:"><D:valid-sync-token/></D:error>`,
  }]);
  await assert.rejects(() => dav.syncCollection(CAL, "stale"), (error: DavError) => {
    assert.equal(error.kind, "syncTokenExpired");
    assert.notEqual(error.kind, "forbidden", "a 403 here means start over, not permission denied");
    return true;
  });
});

test("a body volunteered inline is used rather than re-fetched", async () => {
  const { dav } = client([{
    status: 207,
    body: ms(
      `<D:response><D:href>${CAL}a.ics</D:href><D:propstat><D:prop><D:getetag>"e"</D:getetag>` +
      `<C:calendar-data>BEGIN:VCALENDAR\nEND:VCALENDAR</C:calendar-data>` +
      `</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response><D:sync-token>t</D:sync-token>`,
    ),
  }]);
  const result = await dav.syncCollection(CAL, null);
  assert.ok(result.changes[0].ics?.startsWith("BEGIN:VCALENDAR"));
});

// ── multiget ────────────────────────────────────────────────────────────────

test("hrefs are batched, deduplicated and requested as paths", async () => {
  const hrefs = Array.from({ length: 120 }, (_, i) => `${CAL}e${i}.ics`);
  const page = (from: number, count: number) =>
    ms(Array.from({ length: count }, (_, i) =>
      `<D:response><D:href>${CAL}e${from + i}.ics</D:href><D:propstat><D:prop>` +
      `<D:getetag>"t${from + i}"</D:getetag><C:calendar-data>BEGIN:VCALENDAR</C:calendar-data>` +
      `</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`).join(""));

  const { dav, sent } = client([
    { status: 207, body: page(0, 50) },
    { status: 207, body: page(50, 50) },
    { status: 207, body: page(100, 20) },
  ]);

  const bodies = await dav.multiget(CAL, [...hrefs, ...hrefs.slice(0, 10)]);
  assert.equal(sent.length, 3, "120 unique hrefs at 50 per batch");
  assert.equal(bodies.length, 120);
  assert.equal(bodies[0].etag, '"t0"');
});

test("multiget sends no Depth header at all", async () => {
  // RFC 4791 §7.9: for calendar-multiget the Depth header "MUST be ignored by
  // the server and SHOULD NOT be sent by the client" — the hrefs already say
  // precisely which resources are wanted. iCloud does not merely ignore a
  // `Depth: 0` here; it stops answering, and the request hangs until the
  // client's own timeout fires. Found on a real account, 2026-08-28.
  const { dav, sent } = client([{ status: 207, body: ms("") }]);
  await dav.multiget(CAL, [`${CAL}a.ics`]);
  assert.equal(sent[0].headers.Depth, undefined);
});

test("sync-collection still sends Depth: 0, because RFC 6578 requires it", async () => {
  const { dav, sent } = client([{ status: 207, body: ms(`<D:sync-token>t</D:sync-token>`) }]);
  await dav.syncCollection(CAL, null);
  assert.equal(sent[0].headers.Depth, "0", "the two REPORTs have opposite requirements");
});

test("a server that goes quiet is a timeout, not a network failure", async () => {
  const { dav } = client([{ status: 207, hang: true }], 40);
  await assert.rejects(() => dav.syncCollection(CAL, null), (error: DavError) => {
    assert.equal(error.kind, "timeout");
    // "Could not reach iCloud" sends someone to check their wifi when the
    // connection was fine and the server simply never answered.
    assert.match(error.userMessage, /did not answer in time/);
    assert.doesNotMatch(error.userMessage, /Could not reach/);
    return true;
  });
});

test("a batch that times out is retried one GET at a time", async () => {
  const { dav, sent } = client([
    { status: 207, hang: true },                                        // the multiget
    { status: 200, body: "BEGIN:VCALENDAR:a", headers: { etag: '"a"' } }, // GET 1
    { status: 404 },                                                     // GET 2 — since deleted
    { status: 200, body: "BEGIN:VCALENDAR:c", headers: { etag: '"c"' } }, // GET 3
  ], 40);

  const bodies = await dav.multiget(CAL, [`${CAL}a.ics`, `${CAL}b.ics`, `${CAL}c.ics`]);

  assert.equal(sent[0].method, "REPORT");
  assert.deepEqual(sent.slice(1).map(r => r.method), ["GET", "GET", "GET"]);
  assert.deepEqual(bodies.map(b => b.etag), ['"a"', '"c"'], "the deleted one is simply absent");
});

test("an auth failure is never retried as a hail of GETs", async () => {
  // Retrying a 401 fifty times is the same mistake fifty times, and from
  // Apple's side it looks like a brute-force attempt.
  const { dav, sent } = client([{ status: 401 }]);
  await assert.rejects(() => dav.multiget(CAL, [`${CAL}a.ics`, `${CAL}b.ics`]),
    (error: DavError) => error.kind === "auth");
  assert.equal(sent.length, 1);
});

test("a body that lost bytes in the XML decode is flagged for a raw re-read", async () => {
  const { dav } = client([{
    status: 207,
    body: ms(
      `<D:response><D:href>${CAL}a.ics</D:href><D:propstat><D:prop><D:getetag>"e"</D:getetag>` +
      `<C:calendar-data>SUMMARY:caf�</C:calendar-data>` +
      `</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`,
    ),
  }]);
  const [body] = await dav.multiget(CAL, [`${CAL}a.ics`]);
  assert.equal(body.mangled, true);
});

test("getEvent returns octets, which is the whole point of having it", async () => {
  const { dav } = client([{ status: 200, body: "BEGIN:VCALENDAR", headers: { etag: '"raw-1"' } }]);
  const got = await dav.getEvent(`${CAL}a.ics`);
  assert.equal(got?.etag, '"raw-1"');
  assert.ok(got?.bytes instanceof Uint8Array, "not a string — ical.ts unfolds before decoding");
});

test("reading an event that has since been deleted is null, not an error", async () => {
  const { dav } = client([{ status: 404 }]);
  assert.equal(await dav.getEvent(`${CAL}gone.ics`), null);
});

// ── Writing ─────────────────────────────────────────────────────────────────

test("a create guards against clobbering, a replace guards against drift", async () => {
  const { dav, sent } = client([
    { status: 201, headers: { etag: '"new"' } },
    { status: 204, headers: { etag: '"upd"' } },
  ]);

  const created = await dav.putEvent(`${CAL}a.ics`, "BEGIN:VCALENDAR", { ifNoneMatch: true });
  assert.equal(sent[0].headers["If-None-Match"], "*");
  assert.equal(sent[0].headers["Content-Type"], "text/calendar; charset=utf-8");
  assert.equal(created.created, true);
  assert.equal(created.etag, '"new"');

  const updated = await dav.putEvent(`${CAL}a.ics`, "BEGIN:VCALENDAR", { ifMatch: '"old"' });
  assert.equal(sent[1].headers["If-Match"], '"old"');
  assert.equal(updated.created, false);
});

test("Apple answering a PUT with no ETag is not an error and not a conflict", async () => {
  // It rewrites the resource server-side and often omits the header. Treating
  // that as a mismatch makes the next cycle rewrite every event, forever.
  const { dav } = client([{ status: 204 }]);
  const result = await dav.putEvent(`${CAL}a.ics`, "BEGIN:VCALENDAR", { ifMatch: '"old"' });
  assert.equal(result.etag, null);
  assert.equal(result.status, 204);
});

test("a 412 is a precondition failure the caller can recognise", async () => {
  const { dav } = client([{ status: 412 }]);
  await assert.rejects(
    () => dav.putEvent(`${CAL}a.ics`, "BEGIN:VCALENDAR", { ifMatch: '"stale"' }),
    (error: DavError) => error.kind === "precondition",
  );
});

test("deleting something already gone reports false rather than throwing", async () => {
  const gone = client([{ status: 404 }]);
  assert.equal(await gone.dav.deleteEvent(`${CAL}a.ics`), false);

  const done = client([{ status: 204 }]);
  assert.equal(await done.dav.deleteEvent(`${CAL}a.ics`, '"e"'), true);
  assert.equal(done.sent[0].headers["If-Match"], '"e"');
});

test("a 5xx is marked as transient, so the engine can back off instead of stopping", async () => {
  const { dav } = client([{ status: 503 }]);
  await assert.rejects(() => dav.discover(), (error: DavError) => {
    assert.equal(error.kind, "server");
    assert.match(error.userMessage, /clears on its own/);
    return true;
  });
});
