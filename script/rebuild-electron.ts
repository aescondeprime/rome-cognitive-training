import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..");
const cacheHome = process.env.ROME_ELECTRON_GYP_HOME?.trim();

// @electron/rebuild currently derives its header cache from os.homedir() and
// does not expose a programmatic cache option. This task-specific override is
// useful in sandboxed builders without mutating HOME; normal builds use the
// operating system home directory unchanged.
if (cacheHome) {
  const resolved = path.resolve(cacheHome);
  fs.mkdirSync(resolved, { recursive: true });
  os.homedir = () => resolved;
}

const electronPackage = JSON.parse(
  fs.readFileSync(path.join(root, "node_modules", "electron", "package.json"), "utf8"),
) as { version: string };
const { rebuild } = await import("@electron/rebuild");

await rebuild({
  buildPath: root,
  electronVersion: electronPackage.version,
  force: true,
  onlyModules: ["better-sqlite3"],
  mode: "sequential",
});

console.log(`[ROME] Native modules rebuilt for Electron ${electronPackage.version}`);

