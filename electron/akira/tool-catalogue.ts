import type { AkiraCapabilityDescriptor } from "../../shared/akira";

/**
 * How Akira reaches ROME's capabilities from an ElevenLabs agent.
 *
 * ElevenLabs client tools must be pre-registered on the agent — they cannot be
 * supplied per-conversation — and the tools API is mid-migration from inline
 * `prompt.tools` to a separate registry with workflow nodes. Syncing ~30 tool
 * definitions against that would mean either a lot of manual dashboard work or
 * code written blind against an API shape that is actively changing.
 *
 * So the agent gets exactly ONE client tool, `rome_execute`, and the catalogue
 * of what it can execute is injected into the system prompt, which *is*
 * overridable per conversation. Adding a capability in ROME therefore needs no
 * dashboard change at all — the next conversation simply describes it.
 *
 * The trade-off is real: the model sees a text catalogue rather than typed tool
 * schemas, so argument fidelity depends on how clearly the catalogue reads.
 * `validateCapabilityArguments` in the registry is the backstop, and its errors
 * are written to be legible to a model that needs to retry.
 */

export const DISPATCH_TOOL_NAME = "rome_execute";

/** Paste-once dashboard configuration, surfaced in setup docs and diagnostics. */
export const DISPATCH_TOOL_SPEC = {
  name: DISPATCH_TOOL_NAME,
  description:
    "Execute a capability inside the ROME application. The exact capability names and their arguments are listed in the ROME CAPABILITIES section of your system prompt. Wait for the response before telling the user what happened.",
  waitForResponse: true,
  parameters: [
    {
      identifier: "capability",
      type: "String",
      required: true,
      description: 'Exact capability name from the catalogue, for example "rome.ideas.create".',
    },
    {
      identifier: "arguments_json",
      type: "String",
      required: true,
      description:
        'Arguments as a JSON object encoded in a string, for example {"title":"New concept"}. Use {} when the capability takes none.',
    },
  ],
} as const;

/** Collapse a JSON Schema into one readable argument line. */
function describeArguments(schema: Record<string, unknown> | undefined): string {
  const properties = schema?.properties;
  if (!properties || typeof properties !== "object") return "no arguments";
  const required = new Set(Array.isArray(schema?.required) ? schema.required as string[] : []);
  const entries = Object.entries(properties as Record<string, any>);
  if (!entries.length) return "no arguments";
  return entries
    .map(([name, definition]) => {
      const type = String(definition?.type ?? "string");
      const flag = required.has(name) ? "" : "?";
      const note = typeof definition?.description === "string" && definition.description
        ? ` — ${definition.description.replace(/\s+/g, " ").trim()}`
        : "";
      return `${name}${flag}: ${type}${note}`;
    })
    .join("; ");
}

/**
 * Render the capability catalogue for the system prompt.
 *
 * Read capabilities are listed compactly; anything that mutates is marked with
 * its risk so the agent knows in advance that it may be interrupted by an
 * approval prompt, and does not claim success before the tool result arrives.
 */
export function buildCapabilityCatalogue(capabilities: AkiraCapabilityDescriptor[]): string {
  if (!capabilities.length) return "No ROME capabilities are currently available.";

  const lines = capabilities
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(capability => {
      const risk = capability.risk === "read" ? "" : ` [${capability.risk}]`;
      const visual = capability.visual === "navigate" ? " [moves the user]" : "";
      return `- ${capability.name}${risk}${visual}: ${capability.description.replace(/\s+/g, " ").trim()} (${describeArguments(capability.inputSchema)})`;
    });

  return [
    "ROME CAPABILITIES",
    `Call the ${DISPATCH_TOOL_NAME} tool with one of these capability names and a JSON argument string.`,
    "Capabilities marked [write], [destructive], or [financial] may require the user to approve the action;",
    "if that happens the tool result will say so. Never state that something is done until the result confirms it.",
    "Capabilities marked [moves the user] change what is on screen, so only use them when seeing the result is the point.",
    "",
    ...lines,
  ].join("\n");
}

export interface DispatchRequest {
  capability: string;
  args: Record<string, unknown>;
}

/**
 * Parse a `rome_execute` call.
 *
 * Models sometimes send `arguments_json` as an already-parsed object rather
 * than a string, and sometimes wrap the string in stray formatting. Both are
 * accepted; anything else returns a message written for the model to act on.
 */
export function parseDispatch(parameters: Record<string, unknown>): DispatchRequest | { error: string } {
  const capability = String(parameters.capability ?? "").trim();
  if (!capability) {
    return { error: "Missing 'capability'. Provide an exact capability name from the ROME CAPABILITIES catalogue." };
  }

  const raw = parameters.arguments_json ?? parameters.arguments ?? {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return { capability, args: raw as Record<string, unknown> };
  }

  const text = String(raw ?? "").trim();
  if (!text || text === "{}") return { capability, args: {} };

  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { error: "'arguments_json' must be a JSON object, for example {\"title\":\"Example\"}." };
    }
    return { capability, args: parsed as Record<string, unknown> };
  } catch {
    return { error: "'arguments_json' was not valid JSON. Send a JSON object encoded as a string, for example {\"title\":\"Example\"}." };
  }
}
