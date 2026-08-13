import crypto from "node:crypto";
import http from "node:http";
import type { AkiraCapabilityDescriptor } from "../../shared/akira";

interface BridgeHandlers {
  list: () => AkiraCapabilityDescriptor[];
  call: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

export class AkiraHostBridge {
  readonly token = crypto.randomBytes(32).toString("base64url");
  private server: http.Server | null = null;
  private handlers: BridgeHandlers | null = null;
  private portValue = 0;

  get port(): number { return this.portValue; }

  setHandlers(handlers: BridgeHandlers): void {
    this.handlers = handlers;
  }

  async start(): Promise<number> {
    if (this.server) return this.portValue;
    const server = http.createServer((request, response) => void this.handle(request, response));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    this.portValue = typeof address === "object" && address ? address.port : 0;
    return this.portValue;
  }

  stop(): void {
    this.server?.close();
    this.server = null;
    this.portValue = 0;
  }

  private async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Cache-Control", "no-store");
    if (request.socket.remoteAddress !== "127.0.0.1" && request.socket.remoteAddress !== "::ffff:127.0.0.1") {
      this.send(response, 403, { error: "Loopback access only." });
      return;
    }
    if (request.headers.authorization !== `Bearer ${this.token}`) {
      this.send(response, 401, { error: "Unauthorized." });
      return;
    }
    if (!this.handlers) {
      this.send(response, 503, { error: "Akira capabilities are not ready." });
      return;
    }
    try {
      if (request.method === "GET" && request.url === "/v1/capabilities") {
        this.send(response, 200, { capabilities: this.handlers.list() });
        return;
      }
      if (request.method === "POST" && request.url === "/v1/call") {
        const body = await readBody(request, 256 * 1024);
        const parsed = JSON.parse(body) as { name?: unknown; arguments?: unknown };
        if (typeof parsed.name !== "string" || !parsed.arguments || typeof parsed.arguments !== "object" || Array.isArray(parsed.arguments)) {
          this.send(response, 400, { error: "A capability name and object arguments are required." });
          return;
        }
        const value = await this.handlers.call(parsed.name, parsed.arguments as Record<string, unknown>);
        this.send(response, 200, { value });
        return;
      }
      this.send(response, 404, { error: "Not found." });
    } catch (error) {
      const candidateData = error && typeof error === "object" && "candidates" in error
        ? { candidates: (error as any).candidates }
        : {};
      this.send(response, 400, { error: error instanceof Error ? error.message : String(error), ...candidateData });
    }
  }

  private send(response: http.ServerResponse, status: number, value: unknown): void {
    response.statusCode = status;
    response.end(JSON.stringify(value));
  }
}

function readBody(request: http.IncomingMessage, maximum: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maximum) {
        reject(new Error("Request body is too large."));
        request.destroy();
      } else chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

