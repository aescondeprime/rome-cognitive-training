import readline from "node:readline";

const bridgePort = Number(process.env.ROME_AKIRA_BRIDGE_PORT);
const bridgeToken = process.env.ROME_AKIRA_BRIDGE_TOKEN || "";

if (!Number.isInteger(bridgePort) || bridgePort < 1 || !bridgeToken) {
  process.stderr.write("ROME Akira MCP bridge environment is missing.\n");
  process.exit(2);
}

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, any>;
}

async function bridge(pathname: string, init?: RequestInit): Promise<any> {
  const response = await fetch(`http://127.0.0.1:${bridgePort}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${bridgeToken}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(125_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `ROME bridge returned HTTP ${response.status}.`) as Error & { payload?: unknown };
    error.payload = payload;
    throw error;
  }
  return payload;
}

function write(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function handle(request: RpcRequest): Promise<void> {
  if (!request.method) return;
  if (request.method === "notifications/initialized" || request.method.startsWith("notifications/")) return;
  const id = request.id ?? null;
  try {
    let result: unknown;
    if (request.method === "initialize") {
      result = {
        protocolVersion: "2024-11-05",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "rome-akira", version: "2.0.0" },
      };
    } else if (request.method === "ping") {
      result = {};
    } else if (request.method === "tools/list") {
      const payload = await bridge("/v1/capabilities");
      result = {
        tools: payload.capabilities.map((capability: any) => ({
          name: capability.name,
          title: capability.title,
          description: `${capability.description} [risk:${capability.risk}; visual:${capability.visual}]`,
          inputSchema: capability.inputSchema,
        })),
      };
    } else if (request.method === "tools/call") {
      const name = request.params?.name;
      const args = request.params?.arguments ?? {};
      if (typeof name !== "string" || !args || typeof args !== "object" || Array.isArray(args)) {
        throw new Error("Invalid tools/call request.");
      }
      try {
        const payload = await bridge("/v1/call", {
          method: "POST",
          body: JSON.stringify({ name, arguments: args }),
        });
        result = { content: [{ type: "text", text: JSON.stringify(payload.value) }], isError: false };
      } catch (error) {
        const detail = error && typeof error === "object" && "payload" in error
          ? (error as Error & { payload?: unknown }).payload
          : { error: error instanceof Error ? error.message : String(error) };
        result = { content: [{ type: "text", text: JSON.stringify(detail) }], isError: true };
      }
    } else {
      write({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${request.method}` } });
      return;
    }
    write({ jsonrpc: "2.0", id, result });
  } catch (error) {
    write({
      jsonrpc: "2.0",
      id,
      error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
    });
  }
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", line => {
  if (!line.trim()) return;
  try { void handle(JSON.parse(line)); }
  catch { write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
});
