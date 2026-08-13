import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { HermesRuntimeManager } from "../runtime-manager";
import { DEFAULT_AKIRA_SETTINGS } from "../settings-store";

test("managed runtime can be replaced without a stale exit degrading the replacement", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "akira-runtime-"));
  const executable = path.join(root, "fake-hermes");
  writeFileSync(executable, `#!/usr/bin/env node
const http = require('node:http');
if (process.argv.includes('--version')) { console.log('fake-hermes 1.0'); process.exit(0); }
const index = process.argv.indexOf('--port');
const port = Number(process.argv[index + 1]);
const server = http.createServer((req, res) => { res.statusCode = req.url === '/health' ? 200 : 404; res.end('{}'); });
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
