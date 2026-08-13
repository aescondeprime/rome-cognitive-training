import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AkiraActivityStore } from "../activity-store";
import { AkiraCapabilityRegistry } from "../capability-registry";
import { DEFAULT_AKIRA_SETTINGS } from "../settings-store";

function startApi(routes: Record<string, unknown>) {
  const requests: Array<{ method: string; url: string; body: unknown }> = [];
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      const body = bodyText ? JSON.parse(bodyText) : undefined;
      requests.push({ method: request.method || "", url: request.url || "", body });
      const key = `${request.method} ${request.url}`;
      const value = routes[key] ?? { error: `No test route: ${key}` };
      response.statusCode = key in routes ? 200 : 404;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(typeof value === "function" ? (value as Function)(body) : value));
    });
  });
  return new Promise<{ base: string; requests: typeof requests; close: () => Promise<void> }>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        base: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise<void>((done, fail) => server.close(error => error ? fail(error) : done())),
      });
    });
  });
}

function settings(overrides: Record<string, "allow" | "deny" | "ask"> = {}) {
  const value = structuredClone(DEFAULT_AKIRA_SETTINGS);
  value.permissions = overrides;
  return { get: () => structuredClone(value) } as any;
}

test("context snapshot combines live API, renderer-local, and native browser metadata", async () => {
  const api = await startApi({
    "GET /api/active-profile": { id: 7, name: "Marcus" },
    "GET /api/boards": [{ id: 1, title: "Launch", type: "taskboard" }],
    "GET /api/taskboard": [{ id: 8, content: "Legacy card" }],
    "GET /api/kronos/today": [{ id: 3, title: "Review" }],
    "GET /api/notes": [{ id: 5, title: "North star" }],
    "GET /api/memory": [{ id: 6, title: "Preference" }],
  });
  const renderer = { command: async (action: string) => {
    assert.equal(action, "context.snapshot");
    return { route: "/taskboard", local: { taskStabilizer: { active: 2 } } };
  } } as any;
  const browser = {
    tabs: {
      getStates: () => [{ id: "tab-1", active: true, title: "Docs", url: "https://user:password@example.test/?token=secret#private" }],
      getActiveState: () => ({ id: "tab-1", active: true, title: "Docs", url: "https://user:password@example.test/?token=secret#private" }),
    },
  } as any;
  const registry = new AkiraCapabilityRegistry({
    browser: () => browser,
    renderer,
    settings: settings(),
    activity: new AkiraActivityStore(path.join(mkdtempSync(path.join(os.tmpdir(), "akira-context-")), "state")),
    requestApproval: async () => true,
    emitChanged: () => undefined,
    serverBase: api.base,
  });
  try {
    const value: any = await registry.call("rome.get_context", {});
    assert.equal(value.result.route, "/taskboard");
    assert.equal(value.result.profile.name, "Marcus");
    assert.equal(value.result.browser.active.title, "Docs");
    assert.doesNotMatch(value.result.browser.active.url, /user|password|secret|private/);
    assert.equal(value.result.workspace.boards[0].title, "Launch");
    assert.equal(value.result.workspace.local.taskStabilizer.active, 2);
  } finally {
    await api.close();
  }
});

test("capability schema validation runs before permission prompts or mutations", async () => {
  const api = await startApi({ "GET /api/active-profile": { id: 7 } });
  let approvals = 0;
  const registry = new AkiraCapabilityRegistry({
    browser: () => null,
    renderer: { command: async () => ({}) } as any,
    settings: settings(),
    activity: new AkiraActivityStore(path.join(mkdtempSync(path.join(os.tmpdir(), "akira-schema-")), "state")),
    requestApproval: async () => { approvals += 1; return true; },
    emitChanged: () => undefined,
    serverBase: api.base,
  });
  try {
    await assert.rejects(registry.call("rome.boards.create", { title: "Launch", type: 4 } as any), /type must be string/);
    assert.equal(approvals, 0);
    assert.equal(api.requests.some(request => request.method === "POST"), false);
  } finally {
    await api.close();
  }
});

test("capability mutation asks approval, executes once, and emits authoritative invalidation", async () => {
  const api = await startApi({
    "POST /api/boards": (body: any) => ({ id: 41, ...body }),
    "GET /api/active-profile": { id: 7 },
  });
  const changed: any[] = [];
  let approvals = 0;
  const registry = new AkiraCapabilityRegistry({
    browser: () => null,
    renderer: { command: async () => ({}) } as any,
    settings: settings(),
    activity: new AkiraActivityStore(path.join(mkdtempSync(path.join(os.tmpdir(), "akira-mutation-")), "state")),
    requestApproval: async () => { approvals += 1; return true; },
    emitChanged: event => changed.push(event),
    serverBase: api.base,
  });
  try {
    const value: any = await registry.call("rome.boards.create", { title: "Launch", type: "taskboard" });
    assert.equal(value.result.id, 41);
    assert.equal(approvals, 1);
    assert.ok(value.undoId);
    assert.deepEqual(changed[0].queryKeys, [["/boards"], ["/research-boards"], ["/api/boards"]]);
    assert.equal(api.requests.filter(request => request.method === "POST").length, 1);
  } finally {
    await api.close();
  }
});

test("ambiguous capability target fails before any mutation", async () => {
  const api = await startApi({
    "GET /api/boards": [
      { id: 1, title: "Launch", type: "taskboard" },
      { id: 2, title: "Launch", type: "taskboard" },
    ],
  });
  const registry = new AkiraCapabilityRegistry({
    browser: () => null,
    renderer: { command: async () => ({}) } as any,
    settings: settings({ "rome.boards.rename": "allow" }),
    activity: new AkiraActivityStore(path.join(mkdtempSync(path.join(os.tmpdir(), "akira-ambiguous-")), "state")),
    requestApproval: async () => true,
    emitChanged: () => undefined,
    serverBase: api.base,
  });
  try {
    await assert.rejects(
      registry.call("rome.boards.rename", { currentTitle: "Launch", title: "New" }),
      /More than one board matched/,
    );
    assert.equal(api.requests.some(request => request.method === "PATCH"), false);
  } finally {
    await api.close();
  }
});
