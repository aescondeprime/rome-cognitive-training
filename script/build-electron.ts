/**
 * Build script for ROME Electron desktop app.
 * 1. Builds the web frontend (Vite)
 * 2. Builds the Express server (esbuild → dist/index.cjs)
 * 3. Compiles Electron main + preload (esbuild → dist-electron/)
 */
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function run(cmd: string, label: string) {
  console.log(`\n⚡ ${label}...`);
  execSync(cmd, { cwd: root, stdio: "inherit" });
}

// 1. Web + server bundle (existing build)
run("tsx script/build.ts", "Building web + server");

// 2. Compile Electron main process
run(
  `node_modules/.bin/esbuild electron/main.ts --bundle --platform=node --target=node18 --format=cjs --external:electron --external:better-sqlite3 --outfile=dist-electron/main.js`,
  "Compiling Electron main"
);

// 3. Compile Electron preload
run(
  `node_modules/.bin/esbuild electron/preload.ts --bundle --platform=node --target=node18 --format=cjs --external:electron --outfile=dist-electron/preload.js`,
  "Compiling Electron preload"
);

console.log("\n✅ Electron build complete → dist-electron/");
