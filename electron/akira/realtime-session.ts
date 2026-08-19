import { EventEmitter } from "node:events";
import WebSocket from "ws";

/**
 * ElevenLabs Agents realtime session.
 *
 * This replaces V2's turn-based pipeline, which recorded a whole utterance,
 * waited out ~950ms of silence, batch-transcribed it, ran the model to
 * completion, and only then asked for speech. Nothing overlapped, so
 * time-to-first-audio was 6–15 seconds.
 *
 * Here one socket carries microphone audio up and speech down continuously.
 * Turn-taking, voice activity detection, transcription, and interruption are
 * all handled server-side, which is what makes the conversation feel
 * continuous rather than transactional.
 *
 * The socket lives in the main process on purpose: the API key never reaches
 * the renderer, and tool calls land next to the capability registry that
 * executes them.
 *
 * Protocol: wss://api.elevenlabs.io/v1/convai/conversation?agent_id=…
 * Audio is base64 PCM, 16 kHz mono, in both directions.
 */

const API_BASE = "https://api.elevenlabs.io";
const WS_BASE = "wss://api.elevenlabs.io";
const CONNECT_TIMEOUT_MS = 15_000;

export interface RealtimeToolCall {
  toolCallId: string;
  toolName: string;
  parameters: Record<string, unknown>;
  expectsResponse: boolean;
}

export interface RealtimeConnectOptions {
  agentId: string;
  apiKey: string | null;
  /**
   * Replaces the agent's dashboard system prompt for this conversation.
   *
   * Requires "prompt" to be enabled under the agent's Security tab. ElevenLabs
   * rejects an override that has not been enabled and closes the socket, so
   * `connect` retries without it rather than failing outright.
   */
  prompt?: string;
  /** Substituted into the agent's prompt template by ElevenLabs. */
  dynamicVariables?: Record<string, string | number | boolean>;
}

/** Why a connection ended, when the reason is actionable. */
export class RealtimeOverrideRejected extends Error {
  constructor(readonly detail: string) {
    super(
      "The ElevenLabs agent rejected ROME's prompt override. Enable “prompt” under the agent's Security tab so Akira can see your ROME capabilities.",
    );
    this.name = "RealtimeOverrideRejected";
  }
}

export interface RealtimeSocket extends EventEmitter {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate?(): void;
}

export type RealtimeSocketFactory = (url: string) => RealtimeSocket;

export class ElevenLabsRealtimeSession extends EventEmitter {
  private socket: RealtimeSocket | null = null;
  private generation = 0;
  private conversationId: string | null = null;
  private outputSampleRate = 16_000;
  private closingIntentionally = false;
  /** True once the server has acknowledged the handshake. */
  private initialized = false;

  constructor(
    private readonly createSocket: RealtimeSocketFactory = url =>
      new WebSocket(url) as unknown as RealtimeSocket,
  ) {
    super();
  }

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  get id(): string | null {
    return this.conversationId;
  }

  get sampleRate(): number {
    return this.outputSampleRate;
  }

  /**
   * Open a conversation.
   *
   * Overrides are attempted first and dropped on rejection. ElevenLabs requires
   * each overridable field to be switched on under the agent's Security tab,
   * and rejects the whole connection when one is not — which surfaces as the
   * socket opening and then immediately closing, with no error frame. Retrying
   * without the override means a misconfigured agent still talks, and the user
   * gets told exactly which switch to flip.
   */
  async connect(options: RealtimeConnectOptions): Promise<void> {
    try {
      await this.connectOnce(options, true);
    } catch (error) {
      if (!(error instanceof RealtimeOverrideRejected)) throw error;
      this.emit("degraded", error);
      await this.connectOnce(options, false);
    }
  }

  private async connectOnce(options: RealtimeConnectOptions, withOverrides: boolean): Promise<void> {
    this.close();
    const generation = ++this.generation;
    this.closingIntentionally = false;
    this.initialized = false;

    const url = await this.resolveUrl(options);
    if (generation !== this.generation) return;

    const socket = this.createSocket(url);
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        socket.terminate?.();
        reject(new Error("Timed out connecting to the ElevenLabs agent."));
      }, CONNECT_TIMEOUT_MS);
      const cleanup = () => {
        clearTimeout(timer);
        socket.removeListener("open", onOpen);
        socket.removeListener("error", onError);
      };
      const onOpen = () => { cleanup(); resolve(); };
      const onError = (error: Error) => { cleanup(); reject(error); };
      socket.once("open", onOpen);
      socket.once("error", onError);
    });

    if (generation !== this.generation) {
      try { socket.close(1000, "superseded"); } catch { socket.terminate?.(); }
      return;
    }

    socket.on("message", (value: Buffer | string) => this.handleMessage(generation, value));
    socket.on("error", (error: Error) => this.emit("error", error));

    // A close before the handshake completes is how ElevenLabs reports a
    // rejected override — no error frame, just a disconnect. This promise lets
    // connectOnce distinguish that from a mid-conversation drop.
    const handshake = new Promise<void>((resolve, reject) => {
      const settleTimer = setTimeout(() => resolve(), 6_000);
      const onClose = (code: number, reasonBuffer: Buffer) => {
        clearTimeout(settleTimer);
        const reason = reasonBuffer?.toString("utf8") || "";
        if (this.socket === socket) {
          this.socket = null;
          this.conversationId = null;
        }
        if (this.initialized) {
          this.emit("close", { intentional: this.closingIntentionally, code, reason });
          resolve();
          return;
        }
        const detail = reason || `close code ${code}`;
        if (withOverrides) reject(new RealtimeOverrideRejected(detail));
        else {
          this.emit("close", { intentional: this.closingIntentionally, code, reason });
          reject(new Error(`ElevenLabs closed the connection during setup (${detail}).`));
        }
      };
      socket.once("close", onClose);
      this.once("initialized", () => { clearTimeout(settleTimer); resolve(); });
    });

    // The agent does not speak until it receives this, so it doubles as the
    // handshake. `first_message` is deliberately absent: ElevenLabs advises
    // omitting fields rather than sending empty strings, and ROME decides
    // whether to greet based on whether speech followed the wake word.
    this.send({
      type: "conversation_initiation_client_data",
      ...(withOverrides && options.prompt
        ? { conversation_config_override: { agent: { prompt: { prompt: options.prompt } } } }
        : {}),
      ...(options.dynamicVariables && Object.keys(options.dynamicVariables).length
        ? { dynamic_variables: options.dynamicVariables }
        : {}),
    });

    await handshake;
    if (generation !== this.generation) return;
    this.emit("open");
  }

  /** Base64 PCM16 mono at 16 kHz. Sent continuously while the session is live. */
  sendAudio(base64: string): void {
    if (!this.connected || !base64) return;
    this.send({ user_audio_chunk: base64 });
  }

  sendText(text: string): void {
    if (!this.connected || !text.trim()) return;
    this.send({ type: "user_message", text: text.slice(0, 20_000) });
  }

  /**
   * Non-interrupting state change — route changes, data updates, the result of
   * a background task. The agent folds it into context without taking a turn,
   * which is how Akira can know where you are without talking about it.
   */
  sendContextualUpdate(text: string): void {
    if (!this.connected || !text.trim()) return;
    this.send({ type: "contextual_update", text: text.slice(0, 4_000) });
  }

  sendToolResult(toolCallId: string, result: unknown, isError = false): void {
    if (!this.connected) return;
    let serialized: string;
    try {
      serialized = typeof result === "string" ? result : JSON.stringify(result ?? null);
    } catch {
      serialized = '"[unserializable result]"';
    }
    this.send({
      type: "client_tool_result",
      tool_call_id: toolCallId,
      result: serialized.slice(0, 100_000),
      is_error: Boolean(isError),
    });
  }

  close(): void {
    this.generation += 1;
    this.closingIntentionally = true;
    this.initialized = false;
    const socket = this.socket;
    this.socket = null;
    this.conversationId = null;
    if (!socket) return;
    socket.removeAllListeners();
    try { socket.close(1000, "ROME ended the conversation"); } catch { socket.terminate?.(); }
    this.emit("close", { intentional: true });
  }

  /**
   * Agents with authentication enabled reject a bare agent_id, so we mint a
   * signed URL when we hold an API key. Falls back to a direct connection for
   * public agents, and treats a signing failure as non-fatal for the same
   * reason — a public agent does not need one.
   */
  private async resolveUrl(options: RealtimeConnectOptions): Promise<string> {
    const direct = `${WS_BASE}/v1/convai/conversation?agent_id=${encodeURIComponent(options.agentId)}`;
    if (!options.apiKey) return direct;
    try {
      const response = await fetch(
        `${API_BASE}/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(options.agentId)}`,
        { headers: { "xi-api-key": options.apiKey }, signal: AbortSignal.timeout(10_000) },
      );
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error("ElevenLabs rejected the API key. Check it in Akira's voice settings.");
        }
        if (response.status === 404) {
          throw new Error(`ElevenLabs does not recognise agent ${options.agentId}.`);
        }
        return direct;
      }
      const payload = await response.json().catch(() => ({} as Record<string, unknown>));
      const signed = typeof payload.signed_url === "string" ? payload.signed_url : "";
      return signed || direct;
    } catch (error) {
      // A wrong key or missing agent is worth surfacing; anything else (offline
      // signing endpoint, transient 5xx) should still try the direct route.
      if (error instanceof Error && /API key|does not recognise/.test(error.message)) throw error;
      return direct;
    }
  }

  private send(payload: Record<string, unknown>): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    try { this.socket.send(JSON.stringify(payload)); }
    catch (error) { this.emit("error", error instanceof Error ? error : new Error(String(error))); }
  }

  private handleMessage(generation: number, value: Buffer | string): void {
    if (generation !== this.generation) return;
    let frame: Record<string, any>;
    try { frame = JSON.parse(Buffer.isBuffer(value) ? value.toString("utf8") : value); }
    catch { return; }

    switch (frame.type) {
      case "conversation_initiation_metadata": {
        const meta = frame.conversation_initiation_metadata_event ?? {};
        this.conversationId = String(meta.conversation_id ?? "") || null;
        const format = String(meta.agent_output_audio_format ?? "pcm_16000");
        const parsed = Number(format.replace(/[^0-9]/g, ""));
        this.outputSampleRate = Number.isFinite(parsed) && parsed >= 8_000 ? parsed : 16_000;
        this.initialized = true;
        this.emit("initialized");
        this.emit("metadata", { conversationId: this.conversationId, sampleRate: this.outputSampleRate });
        break;
      }
      case "audio": {
        const audio = frame.audio_event?.audio_base_64;
        if (typeof audio === "string" && audio) {
          this.emit("audio", { audio, sampleRate: this.outputSampleRate });
        }
        break;
      }
      case "user_transcript": {
        const text = String(frame.user_transcription_event?.user_transcript ?? "").trim();
        if (text) this.emit("userTranscript", text);
        break;
      }
      case "agent_response": {
        const text = String(frame.agent_response_event?.agent_response ?? "").trim();
        if (text) this.emit("agentResponse", text);
        break;
      }
      case "agent_response_correction": {
        // Emitted when the agent is cut off mid-sentence: the corrected text is
        // what it actually managed to say, so the transcript matches reality.
        const event = frame.agent_response_correction_event ?? {};
        const text = String(event.corrected_agent_response ?? event.agent_response ?? "").trim();
        if (text) this.emit("agentResponse", text);
        break;
      }
      case "client_tool_call": {
        const call = frame.client_tool_call ?? {};
        const name = String(call.tool_name ?? "");
        const id = String(call.tool_call_id ?? "");
        if (!name || !id) break;
        const parameters = call.parameters && typeof call.parameters === "object" && !Array.isArray(call.parameters)
          ? call.parameters as Record<string, unknown>
          : {};
        this.emit("toolCall", {
          toolCallId: id,
          toolName: name,
          parameters,
          expectsResponse: call.expects_response !== false,
        } satisfies RealtimeToolCall);
        break;
      }
      case "interruption":
        this.emit("interruption", { reason: String(frame.interruption_event?.reason ?? "user speech") });
        break;
      case "vad_score": {
        const score = Number(frame.vad_score_event?.vad_score);
        if (Number.isFinite(score)) this.emit("vad", Math.max(0, Math.min(1, score)));
        break;
      }
      case "ping": {
        const eventId = frame.ping_event?.event_id;
        if (eventId !== undefined) this.send({ type: "pong", event_id: eventId });
        break;
      }
      case "error":
        this.emit("error", new Error(String(frame.message ?? frame.error ?? "ElevenLabs reported an error.")));
        break;
      default:
        break;
    }
  }
}
