import { EventEmitter } from "node:events";
import WebSocket from "ws";

export interface VoiceSocket extends EventEmitter {
  readyState: number;
  send(value: string): void;
  close(code?: number, reason?: string): void;
  terminate?(): void;
}

export type VoiceSocketFactory = (url: string, headers: Record<string, string>) => VoiceSocket;

export interface ElevenLabsVoiceOptions {
  apiKey: string;
  voiceId: string;
  modelId: string;
  stability: number;
  similarityBoost: number;
  speed: number;
  outputFormat?: string;
}

export class ElevenLabsVoice extends EventEmitter {
  private socket: VoiceSocket | null = null;
  private generation = 0;
  private opened: Promise<void> | null = null;
  private resolveOpen: (() => void) | null = null;
  private rejectOpen: ((error: Error) => void) | null = null;

  constructor(
    private readonly createSocket: VoiceSocketFactory = (url, headers) =>
      new WebSocket(url, { headers }) as unknown as VoiceSocket,
  ) {
    super();
  }

  async begin(options: ElevenLabsVoiceOptions): Promise<void> {
    this.cancel();
    const generation = ++this.generation;
    const query = new URLSearchParams({
      model_id: options.modelId,
      output_format: options.outputFormat ?? "pcm_24000",
      inactivity_timeout: "30",
    });
    const url = `wss://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(options.voiceId)}/stream-input?${query}`;
    const socket = this.createSocket(url, { "xi-api-key": options.apiKey });
    this.socket = socket;
    this.opened = new Promise<void>((resolve, reject) => {
      this.resolveOpen = resolve;
      this.rejectOpen = reject;
    });
    const failOpen = (error: Error) => {
      if (generation !== this.generation) return;
      this.rejectOpen?.(error);
      this.resolveOpen = null;
      this.rejectOpen = null;
      this.opened = null;
      if (this.socket === socket) this.socket = null;
      socket.removeAllListeners();
      try { socket.close(1011, "voice startup failed"); } catch { socket.terminate?.(); }
    };
    const timeout = setTimeout(() => failOpen(new Error("ElevenLabs voice connection timed out.")), 12_000);

    socket.once("open", () => {
      if (generation !== this.generation) return;
      clearTimeout(timeout);
      socket.send(JSON.stringify({
        text: " ",
        voice_settings: {
          stability: Math.max(0, Math.min(1, options.stability)),
          similarity_boost: Math.max(0, Math.min(1, options.similarityBoost)),
          speed: Math.max(0.7, Math.min(1.2, options.speed)),
        },
      }));
      this.emit("start", { sampleRate: 24_000 });
      this.resolveOpen?.();
      this.resolveOpen = null;
      this.rejectOpen = null;
    });
    socket.on("message", (value: Buffer | string) => {
      if (generation !== this.generation) return;
      try {
        const frame = JSON.parse(Buffer.isBuffer(value) ? value.toString("utf8") : value);
        if (typeof frame.audio === "string" && frame.audio) this.emit("audio", frame.audio);
        if (frame.is_final === true) this.finishSocket(generation);
        if (frame.error) this.emit("error", new Error(String(frame.error)));
      } catch (error) {
        this.emit("error", error instanceof Error ? error : new Error(String(error)));
      }
    });
    socket.once("error", (error: Error) => {
      clearTimeout(timeout);
      failOpen(error);
      this.emit("error", error);
    });
    socket.once("close", () => {
      clearTimeout(timeout);
      if (generation === this.generation && this.socket === socket) {
        this.socket = null;
        this.emit("end");
      }
    });
    await this.opened;
  }

  async push(text: string): Promise<void> {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) return;
    await this.opened;
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error("Voice stream is not open.");
    for (let offset = 0; offset < clean.length; offset += 240) {
      this.socket.send(JSON.stringify({ text: `${clean.slice(offset, offset + 240)} `, try_trigger_generation: true }));
    }
  }

  async finish(): Promise<void> {
    await this.opened;
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ text: "", flush: true }));
    }
  }

  cancel(): void {
    this.generation += 1;
    const socket = this.socket;
    this.socket = null;
    this.resolveOpen = null;
    this.rejectOpen = null;
    this.opened = null;
    if (socket) {
      socket.removeAllListeners();
      try { socket.close(1000, "barge-in"); } catch { socket.terminate?.(); }
      this.emit("cancel");
    }
  }

  private finishSocket(generation: number): void {
    if (generation !== this.generation) return;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.removeAllListeners();
      try { socket.close(1000, "complete"); } catch { socket.terminate?.(); }
    }
    this.emit("end");
  }
}
