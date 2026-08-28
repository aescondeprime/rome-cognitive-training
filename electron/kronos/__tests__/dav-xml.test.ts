/**
 * WebDAV XML reading.
 *
 * The fixtures use three different namespace prefixes on purpose — `D:`, `d:`
 * and a default `xmlns` — because that is the range real servers emit and a
 * reader that matches `<D:href>` works right up until it does not.
 *
 * Run: npm run test:kronos
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  child,
  decodeEntities,
  findAll,
  hrefsOf,
  parseMultistatus,
  parseStatusCode,
  parseXml,
  preconditionCodes,
  readCalendars,
  textOf,
} from "../dav-xml";

// ── Parser ──────────────────────────────────────────────────────────────────

test("namespace prefixes are discarded, whatever they are", () => {
  const a = parseXml('<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"><D:href>/a</D:href></D:multistatus>')!;
  const b = parseXml('<x0:multistatus xmlns:x0="DAV:"><x0:href>/a</x0:href></x0:multistatus>')!;
  const c = parseXml('<multistatus xmlns="DAV:"><href>/a</href></multistatus>')!;
  for (const root of [a, b, c]) {
    assert.equal(root.name, "multistatus");
    assert.equal(textOf(child(root, "href")), "/a");
  }
});

test("attributes survive, because the component set lives in one", () => {
  const root = parseXml('<C:comp name="VEVENT" xmlns:C="urn:ietf:params:xml:ns:caldav"/>')!;
  assert.equal(root.attrs.name, "VEVENT");
});

test("self-closing, comments and CDATA are handled", () => {
  const root = parseXml("<a><!-- note --><b/><c><![CDATA[<raw> & stuff]]></c></a>")!;
  assert.equal(root.children.length, 2);
  assert.equal(root.children[0].name, "b");
  assert.equal(textOf(child(root, "c")), "<raw> & stuff");
});

test("entities decode, including numeric ones", () => {
  assert.equal(decodeEntities("a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &#x2713;"), `a & b <c> "d" 'e' ✓`);
  assert.equal(decodeEntities("&notanentity;"), "&notanentity;", "unknown entities are left alone");
});

test("a quoted attribute may contain a closing angle bracket", () => {
  const root = parseXml('<a title="1 > 0"><b/></a>')!;
  assert.equal(root.attrs.title, "1 > 0");
  assert.equal(root.children.length, 1);
});

test("malformed input yields what was understood rather than throwing", () => {
  assert.doesNotThrow(() => parseXml("<a><b></a>"));
  assert.doesNotThrow(() => parseXml("<a"));
  assert.equal(parseXml(""), null);
});

test("status lines reduce to a code", () => {
  assert.equal(parseStatusCode("HTTP/1.1 404 Not Found"), 404);
  assert.equal(parseStatusCode("HTTP/1.1 200 OK"), 200);
  assert.equal(parseStatusCode("garbage"), null);
});

// ── Discovery ───────────────────────────────────────────────────────────────

const PRINCIPAL = `<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:">
  <response>
    <href>/</href>
    <propstat>
      <prop><current-user-principal><href>/1234567/principal/</href></current-user-principal></prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
</multistatus>`;

test("the principal href is found under whatever wrapping", () => {
  const { responses } = parseMultistatus(PRINCIPAL);
  assert.equal(responses.length, 1);
  assert.deepEqual(hrefsOf(responses[0].props["current-user-principal"]), ["/1234567/principal/"]);
});

const CALENDARS = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:ic="http://apple.com/ns/ical/">
  <d:response>
    <d:href>/1234567/calendars/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
  <d:response>
    <d:href>/1234567/calendars/home/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
        <d:displayname>Home</d:displayname>
        <ic:calendar-color>#FF2968</ic:calendar-color>
        <cs:getctag>HH-1</cs:getctag>
        <c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/1234567/calendars/tasks/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
        <d:displayname>Reminders</d:displayname>
        <c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/1234567/calendars/notification/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
    <d:propstat><d:prop><d:displayname/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat>
  </d:response>
</d:multistatus>`;

test("only VEVENT calendars are offered", () => {
  const found = readCalendars(CALENDARS);
  assert.deepEqual(found.map(c => c.displayName), ["Home"]);
  assert.equal(found[0].href, "/1234567/calendars/home/");
  assert.equal(found[0].color, "#FF2968");
  assert.equal(found[0].ctag, "HH-1");
});

test("a Reminders list is a calendar by resourcetype and still excluded", () => {
  // It is; iCloud returns it in the same 207; and a VEVENT PUT into it is a 403.
  assert.ok(!readCalendars(CALENDARS).some(c => c.displayName === "Reminders"));
});

test("properties reported 404 land in `missing`, not in `props`", () => {
  const notification = parseMultistatus(CALENDARS).responses[3];
  assert.ok(!("displayname" in notification.props));
  assert.deepEqual(notification.missing, ["displayname"]);
});

// ── sync-collection ─────────────────────────────────────────────────────────

const SYNC = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/1234567/calendars/home/kept.ics</d:href>
    <d:propstat>
      <d:prop><d:getetag>"etag-1"</d:getetag><c:calendar-data>BEGIN:VCALENDAR
END:VCALENDAR</c:calendar-data></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/1234567/calendars/home/gone.ics</d:href>
    <d:status>HTTP/1.1 404 Not Found</d:status>
  </d:response>
  <d:sync-token>https://p42-caldav.icloud.com/sync/9182</d:sync-token>
</d:multistatus>`;

test("a deletion arrives as a response-level 404 with no propstat", () => {
  const { responses } = parseMultistatus(SYNC);
  const gone = responses.find(r => r.href.endsWith("gone.ics"))!;
  assert.equal(gone.status, 404);
  assert.deepEqual(gone.props, {});
});

test("a surviving resource carries its etag and body", () => {
  const kept = parseMultistatus(SYNC).responses.find(r => r.href.endsWith("kept.ics"))!;
  assert.equal(kept.status, null, "no response-level status when propstats answered");
  assert.equal(textOf(kept.props["getetag"]), '"etag-1"');
  assert.ok(textOf(kept.props["calendar-data"]).startsWith("BEGIN:VCALENDAR"));
});

test("the sync token is returned verbatim", () => {
  assert.equal(parseMultistatus(SYNC).syncToken, "https://p42-caldav.icloud.com/sync/9182");
  assert.equal(parseMultistatus(PRINCIPAL).syncToken, null);
});

test("an expired sync token is identifiable, so it is not shown as an error", () => {
  const body = `<?xml version="1.0"?><D:error xmlns:D="DAV:"><D:valid-sync-token/></D:error>`;
  assert.deepEqual(preconditionCodes(body), ["valid-sync-token"]);
  assert.deepEqual(preconditionCodes("<D:multistatus xmlns:D='DAV:'/>"), []);
});

test("findAll reaches nested elements regardless of depth", () => {
  assert.equal(findAll(parseXml(SYNC), "href").length, 2);
});
