import type { AkiraCapabilityDescriptor, AkiraSettings } from "../../shared/akira";

export class AmbiguousTargetError extends Error {
  constructor(public readonly candidates: unknown[], message = "The target is ambiguous.") {
    super(message);
    this.name = "AmbiguousTargetError";
  }
}

export function requireSingleMatch<T>(matches: T[], label: string): T {
  if (matches.length === 0) throw new Error(`${label} was not found.`);
  if (matches.length > 1) throw new AmbiguousTargetError(matches, `More than one ${label} matched. Ask the user to choose one.`);
  return matches[0];
}

export type PermissionDecision =
  | { kind: "allow" }
  | { kind: "deny"; reason: string }
  | { kind: "ask"; reason: string };

function estimatedBulkCount(args: Record<string, unknown>): number {
  const explicit = Number(args.count ?? args.limit ?? 0);
  const arrays = Object.values(args).filter(Array.isArray).map(value => value.length);
  return Math.max(Number.isFinite(explicit) ? explicit : 0, ...arrays, 0);
}

export class PermissionPolicy {
  constructor(private readonly bulkThreshold = 20) {}

  evaluate(
    descriptor: AkiraCapabilityDescriptor,
    args: Record<string, unknown>,
    settings: AkiraSettings,
  ): PermissionDecision {
    const override = settings.permissions[descriptor.name];
    if (override === "deny") return { kind: "deny", reason: "This capability is disabled in Akira permissions." };
    if (override === "allow" && descriptor.risk !== "destructive" && descriptor.risk !== "financial") {
      return { kind: "allow" };
    }
    if (estimatedBulkCount(args) > this.bulkThreshold) {
      return { kind: "ask", reason: `This request may affect more than ${this.bulkThreshold} records.` };
    }
    if (descriptor.risk === "destructive") return { kind: "ask", reason: "Destructive actions always require approval." };
    if (descriptor.risk === "financial") return { kind: "ask", reason: "Financial changes always require approval." };
    if (override === "ask" || descriptor.risk === "write") return { kind: "ask", reason: "This action changes ROME data." };
    return { kind: "allow" };
  }
}

export function validateCapabilityArguments(
  schema: Record<string, unknown>,
  args: Record<string, unknown>,
): void {
  if (schema.type !== "object") throw new Error("Capability schema must describe an object.");
  const properties = schema.properties && typeof schema.properties === "object"
    ? schema.properties as Record<string, Record<string, unknown>>
    : {};
  const required = Array.isArray(schema.required) ? schema.required.map(String) : [];
  for (const key of required) {
    if (!(key in args) || args[key] === undefined || args[key] === null || args[key] === "") {
      throw new Error(`${key} is required.`);
    }
  }
  if (schema.additionalProperties === false) {
    const unknown = Object.keys(args).find(key => !(key in properties));
    if (unknown) throw new Error(`Unsupported argument: ${unknown}.`);
  }
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue;
    const property = properties[key];
    if (!property?.type) continue;
    const valid = property.type === "array"
      ? Array.isArray(value)
      : property.type === "object"
        ? typeof value === "object" && !Array.isArray(value)
        : property.type === "number"
          ? typeof value === "number" && Number.isFinite(value)
          : property.type === "integer"
            ? Number.isInteger(value)
            : typeof value === property.type;
    if (!valid) throw new Error(`${key} must be ${property.type}.`);
    if (property.type === "array" && property.items && typeof property.items === "object") {
      const itemType = (property.items as Record<string, unknown>).type;
      if (typeof itemType === "string" && !(value as unknown[]).every(item => typeof item === itemType)) {
        throw new Error(`${key} items must be ${itemType}.`);
      }
    }
  }
}
