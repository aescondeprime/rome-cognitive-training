import test from "node:test";
import assert from "node:assert/strict";
import type { AkiraCapabilityDescriptor, AkiraSettings } from "../../../shared/akira";
import { isStandbyCommand } from "../../../shared/akira";
import { DEFAULT_AKIRA_SETTINGS } from "../settings-store";
import { PermissionPolicy, matchByLabel } from "../permission-policy";
import { resolveDestination } from "../navigation";

const settings = (): AkiraSettings => structuredClone(DEFAULT_AKIRA_SETTINGS);

const descriptor = (overrides: Partial<AkiraCapabilityDescriptor> = {}): AkiraCapabilityDescriptor => ({
  name: "rome.schedule.create_assignment",
  title: "Create a Kronos assignment",
  description: "Test capability",
  inputSchema: { type: "object" },
  risk: "write",
  visual: "background",
  queryKeys: [],
  localStores: [],
  supportsUndo: true,
  ...overrides,
});

test("standby ends the conversation however it is said", () => {
  for (const said of [
    "standby", "Standby.", "Stand by", "Akira, standby.", "okay standby please",
    "deactivate", "go to sleep", "that's all", "Stand down, Akira",
  ]) {
    assert.equal(isStandbyCommand(said), true, `expected a standby command: ${said}`);
  }
});

test("standby is a whole utterance, not a word inside one", () => {
  for (const said of [
    "put the server on standby mode tomorrow",
    "what does standby cost",
    "add standby to my task list",
    "",
  ]) {
    assert.equal(isStandbyCommand(said), false, `expected ordinary speech: ${said}`);
  }
});

test("spoken surface names resolve to ROME routes", () => {
  assert.deepEqual(resolveDestination("Kronos Keep"), { kind: "surface", route: "/kronos-keep", name: "Kronos Keep" });
  // The words people actually use, rather than the ones the router uses.
  assert.equal((resolveDestination("open up my calendar") as any).route, "/kronos-keep");
  assert.equal((resolveDestination("take me to the task board") as any).route, "/taskboard");
  assert.equal((resolveDestination("navigate to the idea workshop") as any).route, "/idea-workshop");
  assert.equal((resolveDestination("/component-board") as any).route, "/component-board");
});

test("websites open in the World Browser, and ROME wins ties", () => {
  assert.deepEqual(resolveDestination("youtube"), { kind: "web", url: "https://www.youtube.com", name: "youtube.com" });
  assert.deepEqual(resolveDestination("open up news.ycombinator.com"), {
    kind: "web", url: "https://news.ycombinator.com", name: "news.ycombinator.com",
  });
  assert.equal((resolveDestination("https://example.org/docs") as any).url, "https://example.org/docs");
  // A single unknown word is a site, not a search.
  assert.equal((resolveDestination("figma") as any).url, "https://figma.com");
  // Anything longer that ROME does not know falls through to a search.
  assert.equal((resolveDestination("papers on working memory") as any).kind, "web");
  // "research" is a ROME surface, so it must not become research.com.
  assert.equal((resolveDestination("open up research") as any).route, "/research-lab");
});

test("an unknown route is refused rather than guessed", () => {
  assert.throws(() => resolveDestination("/admin"), /not an approved ROME surface/);
});

test("tasks are found by the name the user said", () => {
  const tasks = [
    { id: "a", title: "Call the dentist" },
    { id: "b", title: "Draft the Q3 brief" },
    { id: "c", title: "Draft the Q4 brief" },
  ];
  const read = (task: { title: string }) => task.title;
  assert.deepEqual(matchByLabel(tasks, "call the dentist", read).map(t => t.id), ["a"]);
  // Filler and partials still land.
  assert.deepEqual(matchByLabel(tasks, "the dentist", read).map(t => t.id), ["a"]);
  // A genuinely ambiguous name returns both, so Akira can ask.
  assert.deepEqual(matchByLabel(tasks, "draft the brief", read).map(t => t.id), ["b", "c"]);
  // An exact name is never widened into its neighbours.
  assert.deepEqual(matchByLabel(tasks, "Draft the Q3 brief", read).map(t => t.id), ["b"]);
  assert.deepEqual(matchByLabel(tasks, "buy milk", read), []);
});

test("reversible writes act without a dialog; everything else still asks", () => {
  const policy = new PermissionPolicy();
  assert.equal(policy.evaluate(descriptor(), {}, settings()).kind, "allow");
  // No undo entry means no safety net, so it asks.
  assert.equal(policy.evaluate(descriptor({ supportsUndo: false }), {}, settings()).kind, "ask");
  assert.equal(policy.evaluate(descriptor({ risk: "destructive" }), {}, settings()).kind, "ask");
  assert.equal(policy.evaluate(descriptor({ risk: "financial" }), {}, settings()).kind, "ask");

  const off = settings();
  off.approvals.autoApproveReversibleWrites = false;
  assert.equal(policy.evaluate(descriptor(), {}, off).kind, "ask");

  const asked = settings();
  asked.permissions["rome.schedule.create_assignment"] = "ask";
  assert.equal(policy.evaluate(descriptor(), {}, asked).kind, "ask");

  // Bulk work still stops, undo or not.
  assert.equal(policy.evaluate(descriptor(), { count: 200 }, settings()).kind, "ask");
});
