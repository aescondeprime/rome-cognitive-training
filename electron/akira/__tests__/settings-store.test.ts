import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AkiraSettingsStore } from "../settings-store";

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

test("legacy wake strictness default migrates to Hermes's recommended value", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "akira-settings-wake-"));
  writeFileSync(path.join(root, "settings.json"), JSON.stringify({ input: { wakeSensitivity: 0.65 } }));
  const store = new AkiraSettingsStore(root, {
    isAvailable: () => false,
    encrypt: () => { throw new Error("unexpected"); },
    decrypt: () => { throw new Error("unexpected"); },
  });
  assert.equal(store.get().input.wakeSensitivity, 0.5);
  assert.equal(JSON.parse(readFileSync(path.join(root, "settings.json"), "utf8")).input.wakeSensitivity, 0.5);
});
