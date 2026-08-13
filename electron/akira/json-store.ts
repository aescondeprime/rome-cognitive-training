import fs from "node:fs";
import path from "node:path";

export function ensurePrivateDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(directory, 0o700); } catch { /* Windows and managed volumes may ignore POSIX modes. */ }
}

export function readJson<T>(filename: string, fallback: T): T {
  try {
    const parsed = JSON.parse(fs.readFileSync(filename, "utf8"));
    return parsed as T;
  } catch {
    return fallback;
  }
}

export function writeJsonAtomic(filename: string, value: unknown): void {
  ensurePrivateDirectory(path.dirname(filename));
  const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, filename);
  try { fs.chmodSync(filename, 0o600); } catch { /* See ensurePrivateDirectory. */ }
}

export class BoundedJsonLog<T> {
  constructor(private readonly filename: string, private readonly maximum: number) {}

  list(): T[] {
    const value = readJson<T[]>(this.filename, []);
    return Array.isArray(value) ? value.slice(0, this.maximum) : [];
  }

  prepend(entry: T): void {
    writeJsonAtomic(this.filename, [entry, ...this.list()].slice(0, this.maximum));
  }

  replace(entries: T[]): void {
    writeJsonAtomic(this.filename, entries.slice(0, this.maximum));
  }
}

