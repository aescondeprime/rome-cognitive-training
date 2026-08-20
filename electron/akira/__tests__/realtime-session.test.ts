import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  ElevenLabsRealtimeSession,
  RealtimeOverrideRejected,
  type RealtimeSocket,
} from "../realtime-session";

/**
 * Realtime session protocol tests.
 *
 * The session is the one component with no fallback: if the handshake, the
 * override retry, or tool dispatch is wrong, Akira is mute and there is no
 * degraded path to hide it. These exercise the shapes ElevenLabs actually
 * sends, including the failure mode that shipped broken — an override rejection
 * arriving as a bare socket close with no error frame.
 */

class FakeSocket extends EventEmitter implements RealtimeSocket {
  readyState = 1; // WebSocket.OPEN
  readonly sent: string[] = [];
  closed: { code?: number; reason?: string } | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
    this.readyState = 3;
  }

  terminate(): void {
    this.readyState = 3;
  }

  /** Parsed frames, for assertions that care about structure. */
  frames(): Record<string, any>[] {
    return this.sent.map(value => JSON.parse(value));
  }

  /** Deliver a server frame. */
  receive(payload: Record<string, unknown>): void {
    this.emit("message", Buffer.from(JSON.stringify(payload), "utf8"));
  }

  /** Complete the handshake so `connect` resolves. */
  ready(sampleRate = 16_000): void {
    this.receive({
      type: "conversation_initiation_metadata",
      conversation_initiation_metadata_event: {
        conversation_id: "conv_test",
        agent_output_audio_format: `pcm_${sampleRate}`,
      },
    });
  }
}

/** Drive the session with a controllable socket, opened on next tick. */
function harness() {
  const sockets: FakeSocket[] = [];
  const session = new ElevenLabsRealtimeSession(() => {
    const socket = new FakeSocket();
    sockets.push(socket);
    setImmediate(() => socket.emit("open"));
    return socket;
  });

  /**
   * Wait until the session has attached its frame listeners to socket `index`.
   *
   * Counting ticks does not work here: `connect` awaits a signed-URL lookup
   * before it constructs the socket, and attaches `message`/`close` only after
   * the open event. A frame emitted before that lands on an emitter nobody is
   * listening to and is silently dropped — which then shows up as a six-second
   * handshake timeout rather than as a missing listener.
   */
  const live = async (index = 0): Promise<FakeSocket> => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const socket = sockets[index];
      if (socket && socket.listenerCount("message") > 0) return socket;
      await new Promise(resolve => setImmediate(resolve));
    }
    throw new Error(`socket ${index} never started receiving frames`);
  };

  return { session, sockets, live };
}

const OPTIONS = { agentId: "agent_test", apiKey: null, prompt: "SYSTEM PROMPT" };

test("the handshake carries the prompt override and dynamic variables", async () => {
  const { session, sockets, live } = harness();
  const connecting = session.connect({ ...OPTIONS, dynamicVariables: { rome_route: "/taskboard" } });
  (await live()).ready();
  await connecting;

  const init = sockets[0].frames().find(frame => frame.type === "conversation_initiation_client_data");
  assert.ok(init, "no initiation frame was sent");
  assert.equal(init.conversation_config_override.agent.prompt.prompt, "SYSTEM PROMPT");
  assert.equal(init.dynamic_variables.rome_route, "/taskboard");
  // ElevenLabs advises omitting fields rather than sending empty strings, and
  // ROME decides whether to greet — so first_message must never be sent.
  assert.equal("first_message" in (init.conversation_config_override.agent ?? {}), false);
  session.close();
});

test("a 1008 close during setup retries without overrides", async () => {
  const { session, sockets, live } = harness();
  const degraded: Error[] = [];
  session.on("degraded", error => degraded.push(error));

  const connecting = session.connect(OPTIONS);
  // How ElevenLabs reports an override that is not enabled: no error frame,
  // just a policy-violation close.
  (await live(0)).emit("close", 1008, Buffer.from("Override for field 'prompt' is not allowed by config"));
  (await live(1)).ready();
  await connecting;

  assert.equal(sockets.length, 2, "expected a second connection attempt");
  const retry = sockets[1].frames().find(frame => frame.type === "conversation_initiation_client_data");
  assert.equal(retry.conversation_config_override, undefined, "retry must not carry an override");
  assert.equal(degraded.length, 1);
  assert.ok(degraded[0] instanceof RealtimeOverrideRejected);
  assert.match(degraded[0].message, /Security tab/);
  session.close();
});

test("a non-override close during setup is not retried", async () => {
  const { session, sockets, live } = harness();
  const connecting = session.connect(OPTIONS);
  (await live()).emit("close", 1011, Buffer.from("internal error"));

  await assert.rejects(connecting, /closed the connection during setup/);
  assert.equal(sockets.length, 1, "a server fault must not loop");
});

test("audio, transcripts, and VAD are surfaced with the negotiated sample rate", async () => {
  const { session, sockets, live } = harness();
  const connecting = session.connect(OPTIONS);
  (await live()).ready(24_000);
  await connecting;

  const audio: any[] = [];
  const user: string[] = [];
  const agent: string[] = [];
  const vad: number[] = [];
  session.on("audio", value => audio.push(value));
  session.on("userTranscript", value => user.push(value));
  session.on("agentResponse", value => agent.push(value));
  session.on("vad", value => vad.push(value));

  sockets[0].receive({ type: "audio", audio_event: { audio_base_64: "AAAA", event_id: 1 } });
  sockets[0].receive({ type: "user_transcript", user_transcription_event: { user_transcript: "open my tasks" } });
  sockets[0].receive({ type: "agent_response", agent_response_event: { agent_response: "Opening it now." } });
  sockets[0].receive({ type: "vad_score", vad_score_event: { vad_score: 0.82 } });

  assert.deepEqual(audio, [{ audio: "AAAA", sampleRate: 24_000 }]);
  assert.deepEqual(user, ["open my tasks"]);
  assert.deepEqual(agent, ["Opening it now."]);
  assert.deepEqual(vad, [0.82]);
  session.close();
});

test("tool calls are surfaced and results are returned against the call id", async () => {
  const { session, sockets, live } = harness();
  const connecting = session.connect(OPTIONS);
  (await live()).ready();
  await connecting;

  const calls: any[] = [];
  session.on("toolCall", call => calls.push(call));
  sockets[0].receive({
    type: "client_tool_call",
    client_tool_call: {
      tool_call_id: "call_1",
      tool_name: "rome_execute",
      parameters: { capability: "rome.tasks.list", arguments_json: "{}" },
      expects_response: true,
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].toolName, "rome_execute");
  assert.equal(calls[0].parameters.capability, "rome.tasks.list");

  session.sendToolResult("call_1", { ok: true, result: [] });
  const result = sockets[0].frames().find(frame => frame.type === "client_tool_result");
  assert.equal(result.tool_call_id, "call_1");
  assert.equal(result.is_error, false);
  assert.equal(JSON.parse(result.result).ok, true);
  session.close();
});

test("a ping is answered with the matching event id", async () => {
  const { session, sockets, live } = harness();
  const connecting = session.connect(OPTIONS);
  (await live()).ready();
  await connecting;

  sockets[0].receive({ type: "ping", ping_event: { event_id: 77, ping_ms: 12 } });
  const pong = sockets[0].frames().find(frame => frame.type === "pong");
  assert.equal(pong.event_id, 77);
  session.close();
});

test("closing deliberately is distinguishable from dropping", async () => {
  const { session, live } = harness();
  const connecting = session.connect(OPTIONS);
  (await live()).ready();
  await connecting;

  const closes: any[] = [];
  session.on("close", value => closes.push(value));
  session.close();

  assert.equal(closes.length, 1);
  assert.equal(closes[0].intentional, true, "a deliberate close must not surface as an error to the user");
});

test("audio is not sent once the session is closed", async () => {
  const { session, sockets, live } = harness();
  const connecting = session.connect(OPTIONS);
  (await live()).ready();
  await connecting;

  const before = sockets[0].sent.length;
  session.close();
  session.sendAudio("QUJD");
  assert.equal(sockets[0].sent.length, before, "microphone frames must stop at standby");
});
