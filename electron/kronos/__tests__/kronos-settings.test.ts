/**
 * Where the iCloud credential lives.
 *
 * The guarantee worth a test is negative: **the app-specific password must
 * never appear in plaintext on disk, and must never appear in anything handed
 * to the renderer.** Everything else here is ordinary config handling.
 *
 * Run: npm run test:kronos
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { KronosSettingsStore } from "../kronos-settings";

/** A stand-in for safeStorage: reversible, and obviously not the real thing. */
function cipher(available = true) {
  return {
    isAvailable: () => available,
    encrypt: (value: string) => Buffer.from([...Buffer.from(value, "utf8")].map(b => b ^ 0x5a)),
    decrypt: (value: Buffer) => Buffer.from([...value].map(b => b ^ 0x5a)).toString("utf8"),
  };
}

function freshStore(available = true) {
  const root = mkdtempSync(path.join(os.tmpdir(), "rome-kronos-"));
  return { root, store: new KronosSettingsStore(root, cipher(available)) };
}

function withoutEnv<T>(fn: () => T): T {
  const user = process.env.ROME_ICLOUD_USER;
  const pass = process.env.ROME_ICLOUD_PASS;
  delete process.env.ROME_ICLOUD_USER;
  delete process.env.ROME_ICLOUD_PASS;
  try {
    return fn();
  } finally {
    if (user !== undefined) process.env.ROME_ICLOUD_USER = user;
    if (pass !== undefined) process.env.ROME_ICLOUD_PASS = pass;
  }
}

// ── The negative guarantee ──────────────────────────────────────────────────

test("the password is encrypted on disk and absent from the public config", () => {
  withoutEnv(() => {
    const { root, store } = freshStore();
    store.update({ appleId: "someone@icloud.com" });
    store.setPassword("abcd-efgh-ijkl-mnop");

    assert.equal(store.getPassword(), "abcd-efgh-ijkl-mnop");

    const onDisk = readFileSync(path.join(root, "calendar.enc.json"), "utf8");
    assert.doesNotMatch(onDisk, /abcd-efgh-ijkl-mnop/, "plaintext credential on disk");

    // The config file is the readable one — it must never learn the secret.
    const config = readFileSync(path.join(root, "calendar.json"), "utf8");
    assert.doesNotMatch(config, /abcd-efgh-ijkl-mnop/);
    assert.match(config, /someone@icloud\.com/, "the Apple ID is a username, not a secret");

    // And nothing that crosses to the renderer carries it.
    const publicConfig = store.publicConfig();
    assert.equal(publicConfig.passwordConfigured, true);
    assert.doesNotMatch(JSON.stringify(publicConfig), /abcd-efgh-ijkl-mnop/);
    assert.ok(!("password" in publicConfig));
  });
});

test("an unreadable vault reads as absent rather than throwing", () => {
  withoutEnv(() => {
    const { root, store } = freshStore();
    store.setPassword("secret");
    // A vault written by another machine, another OS user, or an older key.
    const reader = new KronosSettingsStore(root, {
      isAvailable: () => true,
      encrypt: (v: string) => Buffer.from(v),
      decrypt: () => { throw new Error("cannot decrypt"); },
    });
    assert.equal(reader.getPassword(), null);
    assert.equal(reader.publicConfig().passwordConfigured, false);
  });
});

test("without secure storage a password is refused, not written in the clear", () => {
  withoutEnv(() => {
    const { root, store } = freshStore(false);
    assert.throws(() => store.setPassword("abcd"), /Secure credential storage is unavailable/);
    assert.equal(existsSync(path.join(root, "calendar.enc.json")), false);
    assert.equal(store.publicConfig().secureStorageAvailable, false);
  });
});

test("clearing removes the entry rather than storing an empty one", () => {
  withoutEnv(() => {
    const { root, store } = freshStore();
    store.setPassword("abcd");
    store.setPassword("");
    assert.equal(store.getPassword(), null);
    assert.equal(readFileSync(path.join(root, "calendar.enc.json"), "utf8").includes("icloudAppPassword"), false);
  });
});

// ── Environment overrides ───────────────────────────────────────────────────

test("the environment wins, so the app and the live check agree on the account", () => {
  const { store } = freshStore();
  store.update({ appleId: "stored@icloud.com" });
  store.setPassword("stored-password");

  process.env.ROME_ICLOUD_USER = "env@icloud.com";
  process.env.ROME_ICLOUD_PASS = "env-password";
  try {
    assert.equal(store.get().appleId, "env@icloud.com");
    assert.equal(store.getPassword(), "env-password");
  } finally {
    delete process.env.ROME_ICLOUD_USER;
    delete process.env.ROME_ICLOUD_PASS;
  }

  assert.equal(store.get().appleId, "stored@icloud.com", "and the stored value is untouched");
});

// ── Config handling ─────────────────────────────────────────────────────────

test("a calendar href is stored as a path, never with the partition host", () => {
  withoutEnv(() => {
    const { store } = freshStore();
    // Storing the absolute form bakes in `p42-`, and every request built from
    // it 404s the day Apple moves the account.
    store.update({ calendarHref: "https://p42-caldav.icloud.com/1234567/calendars/rome/" });
    assert.equal(store.get().calendarHref, "/1234567/calendars/rome/");
  });
});

test("the poll interval is clamped and junk falls back to the default", () => {
  withoutEnv(() => {
    const { store } = freshStore();
    assert.equal(store.update({ pollMinutes: 0 }).pollMinutes, 1);
    assert.equal(store.update({ pollMinutes: 999 }).pollMinutes, 60);
    assert.equal(store.update({ pollMinutes: Number.NaN }).pollMinutes, 5);
  });
});

test("settings survive a restart", () => {
  withoutEnv(() => {
    const { root, store } = freshStore();
    store.update({ appleId: "a@icloud.com", calendarHref: "/x/y/", calendarName: "ROME", enabled: true });
    store.setPassword("kept");

    const reopened = new KronosSettingsStore(root, cipher());
    assert.equal(reopened.get().appleId, "a@icloud.com");
    assert.equal(reopened.get().enabled, true);
    assert.equal(reopened.getPassword(), "kept");
  });
});

test("disconnecting forgets the account and the password together", () => {
  withoutEnv(() => {
    const { store } = freshStore();
    store.update({ appleId: "a@icloud.com", calendarHref: "/x/y/", calendarName: "ROME", enabled: true });
    store.setPassword("gone");

    store.disconnect();
    const after = store.publicConfig();
    assert.equal(after.appleId, "");
    assert.equal(after.calendarHref, "");
    assert.equal(after.enabled, false);
    assert.equal(after.passwordConfigured, false);
    assert.equal(store.getPassword(), null);
  });
});

test("a missing config file is a default config, not a crash", () => {
  withoutEnv(() => {
    const root = mkdtempSync(path.join(os.tmpdir(), "rome-kronos-empty-"));
    const store = new KronosSettingsStore(root, cipher());
    assert.deepEqual(store.get(), {
      provider: "icloud", appleId: "", calendarHref: "", calendarName: "",
      enabled: false, pollMinutes: 5,
    });
  });
});
