import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { HermesGatewayClient, type GatewaySocket } from "../hermes-gateway";
import { ElevenLabsVoice, type VoiceSocket } from "../elevenlabs-voice";

class FakeSocket extends EventEmitter implements GatewaySocket, VoiceSocket {
  readyState = 1;
  sent: string[] = [];
  closed = false;
  send(value: string): void { this.sent.push(value); }
  close(): void { this.closed = true; this.readyState = 3; this.emit("close"); }
  terminate(): void { this.close(); }
  open(): void { this.emit("open"); }
}

test("gateway replacement rejects stale requests and uses only the new socket", async () => {
  const sockets: FakeSocket[] = [];
  const client = new HermesGatewayClient(() => {
    const socket = new FakeSocket();
    sockets.push(socket);
    queueMicrotask(() => socket.open());
    return socket;
  });

  await client.connect("ws://first");
  const eventPromise = once(client, "event");
  sockets[0].emit("message", JSON.stringify({
    jsonrpc: "2.0",
    method: "event",
    params: { type: "message.delta", session_id: "session-1", payload: { text: "hello" } },
  }));
  const [event] = await eventPromise;
  assert.equal(event.type, "message.delta");
  assert.equal(event.text, "hello");
  assert.equal(event.session_id, "session-1");
  const stale = client.request("prompt.submit", { text: "old" });
  await client.connect("ws://replacement");
  await assert.rejects(stale, /disconnected/);

  const current = client.request<{ ok: boolean }>("session.create", {});
  const request = JSON.parse(sockets[1].sent[0]);
  sockets[0].emit("message", JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { ok: false } }));
  sockets[1].emit("message", JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { ok: true } }));
  assert.deepEqual(await current, { ok: true });
  client.disconnect();
});

test("ElevenLabs voice streams PCM frames and closes with a flush", async () => {
  let socket: FakeSocket | null = null;
  let requestedUrl = "";
  let requestedHeaders: Record<string, string> = {};
  const voice = new ElevenLabsVoice((url, headers) => {
    requestedUrl = url;
    requestedHeaders = headers;
    socket = new FakeSocket();
    queueMicrotask(() => socket!.open());
    return socket;
  });
  const audio: string[] = [];
  voice.on("audio", value => audio.push(value));

  await voice.begin({
    apiKey: "secret-test-key",
    voiceId: "voice/id",
    modelId: "eleven_flash_v2_5",
    stability: 0.4,
    similarityBoost: 0.7,
    speed: 1.05,
  });
  await voice.push("A".repeat(500));
  await voice.finish();

  assert.match(requestedUrl, /voice%2Fid\/stream-input/);
  assert.match(requestedUrl, /model_id=eleven_flash_v2_5/);
  assert.match(requestedUrl, /output_format=pcm_24000/);
  assert.equal(requestedHeaders["xi-api-key"], "secret-test-key");
  const messages = socket!.sent.map(value => JSON.parse(value));
  assert.equal(messages[0].text, " ");
  assert.equal(messages[0].voice_settings.speed, 1.05);
  assert.equal(messages.at(-1).flush, true);
  assert.ok(messages.slice(1, -1).every(value => value.text.length <= 241));

  const ended = once(voice, "end");
  socket!.emit("message", JSON.stringify({ audio: "AQI=", is_final: true }));
  await ended;
  assert.deepEqual(audio, ["AQI="]);
});

test("barge-in cancellation prevents old voice frames from escaping", async () => {
  const sockets: FakeSocket[] = [];
  const voice = new ElevenLabsVoice(() => {
    const socket = new FakeSocket();
    sockets.push(socket);
    queueMicrotask(() => socket.open());
    return socket;
  });
  const audio: string[] = [];
  voice.on("audio", value => audio.push(value));
  await voice.begin({ apiKey: "key", voiceId: "voice", modelId: "model", stability: 0.5, similarityBoost: 0.5, speed: 1 });
  voice.cancel();
  sockets[0].emit("message", JSON.stringify({ audio: "stale" }));
  assert.deepEqual(audio, []);
});
