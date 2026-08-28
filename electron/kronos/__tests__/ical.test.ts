/**
 * iCalendar reader/writer.
 *
 * The fixture is deliberately shaped like something Apple would actually write:
 * a VTIMEZONE whose DAYLIGHT and STANDARD blocks each carry their own DTSTART
 * *and their own RRULE*, a VALARM with its own DESCRIPTION, a folded SUMMARY
 * containing an escaped comma, and a second same-UID VEVENT carrying a
 * RECURRENCE-ID because one occurrence was dragged. Every one of those is a
 * trap for a reader that greps the file instead of walking it.
 *
 * Run: npm run test:kronos
 */

process.env.TZ = "America/Los_Angeles"; // assertions below are zone-specific

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildVevent,
  escapeText,
  foldLine,
  formatUtcStamp,
  localDateOf,
  localTimeOf,
  localWallToUtcMs,
  parseDuration,
  parseIcalDate,
  parseLine,
  parseRomeUid,
  patchVevent,
  readVevent,
  romeUid,
  unescapeText,
  unfold,
  unfoldBytes,
  zonedWallToUtcMs,
} from "../ical";

// ── Fixture ─────────────────────────────────────────────────────────────────

const APPLE = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Apple Inc.//macOS 15.4//EN",
  "CALSCALE:GREGORIAN",
  "BEGIN:VTIMEZONE",
  "TZID:America/Los_Angeles",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:-0800",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
  "DTSTART:20070311T020000",
  "TZNAME:PDT",
  "TZOFFSETTO:-0700",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:-0700",
  "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
  "DTSTART:20071104T020000",
  "TZNAME:PST",
  "TZOFFSETTO:-0800",
  "END:STANDARD",
  "END:VTIMEZONE",
  "BEGIN:VEVENT",
  "CREATED:20260820T170000Z",
  "UID:ABC-123",
  "DTSTART;TZID=America/Los_Angeles:20260827T100000",
  "DTEND;TZID=America/Los_Angeles:20260827T103000",
  "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR",
  "SUMMARY:Standup\\, then rev",
  " iew",                                    // a fold, mid-word
  "DESCRIPTION:First line\\nSecond line",
  "DTSTAMP:20260826T090000Z",
  "LAST-MODIFIED:20260826T090000Z",
  "SEQUENCE:2",
  "TRANSP:OPAQUE",
  "ATTENDEE;CN=\"Priya, R\";ROLE=REQ-PARTICIPANT:mailto:priya@example.com",
  "X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC",
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "DESCRIPTION:Reminder",
  "TRIGGER:-PT10M",
  "END:VALARM",
  "END:VEVENT",
  // One dragged occurrence. Same UID, different day, no RRULE.
  "BEGIN:VEVENT",
  "UID:ABC-123",
  "RECURRENCE-ID;TZID=America/Los_Angeles:20260828T100000",
  "DTSTART;TZID=America/Los_Angeles:20260828T140000",
  "DTEND;TZID=America/Los_Angeles:20260828T143000",
  "SUMMARY:Standup (moved)",
  "DTSTAMP:20260826T093000Z",
  "SEQUENCE:3",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n") + "\r\n";

// ── Folding ─────────────────────────────────────────────────────────────────

test("unfold rejoins a continuation line", () => {
  assert.equal(unfold("SUMMARY:one\r\n two"), "SUMMARY:onetwo");
  assert.equal(unfold("SUMMARY:one\r\n\ttwo"), "SUMMARY:onetwo");
  assert.equal(unfold("A:1\r\nB:2"), "A:1\r\nB:2", "a real line break is not a fold");
});

test("unfolding on bytes survives a fold that splits a UTF-8 sequence", () => {
  // "é" is C3 A9. Apple folds on octet count, so the fold can land between them.
  const bytes = new Uint8Array([
    0x53, 0x3a, // "S:"
    0xc3, 0x0d, 0x0a, 0x20, 0xa9, // C3, CRLF, space, A9
  ]);
  assert.equal(unfoldBytes(bytes), "S:é");

  // And this is why the order matters: decode first and the character is gone
  // before unfolding ever runs.
  const decodedFirst = new TextDecoder("utf-8").decode(bytes);
  assert.ok(decodedFirst.includes("�"), "decoding first destroys the character");
});

test("foldLine folds at 75 octets with a leading space, never mid-character", () => {
  const long = "SUMMARY:" + "a".repeat(200);
  const folded = foldLine(long);
  const physical = folded.split("\r\n");
  assert.equal(physical[0].length, 75);
  for (const line of physical.slice(1)) {
    assert.ok(line.startsWith(" "), "continuations begin with a space");
    assert.ok(Buffer.byteLength(line, "utf8") <= 75);
  }
  assert.equal(unfold(folded), long, "folding is reversible");

  const emoji = "SUMMARY:" + "🎯".repeat(40); // 4 octets each
  assert.equal(unfold(foldLine(emoji)), emoji);
  assert.ok(!foldLine(emoji).includes("�"));
});

// ── Content lines ───────────────────────────────────────────────────────────

test("parseLine splits name, params and value", () => {
  const line = parseLine("DTSTART;TZID=America/Los_Angeles;VALUE=DATE-TIME:20260827T100000")!;
  assert.equal(line.name, "DTSTART");
  assert.equal(line.params.TZID, "America/Los_Angeles");
  assert.equal(line.params.VALUE, "DATE-TIME");
  assert.equal(line.value, "20260827T100000");
});

test("a quoted parameter may contain a colon and a semicolon", () => {
  const line = parseLine('ATTENDEE;CN="Priya; R:esearch";ROLE=CHAIR:mailto:p@example.com')!;
  assert.equal(line.params.CN, "Priya; R:esearch");
  assert.equal(line.params.ROLE, "CHAIR");
  assert.equal(line.value, "mailto:p@example.com", "the value starts after the *unquoted* colon");
});

test("a bare property still parses", () => {
  const line = parseLine("END:VEVENT")!;
  assert.equal(line.name, "END");
  assert.equal(line.value, "VEVENT");
  assert.deepEqual(line.params, {});
  assert.equal(parseLine(""), null);
});

// ── TEXT ────────────────────────────────────────────────────────────────────

test("TEXT escaping round-trips, and unescaping is lenient", () => {
  const original = 'Meeting, then lunch; "quoted"\nsecond line \\ backslash';
  assert.equal(unescapeText(escapeText(original)), original);

  assert.equal(unescapeText("a\\, b"), "a, b");
  assert.equal(unescapeText("a\\; b"), "a; b");
  assert.equal(unescapeText("a\\nb"), "a\nb");
  assert.equal(unescapeText("a\\Nb"), "a\nb");
  // Not spec, but emitted by enough clients to matter.
  assert.equal(unescapeText("http\\://x"), "http://x");
  assert.equal(unescapeText("trailing\\"), "trailing");
});

test("a colon is not escaped on the way out", () => {
  assert.equal(escapeText("10:00 sharp"), "10:00 sharp");
});

// ── Dates ───────────────────────────────────────────────────────────────────

test("a zoned wall time resolves to the right instant across DST", () => {
  // 2026-08-27 is PDT (UTC-7); 2026-12-27 is PST (UTC-8).
  assert.equal(
    zonedWallToUtcMs({ y: 2026, m: 8, d: 27, h: 10, mi: 0, s: 0 }, "America/Los_Angeles"),
    Date.UTC(2026, 7, 27, 17, 0, 0),
  );
  assert.equal(
    zonedWallToUtcMs({ y: 2026, m: 12, d: 27, h: 10, mi: 0, s: 0 }, "America/Los_Angeles"),
    Date.UTC(2026, 11, 27, 18, 0, 0),
  );
});

test("an unknown zone does not throw", () => {
  assert.equal(zonedWallToUtcMs({ y: 2026, m: 8, d: 27, h: 10, mi: 0, s: 0 }, "Mars/Olympus"), null);
  const parsed = parseIcalDate(parseLine("DTSTART;TZID=Mars/Olympus:20260827T100000"));
  assert.ok(parsed);
  assert.equal(parsed!.unresolvedZone, true);
  assert.equal(localTimeOf(parsed), "10:00", "falls back to floating rather than guessing UTC");
});

test("an all-day date is the calendar day, not a UTC instant", () => {
  const parsed = parseIcalDate(parseLine("DTSTART;VALUE=DATE:20260827"))!;
  assert.equal(parsed.kind, "date");
  // The whole point: west of UTC, treating this as UTC midnight loses a day.
  assert.equal(localDateOf(parsed), "2026-08-27");
});

test("a UTC stamp round-trips", () => {
  const ms = localWallToUtcMs("2026-08-27", "10:00");
  assert.equal(formatUtcStamp(ms), "20260827T170000Z");
  assert.equal(localDateOf(parseIcalDate(parseLine(`DTSTART:${formatUtcStamp(ms)}`))), "2026-08-27");
  assert.equal(localTimeOf(parseIcalDate(parseLine(`DTSTART:${formatUtcStamp(ms)}`))), "10:00");
});

test("DURATION parses the forms that appear in practice", () => {
  assert.equal(parseDuration("PT30M"), 30);
  assert.equal(parseDuration("PT1H30M"), 90);
  assert.equal(parseDuration("P1D"), 1440);
  assert.equal(parseDuration("P1W"), 10080);
  assert.equal(parseDuration("-PT15M"), 15);
  assert.equal(parseDuration("nonsense"), null);
  assert.equal(parseDuration("P"), null);
});

// ── Reading ─────────────────────────────────────────────────────────────────

test("readVevent reads the master event, not the dragged occurrence", () => {
  const v = readVevent(APPLE)!;
  assert.equal(v.uid, "ABC-123");
  assert.equal(v.summary, "Standup, then review", "unfolded and unescaped");
  assert.equal(localDateOf(v.start), "2026-08-27");
  assert.equal(localTimeOf(v.start), "10:00");
  assert.equal(v.sequence, 2, "the override's SEQUENCE:3 is not the master's");
  assert.equal(v.blockCount, 2);
  assert.equal(v.hasOverrides, true);
});

test("the RRULE comes from the event, not from the VTIMEZONE's DST rules", () => {
  const v = readVevent(APPLE)!;
  assert.equal(v.rrule, "FREQ=WEEKLY;BYDAY=MO,WE,FR");
  assert.ok(!v.rrule.includes("YEARLY"), "a grep for RRULE: would have found BYMONTH=3 first");
});

test("DTSTART comes from the event, not from the VTIMEZONE's transition dates", () => {
  const v = readVevent(APPLE)!;
  assert.notEqual(localDateOf(v.start), "2007-03-11");
});

test("the VALARM's DESCRIPTION does not become the event's", () => {
  const v = readVevent(APPLE)!;
  assert.equal(v.description, "First line\nSecond line");
  assert.notEqual(v.description, "Reminder");
});

test("duration comes from DTEND, or from DURATION when there is no DTEND", () => {
  assert.equal(readVevent(APPLE)!.durationMinutes, 30);

  const withDuration = [
    "BEGIN:VCALENDAR", "BEGIN:VEVENT",
    "UID:D-1", "DTSTART:20260827T170000Z", "DURATION:PT45M", "SUMMARY:x",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  assert.equal(readVevent(withDuration)!.durationMinutes, 45);
});

test("an all-day event reports itself as one", () => {
  const ics = [
    "BEGIN:VCALENDAR", "BEGIN:VEVENT",
    "UID:AD-1", "DTSTART;VALUE=DATE:20260827", "DTEND;VALUE=DATE:20260828", "SUMMARY:Holiday",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  const v = readVevent(ics)!;
  assert.equal(v.allDay, true);
  assert.equal(localDateOf(v.start), "2026-08-27");
  assert.equal(v.durationMinutes, 1440);
});

test("a file with no VEVENT reads as null rather than throwing", () => {
  assert.equal(readVevent("BEGIN:VCALENDAR\r\nEND:VCALENDAR"), null);
  assert.equal(readVevent(""), null);
});

// ── Patching ────────────────────────────────────────────────────────────────

test("patching preserves everything ROME does not own", () => {
  const out = patchVevent(APPLE, { summary: "Standup" }, Date.UTC(2026, 7, 27, 18, 0, 0));
  for (const kept of [
    "BEGIN:VALARM", "TRIGGER:-PT10M", "X-APPLE-TRAVEL-ADVISORY-BEHAVIOR",
    "BEGIN:VTIMEZONE", "TZNAME:PDT", "CREATED:20260820T170000Z", "TRANSP:OPAQUE",
  ]) {
    assert.ok(out.includes(kept), `${kept} was dropped`);
  }
  assert.ok(out.includes("mailto:priya@example.com"), "the attendee survived");
  assert.equal(readVevent(out)!.summary, "Standup");
});

test("patching leaves the dragged occurrence alone", () => {
  const out = patchVevent(APPLE, { summary: "Renamed" }, Date.now());
  assert.ok(out.includes("SUMMARY:Standup (moved)"), "the override keeps its own title");
  assert.ok(out.includes("RECURRENCE-ID"));
});

test("patching bumps SEQUENCE and refreshes the timestamps", () => {
  const at = Date.UTC(2026, 7, 27, 18, 30, 0);
  const out = patchVevent(APPLE, { summary: "x" }, at);
  assert.equal(readVevent(out)!.sequence, 3, "2 → 3");
  assert.ok(out.includes(`LAST-MODIFIED:${formatUtcStamp(at)}`));
  assert.ok(out.includes(`DTSTAMP:${formatUtcStamp(at)}`));
});

test("moving an event rewrites DTSTART/DTEND as UTC and drops the TZID", () => {
  const out = patchVevent(APPLE, { date: "2026-09-01", time: "08:30", durationMinutes: 45 }, Date.now());
  assert.ok(out.includes("DTSTART:20260901T153000Z"), "08:30 PDT is 15:30 UTC");
  assert.ok(out.includes("DTEND:20260901T161500Z"));
  assert.equal(readVevent(out)!.start!.utc, true, "the master's DTSTART is now an instant");

  // The one zoned DTSTART still in the file belongs to the dragged occurrence,
  // which ROME does not own and must not rewrite.
  assert.equal((out.match(/DTSTART;TZID=/g) ?? []).length, 1);
  assert.ok(out.indexOf("DTSTART;TZID=") > out.indexOf("RECURRENCE-ID"));

  const v = readVevent(out)!;
  assert.equal(localTimeOf(v.start), "08:30", "and it reads back as the same wall time");
  assert.equal(v.durationMinutes, 45);
});

test("clearing the rule removes the line rather than blanking it", () => {
  const out = patchVevent(APPLE, { rrule: null }, Date.now());
  assert.equal(readVevent(out)!.rrule, "");
  assert.ok(!/^RRULE:FREQ=WEEKLY/m.test(out));
  assert.ok(out.includes("RRULE:FREQ=YEARLY;BYMONTH=3"), "the VTIMEZONE's rules are untouched");
});

test("a property that was absent is inserted", () => {
  const out = patchVevent(APPLE, { romeKind: "routine", romeId: 42 }, Date.now());
  const v = readVevent(out)!;
  assert.equal(v.romeKind, "routine");
  assert.equal(v.romeId, "42");
  assert.ok(out.indexOf("X-ROME-KIND") < out.indexOf("END:VEVENT"), "inserted inside the event");
});

test("patching an event with no VEVENT returns the input untouched", () => {
  const junk = "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n";
  assert.equal(patchVevent(junk, { summary: "x" }), junk);
});

// ── Building ────────────────────────────────────────────────────────────────

test("a built event round-trips through the reader", () => {
  const ics = buildVevent({
    uid: romeUid("event", 7),
    summary: "Design review, part 2",
    description: "Bring the sketches;\nall of them",
    date: "2026-09-03",
    time: "14:00",
    durationMinutes: 90,
    rrule: "FREQ=WEEKLY;BYDAY=TH",
    romeKind: "event",
    romeId: 7,
  });
  const v = readVevent(ics)!;
  assert.equal(v.summary, "Design review, part 2");
  assert.equal(v.description, "Bring the sketches;\nall of them");
  assert.equal(localDateOf(v.start), "2026-09-03");
  assert.equal(localTimeOf(v.start), "14:00");
  assert.equal(v.durationMinutes, 90);
  assert.equal(v.rrule, "FREQ=WEEKLY;BYDAY=TH");
  assert.equal(v.romeKind, "event");
  assert.equal(v.allDay, false);
  assert.ok(ics.endsWith("\r\n"));
});

test("an all-day event ends on the following day, because DTEND is exclusive", () => {
  const ics = buildVevent({ uid: "u1", summary: "Holiday", date: "2026-09-03", time: null });
  assert.ok(ics.includes("DTSTART;VALUE=DATE:20260903"));
  assert.ok(ics.includes("DTEND;VALUE=DATE:20260904"));
  assert.equal(readVevent(ics)!.allDay, true);
});

test("a long summary is folded on the way out and survives the round trip", () => {
  const summary = "Quarterly planning with the whole team, including the bit about 🎯 targets";
  const ics = buildVevent({ uid: "u2", summary, date: "2026-09-03", time: "09:00" });
  assert.ok(ics.split("\r\n").every(l => Buffer.byteLength(l, "utf8") <= 75));
  assert.equal(readVevent(ics)!.summary, summary);
});

test("ROME's UID scheme round-trips and rejects anything else", () => {
  assert.equal(romeUid("assignment", 12), "rome-assignment-12@rome.local");
  assert.deepEqual(parseRomeUid("rome-assignment-12@rome.local"), { kind: "assignment", id: 12 });
  assert.equal(parseRomeUid("40E7C1A2-3B44@apple.com"), null);
  assert.equal(parseRomeUid(""), null);
});
