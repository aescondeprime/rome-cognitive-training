/**
 * The one check that actually talks to Apple. Skipped unless you ask for it.
 *
 *   ROME_ICLOUD_TEST=1 \
 *   ROME_ICLOUD_USER='you@icloud.com' \
 *   ROME_ICLOUD_PASS='abcd-efgh-ijkl-mnop' \
 *   npm run test:kronos
 *
 * The password must be an **app-specific password** from
 * appleid.apple.com → Sign-In and Security → App-Specific Passwords. A real
 * Apple ID password is rejected by CalDAV and will look like a wrong password.
 *
 * **This check is read-only.** It discovers the principal, lists the calendars
 * that can hold events, and reads the first page of one of them. It creates
 * nothing, writes nothing and deletes nothing — writing to a real calendar
 * belongs behind the dry-run confirmation in the setup panel, not in a test
 * someone might run to see what happens.
 *
 * What it is really proving is the part that cannot be tested offline: that the
 * partition redirect survives a PROPFIND with a body, that a first
 * `sync-collection` returns both the set and a token, and that a multiget comes
 * back at all — the last of those is where the first real run failed, because
 * iCloud silently stops answering a calendar-multiget that carries a Depth
 * header (RFC 4791 §7.9 says not to send one).
 *
 * Add `ROME_ICLOUD_DEBUG=1` for a line per request: method, path, status,
 * milliseconds. It is the difference between "could not reach iCloud" and
 * knowing which single request went quiet and for how long.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { IcloudDav, type DavError } from "../icloud-dav";

const enabled = process.env.ROME_ICLOUD_TEST === "1";
const username = process.env.ROME_ICLOUD_USER ?? "";
const password = process.env.ROME_ICLOUD_PASS ?? "";

const skip = !enabled
  ? "set ROME_ICLOUD_TEST=1 to run the live iCloud check"
  : !username || !password
    ? "ROME_ICLOUD_USER and ROME_ICLOUD_PASS are required"
    : false;

test("iCloud: discovery, calendars and a first sync page", { skip }, async () => {
  const dav = new IcloudDav({ credentials: { username, password } });

  const found = await dav.discover().catch((error: DavError) => {
    // The failure worth reading is the one about the password, so surface the
    // translated message rather than the status line.
    assert.fail(`${error.userMessage} (${error.kind}${error.status ? ` ${error.status}` : ""})`);
  });

  console.log("  partition host :", found.origin);
  console.log("  principal      :", found.principalPath);
  console.log("  calendar home  :", found.homePath);
  assert.ok(found.homePath.startsWith("/"), "the home set is stored as a path, never as a URL");

  const calendars = await dav.listCalendars();
  console.log(`  calendars      : ${calendars.length} that can hold events`);
  for (const calendar of calendars) {
    console.log(`    · ${calendar.displayName}  ${calendar.href}  ${calendar.color || "(no colour)"}`);
  }
  assert.ok(calendars.length > 0, "no VEVENT calendars — Reminders lists are filtered out by design");
  assert.ok(
    calendars.every(c => c.href.startsWith("/")),
    "hrefs must come back as paths so the partition host is never stored",
  );

  const first = calendars[0];
  const page = await dav.syncCollection(first.href, null);
  console.log(`  first sync of "${first.displayName}": ${page.changes.length} resources` +
    `${page.truncated ? " (capped — more to collect)" : ""}`);
  assert.ok(page.token, "an initial sync must return a token, or every later sync is a full one");
  assert.ok(page.changes.every(c => !c.deleted), "nothing is deleted on a first sync");

  // Bodies, only if the calendar has any. Still read-only.
  const hrefs = page.changes.filter(c => !c.deleted).slice(0, 3).map(c => c.href);
  if (hrefs.length) {
    const bodies = await dav.multiget(first.href, hrefs).catch((error: DavError) => {
      assert.fail(
        `multiget failed: ${error.userMessage} (${error.kind}). ` +
        `Re-run with ROME_ICLOUD_DEBUG=1 to see which request stalled.`,
      );
    });
    console.log(`  read ${bodies.length} of ${hrefs.length} bodies; ` +
      `${bodies.filter(b => b.mangled).length} need a raw re-read`);
    assert.ok(bodies.every(b => b.ics.includes("BEGIN:VCALENDAR")));
  } else {
    console.log("  (calendar is empty — nothing to read back)");
  }
});
