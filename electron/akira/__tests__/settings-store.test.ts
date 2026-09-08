import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AkiraSettingsStore, DEFAULT_AKIRA_SETTINGS, AKIRA_SETTINGS_VERSION, mergeSettingsForTest } from "../settings-store";

function xor(value: Buffer): Buffer {
  const result = Buffer.alloc(value.length);
  for (let index = 0; index < value.length; index += 1) result[index] = value[index] ^ 0x5a;
  return result;
}

test("credential storage encrypts secrets and returns only configuration flags publicly", () => {
  const previous = process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  const root = mkdtempSync(path.join(os.tmpdir(), "akira-settings-"));
  const cipher = {
    isAvailable: () => true,
    encrypt: (value: string) => xor(Buffer.from(value.split("").reverse().join(""))),
    decrypt: (value: Buffer) => xor(value).toString("utf8").split("").reverse().join(""),
  };
  const store = new AkiraSettingsStore(root, cipher);
  try {
    store.setSecret("elevenLabsApiKey", "eleven-private-value");
    assert.equal(store.getSecret("elevenLabsApiKey"), "eleven-private-value");
    assert.equal(store.publicSettings().secrets.elevenLabsConfigured, true);
    const persisted = readFileSync(path.join(root, "secrets.enc.json"), "utf8");
    assert.doesNotMatch(persisted, /eleven-private-value/);
    assert.doesNotMatch(JSON.stringify(store.publicSettings()), /eleven-private-value/);
  } finally {
    if (previous === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = previous;
  }
});

test("credential storage refuses plaintext persistence when secure storage is unavailable", () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const root = mkdtempSync(path.join(os.tmpdir(), "akira-settings-unavailable-"));
  const store = new AkiraSettingsStore(root, {
    isAvailable: () => false,
    encrypt: () => { throw new Error("unexpected"); },
    decrypt: () => { throw new Error("unexpected"); },
  });
  try {
    assert.throws(() => store.setSecret("openaiApiKey", "secret"), /Secure credential storage is unavailable/);
    assert.equal(store.getSecret("openaiApiKey"), null);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});

test("a changed internal default reaches an install that already has settings", () => {
  // What a machine that ran the app before this change has on disk.
  const stored = {
    settingsVersion: 1,
    approvals: { autoApproveReversibleWrites: true, toolDeadlineMs: 9_000 },
    realtime: { agentId: "agent_x", greetingDelayMs: 1_200, idleTimeoutMs: 45_000 },
    voice: { voiceId: "chosen-voice" },
  } as any;

  const merged = mergeSettingsForTest(stored);

  // Timings with no control in the console are stale defaults, not choices.
  assert.equal(merged.approvals.toolDeadlineMs, DEFAULT_AKIRA_SETTINGS.approvals.toolDeadlineMs);
  assert.equal(merged.realtime.greetingDelayMs, DEFAULT_AKIRA_SETTINGS.realtime.greetingDelayMs);
  // Anything the user set, at any age, is theirs.
  assert.equal(merged.realtime.idleTimeoutMs, 45_000);
  assert.equal(merged.voice.voiceId, "chosen-voice");
  assert.equal(merged.realtime.agentId, "agent_x");
  assert.equal(merged.settingsVersion, AKIRA_SETTINGS_VERSION);

  // At the current version nothing is reset — the same values survive a reload.
  const again = mergeSettingsForTest({ ...merged, approvals: { ...merged.approvals, toolDeadlineMs: 5_000 } } as any);
  assert.equal(again.approvals.toolDeadlineMs, 5_000);
});

test("a partial update keeps the rest of its own section", () => {
  const merged = mergeSettingsForTest({
    settingsVersion: AKIRA_SETTINGS_VERSION,
    realtime: { agentId: "agent_x", idleTimeoutMs: 20_000 },
  } as any);
  assert.equal(merged.realtime.agentId, "agent_x");
  assert.equal(merged.realtime.greetingText, DEFAULT_AKIRA_SETTINGS.realtime.greetingText);
  assert.equal(merged.approvals.autoApproveReversibleWrites, true);
});
