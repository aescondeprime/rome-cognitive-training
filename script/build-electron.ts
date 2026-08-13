/**
 * Build script for the ROME Electron desktop application.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function run(command: string, label: string): void {
  console.log(`\n[ROME] ${label}...`);

  const result = spawnSync(command, {
    cwd: root,
    shell: true,
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    console.error(
      `\n[ROME] ${label} could not be started:\n`,
      result.error
    );
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(
      `\n[ROME] ${label} failed with exit code ${result.status ?? 1}.`
    );
    process.exit(result.status ?? 1);
  }
}

// 1. Build Vite frontend and Express server.
run("node --import tsx script/build.ts", "Building web and server");

// 2. Compile Electron main process.
run(
  [
    "npx esbuild electron/main.ts",
    "--bundle",
    "--platform=node",
    "--target=node20",
    "--format=cjs",
    "--external:electron",
    "--external:better-sqlite3",
    "--outfile=dist-electron/main.cjs",
  ].join(" "),
  "Compiling Electron main process"
);

// 3. Compile Electron preload.
run(
  [
    "npx esbuild electron/preload.ts",
    "--bundle",
    "--platform=node",
    "--target=node20",
    "--format=cjs",
    "--external:electron",
    "--outfile=dist-electron/preload.cjs",
  ].join(" "),
  "Compiling Electron preload"
);

// 4. Compile Akira's sandboxed MCP stdio server. Hermes launches this file
// through the Electron executable with ELECTRON_RUN_AS_NODE=1.
run(
  [
    "npx esbuild electron/akira/mcp-server.ts",
    "--bundle",
    "--platform=node",
    "--target=node20",
    "--format=cjs",
    "--outfile=dist-electron/akira-mcp.cjs",
  ].join(" "),
  "Compiling Akira capability bridge"
);

// 5. Rebuild native module against Electron.
run(
  "node --import tsx script/rebuild-electron.ts",
  "Rebuilding better-sqlite3"
);

console.log(
  "\n[ROME] Electron compilation completed: dist-electron/"
);
