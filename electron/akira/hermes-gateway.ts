import { EventEmitter } from "node:events";
import WebSocket from "ws";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface GatewayEvent {
  type: string;
  [key: string]: unknown;
}

export interface GatewaySocket extends EventEmitter {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate?(): void;
}

export type GatewaySocketFactory = (url: string) => GatewaySocket;

export class HermesGatewayClient extends EventEmitter {
  private socket: GatewaySocket | null = null;
  private sequence = 0;
  private readonly pending = new Map<number, PendingRequest>();

  constructor(
    private readonly createSocket: GatewaySocketFactory = (url) => new WebSocket(url) as unknown as GatewaySocket,
  ) {
    super();
  }

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  async connect(url: string, timeoutMs = 15_000): Promise<void> {
    this.disconnect();
    const socket = this.createSocket(url);
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        socket.terminate?.();
        reject(new Error("Timed out connecting to the Hermes gateway."));
      }, timeoutMs);
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

    socket.on("message", (value: Buffer | string) => this.handleMessage(value));
    socket.on("close", () => {
      if (this.socket === socket) this.socket = null;
      this.rejectPending(new Error("Hermes gateway disconnected."));
      this.emit("disconnect");
    });
    socket.on("error", (error: Error) => this.emit("error", error));
    this.emit("connect");
  }

  request<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 60_000): Promise<T> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Hermes gateway is not connected."));
    }
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Hermes request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.socket!.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  notify(method: string, params: Record<string, unknown> = {}): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
  }

  disconnect(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.removeAllListeners();
      try { socket.close(1000, "ROME shutdown"); } catch { socket.terminate?.(); }
    }
    this.rejectPending(new Error("Hermes gateway disconnected."));
  }

  private handleMessage(value: Buffer | string): void {
    let frame: Record<string, any>;
    try { frame = JSON.parse(Buffer.isBuffer(value) ? value.toString("utf8") : value); }
    catch { return; }

    if (typeof frame.id === "number" && ("result" in frame || "error" in frame)) {
      const pending = this.pending.get(frame.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(frame.id);
      if (frame.error) {
        pending.reject(new Error(frame.error.message || `Hermes RPC error ${frame.error.code ?? "unknown"}`));
      } else {
        pending.resolve(frame.result);
      }
      return;
    }

    const envelope = frame.params?.event ?? frame.params ?? frame.result ?? frame;
    const nested = envelope && typeof envelope === "object" && envelope.payload && typeof envelope.payload === "object"
      ? envelope.payload
      : null;
    const payload = nested ? { ...envelope, ...nested } : envelope;
    const type = String(payload?.type ?? (frame.method !== "event" ? frame.method : "gateway.event") ?? "gateway.event");
    const event: GatewayEvent = typeof payload === "object" && payload !== null
      ? { ...payload, type }
      : { type, value: payload };
    this.emit("event", event);
    this.emit(type, event);
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }
}
