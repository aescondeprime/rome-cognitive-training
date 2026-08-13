import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { HermesRuntimeManager, hermesInstallArguments, resolveUvExecutable } from "../runtime-manager";
import { DEFAULT_AKIRA_SETTINGS } from "../settings-store";

test("managed runtime can be replaced without a stale exit degrading the replacement", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "akira-runtime-"));
  const executable = path.join(root, "fake-hermes");
  writeFileSync(executable, `#!/usr/bin/env node
const http = require('node:http');
if (process.argv.includes('--version')) { console.log('fake-hermes 1.0'); process.exit(0); }
const index = process.argv.indexOf('--port');
const port = Number(process.argv[index + 1]);
const server = http.createServer((req, res) => { res.statusCode = req.url === '/api/health' ? 200 : 404; res.end('{}'); });
server.listen(port, '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
`, { mode: 0o700 });
  chmodSync(executable, 0o700);
  const settings = {
    get: () => structuredClone(DEFAULT_AKIRA_SETTINGS),
    getSecret: () => "provider-super-secret",
  } as any;
  const previous = process.env.HERMES_EXECUTABLE;
  process.env.HERMES_EXECUTABLE = executable;
  const manager = new HermesRuntimeManager({
    root,
    mcpEntry: "/tmp/akira-mcp.cjs",
    bridgePort: 12345,
    bridgeToken: "bridge-token",
    settings,
    electronExecutable: process.execPath,
  });
  try {
    await manager.initialize();
    assert.equal(manager.status.phase, "ready");
    const firstUpdatedAt = manager.status.updatedAt;
    await manager.start(executable);
    assert.equal(manager.status.phase, "ready");
    assert.ok(manager.status.updatedAt >= firstUpdatedAt);
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.equal(manager.status.phase, "ready");
    assert.equal(manager.status.restartCount, 0);
    const config = readFileSync(path.join(root, "hermes", "config.yaml"), "utf8");
    assert.doesNotMatch(config, /bridge-token/);
    assert.doesNotMatch(config, /provider-super-secret/);
    assert.match(config, /mcp-rome/);
    assert.match(config, /disabled_toolsets:/);
    assert.match(config, /sensitivity: 0\.65/);
    assert.match(config, /start_new_session: false/);
    const manifest = JSON.parse(readFileSync(path.join(root, "runtime-manifest.json"), "utf8"));
    assert.equal(manifest.requiredHermesVersion, "0.20.0");
  } finally {
    manager.stop();
    if (previous === undefined) delete process.env.HERMES_EXECUTABLE;
    else process.env.HERMES_EXECUTABLE = previous;
  }
});

test("uv discovery accepts an absolute executable outside the GUI application PATH", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "akira-uv-"));
  const executable = path.join(root, "uv");
  writeFileSync(executable, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  chmodSync(executable, 0o700);
  const previous = process.env.UV_EXECUTABLE;
  process.env.UV_EXECUTABLE = executable;
  try {
    assert.equal(resolveUvExecutable(), executable);
  } finally {
    if (previous === undefined) delete process.env.UV_EXECUTABLE;
    else process.env.UV_EXECUTABLE = previous;
  }
});

test("Hermes source extras use a supported package requirement", () => {
  const args = hermesInstallArguments("/managed/hermes-agent");
  assert.deepEqual(args.slice(0, 5), ["tool", "install", "--force", "--python", "3.11"]);
  assert.doesNotMatch(args.join(" "), /(?:^|\s)--extra(?:\s|$)/);
  assert.equal(args.at(-2), "--editable");
  assert.equal(args.at(-1), "/managed/hermes-agent[voice,wake]");
  assert.doesNotMatch(args.join(" "), /https:\/\//);
});

test("a failed Hermes install leaves the runtime degraded instead of installing", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "akira-install-failure-"));
  const executable = path.join(root, "uv");
  writeFileSync(path.join(root, "pyproject.toml"), "[project]\nname='fake-hermes'\nversion='1.0.0'\n");
  writeFileSync(executable, "#!/bin/sh\necho installer-failed >&2\nexit 2\n", { mode: 0o700 });
  chmodSync(executable, 0o700);
  const previous = process.env.UV_EXECUTABLE;
  const previousSource = process.env.HERMES_SOURCE_DIR;
  process.env.UV_EXECUTABLE = executable;
  process.env.HERMES_SOURCE_DIR = root;
  const manager = new HermesRuntimeManager({
    root,
    mcpEntry: "/tmp/akira-mcp.cjs",
    bridgePort: 12345,
    bridgeToken: "bridge-token",
    settings: {
      get: () => structuredClone(DEFAULT_AKIRA_SETTINGS),
      getSecret: () => null,
    } as any,
    electronExecutable: process.execPath,
  });
  try {
    await assert.rejects(manager.installOrRepair(), /Hermes installer exited with code 2/);
    assert.equal(manager.status.phase, "degraded");
    assert.match(manager.status.message ?? "", /code 2/);
    assert.ok(manager.logs.some(line => line.includes("installer-failed")));
  } finally {
    manager.stop();
    if (previous === undefined) delete process.env.UV_EXECUTABLE;
    else process.env.UV_EXECUTABLE = previous;
    if (previousSource === undefined) delete process.env.HERMES_SOURCE_DIR;
    else process.env.HERMES_SOURCE_DIR = previousSource;
  }
});
