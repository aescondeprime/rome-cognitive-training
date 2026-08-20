import assert from "node:assert/strict";
import test from "node:test";
import type { AkiraCapabilityDescriptor } from "../../../shared/akira";
import {
  DISPATCH_TOOL_NAME,
  DISPATCH_TOOL_SPEC,
  buildCapabilityCatalogue,
  parseDispatch,
} from "../tool-catalogue";

/**
 * Dispatch tool tests.
 *
 * Every capability reaches Akira through one tool and a prompt catalogue, so
 * these two functions are the entire action surface. `parseDispatch` in
 * particular has to be forgiving: the model decides how to encode arguments,
 * and a rejection there is a request the user has to repeat.
 */

const descriptor = (over: Partial<AkiraCapabilityDescriptor> = {}): AkiraCapabilityDescriptor => ({
  name: "rome.tasks.create",
  title: "Create a task",
  description: "Creates a task card.",
  inputSchema: {
    type: "object",
    properties: {
      content: { type: "string", description: "Task text." },
      color: { type: "string" },
    },
    required: ["content"],
  },
  risk: "write",
  visual: "background",
  queryKeys: [],
  localStores: [],
  supportsUndo: true,
  ...over,
});

test("arguments arrive as a JSON string", () => {
  const parsed = parseDispatch({ capability: "rome.tasks.create", arguments_json: '{"content":"Write spec"}' });
  assert.deepEqual(parsed, { capability: "rome.tasks.create", args: { content: "Write spec" } });
});

test("an already-parsed object is accepted too", () => {
  // Models routinely send the object rather than a string, and rejecting that
  // would fail a request that was perfectly well formed.
  const parsed = parseDispatch({ capability: "rome.tasks.create", arguments_json: { content: "Write spec" } });
  assert.deepEqual(parsed, { capability: "rome.tasks.create", args: { content: "Write spec" } });
});

test("an empty or omitted argument object means no arguments", () => {
  for (const value of ["{}", "", undefined, "   "]) {
    const parsed = parseDispatch({ capability: "rome.tasks.list", arguments_json: value });
    assert.deepEqual(parsed, { capability: "rome.tasks.list", args: {} }, `failed for ${JSON.stringify(value)}`);
  }
});

test("a missing capability is refused with a message the model can act on", () => {
  const parsed = parseDispatch({ arguments_json: "{}" }) as { error: string };
  assert.match(parsed.error, /capability/i);
  assert.match(parsed.error, /catalogue/i);
});

test("malformed JSON is refused with an example rather than a parser error", () => {
  const parsed = parseDispatch({ capability: "rome.tasks.create", arguments_json: "{content: broken" }) as { error: string };
  assert.match(parsed.error, /valid JSON/i);
  assert.match(parsed.error, /\{"title":"Example"\}/);
});

test("a JSON array is refused — arguments must be an object", () => {
  const parsed = parseDispatch({ capability: "rome.tasks.create", arguments_json: '["content"]' }) as { error: string };
  assert.match(parsed.error, /JSON object/i);
});

test("the catalogue names each capability with its argument contract", () => {
  const catalogue = buildCapabilityCatalogue([descriptor()]);
  assert.match(catalogue, /rome\.tasks\.create/);
  assert.match(catalogue, /content: string/);
  assert.match(catalogue, /Task text/);
  assert.match(catalogue, new RegExp(DISPATCH_TOOL_NAME));
});

test("risk and navigation are marked, so Akira can warn before it acts", () => {
  const catalogue = buildCapabilityCatalogue([
    descriptor({ name: "rome.a.read", risk: "read" }),
    descriptor({ name: "rome.b.write", risk: "write" }),
    descriptor({ name: "rome.c.delete", risk: "destructive" }),
    descriptor({ name: "rome.d.open", risk: "read", visual: "navigate" }),
  ]);
  assert.ok(!/rome\.a\.read \[read\]/.test(catalogue), "reads should not be annotated");
  assert.match(catalogue, /rome\.b\.write \[write\]/);
  assert.match(catalogue, /rome\.c\.delete \[destructive\]/);
  assert.match(catalogue, /rome\.d\.open.*\[moves the user\]/);
});

test("a capability with no properties is described as taking none", () => {
  const catalogue = buildCapabilityCatalogue([
    descriptor({ name: "rome.stats", inputSchema: { type: "object", properties: {} } }),
  ]);
  assert.match(catalogue, /rome\.stats.*no arguments/);
});

test("optional arguments are distinguished from required ones", () => {
  const catalogue = buildCapabilityCatalogue([descriptor()]);
  // `content` is required, `color` is not — the marker is what stops the model
  // inventing values for fields it was never asked to supply.
  assert.match(catalogue, /content: string/);
  assert.match(catalogue, /color\?: string/);
});

test("an empty registry still produces a usable line", () => {
  assert.match(buildCapabilityCatalogue([]), /No ROME capabilities/);
});

test("the dashboard tool spec matches what the parser expects", () => {
  // The spec is copied by hand into the ElevenLabs dashboard, so a drift
  // between it and parseDispatch would be silent and total.
  const identifiers = DISPATCH_TOOL_SPEC.parameters.map(parameter => parameter.identifier);
  assert.deepEqual(identifiers, ["capability", "arguments_json"]);
  assert.equal(DISPATCH_TOOL_SPEC.name, DISPATCH_TOOL_NAME);
  assert.equal(DISPATCH_TOOL_SPEC.waitForResponse, true);
  assert.ok(DISPATCH_TOOL_SPEC.parameters.every(parameter => parameter.required));
});
