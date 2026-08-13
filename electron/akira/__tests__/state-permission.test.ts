import test from "node:test";
import assert from "node:assert/strict";
import type { AkiraCapabilityDescriptor, AkiraSettings } from "../../../shared/akira";
import { DEFAULT_AKIRA_SETTINGS } from "../settings-store";
import { AkiraStateMachine } from "../state-machine";
import { AmbiguousTargetError, PermissionPolicy, requireSingleMatch, validateCapabilityArguments } from "../permission-policy";

const descriptor = (overrides: Partial<AkiraCapabilityDescriptor> = {}): AkiraCapabilityDescriptor => ({
  name: "rome.test.write",
  title: "Test write",
  description: "Test capability",
  inputSchema: { type: "object" },
  risk: "write",
  visual: "background",
  queryKeys: [],
  localStores: [],
  supportsUndo: false,
  ...overrides,
});

const settings = (): AkiraSettings => structuredClone(DEFAULT_AKIRA_SETTINGS);

test("Akira state machine accepts the continuous-conversation path", () => {
  const machine = new AkiraStateMachine();
  const seen: string[] = [];
  machine.on("change", change => seen.push(`${change.previous}->${change.state}`));
  machine.transition("WAKE_DETECTED");
  machine.transition("LISTENING");
  machine.transition("PROCESSING");
  machine.transition("ACTING");
  machine.transition("PROCESSING");
  machine.transition("SPEAKING");
  machine.transition("AWAKE_IDLE");
  machine.transition("LISTENING");
  assert.equal(machine.state, "LISTENING");
  assert.deepEqual(seen.slice(0, 3), ["DORMANT->WAKE_DETECTED", "WAKE_DETECTED->LISTENING", "LISTENING->PROCESSING"]);
});

test("Akira state machine rejects unsafe jumps", () => {
  const machine = new AkiraStateMachine("DORMANT");
  assert.throws(() => machine.transition("SPEAKING"), /Invalid Akira transition/);
  assert.equal(machine.state, "DORMANT");
});

test("permission policy gates writes, destructive, financial, and bulk work", () => {
  const policy = new PermissionPolicy(20);
  const current = settings();
  assert.deepEqual(policy.evaluate(descriptor({ risk: "read" }), {}, current), { kind: "allow" });
  assert.equal(policy.evaluate(descriptor(), {}, current).kind, "ask");
  assert.equal(policy.evaluate(descriptor({ risk: "destructive" }), {}, current).kind, "ask");
  assert.equal(policy.evaluate(descriptor({ risk: "financial" }), {}, current).kind, "ask");
  assert.equal(policy.evaluate(descriptor({ risk: "read" }), { ids: Array.from({ length: 21 }, (_, index) => index) }, current).kind, "ask");
  current.permissions["rome.test.write"] = "allow";
  assert.equal(policy.evaluate(descriptor(), {}, current).kind, "allow");
  current.permissions["rome.test.write"] = "deny";
  assert.equal(policy.evaluate(descriptor(), {}, current).kind, "deny");
});

test("target resolution never silently chooses an ambiguous match", () => {
  assert.equal(requireSingleMatch([{ id: 1 }], "note").id, 1);
  assert.throws(() => requireSingleMatch([], "note"), /not found/);
  assert.throws(
    () => requireSingleMatch([{ id: 1 }, { id: 2 }], "note"),
    error => error instanceof AmbiguousTargetError && error.candidates.length === 2,
  );
});

test("capability schemas reject missing, unknown, and incorrectly typed arguments", () => {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: { title: { type: "string" }, count: { type: "number" } },
    required: ["title"],
  };
  assert.doesNotThrow(() => validateCapabilityArguments(schema, { title: "Launch", count: 2 }));
  assert.throws(() => validateCapabilityArguments(schema, { count: 2 }), /title is required/);
  assert.throws(() => validateCapabilityArguments(schema, { title: "Launch", surprise: true }), /Unsupported argument/);
  assert.throws(() => validateCapabilityArguments(schema, { title: "Launch", count: "two" }), /count must be number/);
});
