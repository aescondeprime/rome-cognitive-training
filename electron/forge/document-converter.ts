/**
 * Office documents into PDF, using the LibreOffice already on the machine.
 *
 * The Analysis State renders PDFs and nothing else, because a capture is a crop
 * of the canvas a page was drawn into: an approximate HTML rendering of a .docx
 * would produce annotations of something that is not quite the document, and
 * .pptx has no browser renderer worth the name. Converting once, at import,
 * makes every later step exact.
 *
 * LibreOffice is an external dependency and is treated the way Ollama is: named
 * plainly when it is missing, never worked around with something worse. It runs
 * here rather than in the renderer because it is a subprocess; a browser-only
 * `npm run dev` therefore reports the same "unavailable" as a machine without
 * it, and PDFs keep working in both.
 *
 * Each conversion gets its own directory under the OS temp dir and deletes it
 * afterwards, because `soffice` writes its output beside the input by name and
 * two conversions of "notes.pptx" would otherwise race.
 */

import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

/** Where LibreOffice usually is, in the order worth trying. */
const CANDIDATES = [
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  "/opt/homebrew/bin/soffice",
  "/usr/local/bin/soffice",
  "/usr/bin/soffice",
  "/usr/bin/libreoffice",
  "/snap/bin/libreoffice",
  "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
  "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
];

/** A conversion of a large deck is minutes at worst; a hang is not. */
const TIMEOUT_MS = 120_000;

/**
 * The last converter found, cached — but only when one *was* found.
 *
 * Caching a negative result would mean that installing LibreOffice while ROME
 * is open does nothing until the app restarts, which is exactly the moment
 * someone is most likely to try again. A hit is worth caching (the path does
 * not move); a miss costs four `existsSync` calls to re-check.
 */
let cached: string | null = null;

function findConverter(): string | null {
  if (cached && fs.existsSync(cached)) return cached;
  cached = CANDIDATES.find(candidate => {
    try { return fs.existsSync(candidate); } catch { return false; }
  }) ?? null;
  return cached;
}

export interface ConverterStatus {
  available: boolean;
  path: string | null;
}

export function converterStatus(): ConverterStatus {
  const found = findConverter();
  return { available: !!found, path: found };
}

export type ConvertResult =
  | { ok: true; pdf: Uint8Array }
  | { ok: false; reason: "no-converter" | "failed"; message?: string };

/**
 * Convert one document.
 *
 * The name matters: LibreOffice picks its filter from the extension, so the
 * temporary file keeps the original one. Everything else about the name is
 * discarded — a path from the renderer is never trusted as a path.
 */
export async function convertToPdf(name: string, bytes: Uint8Array): Promise<ConvertResult> {
  const converter = findConverter();
  if (!converter) return { ok: false, reason: "no-converter" };

  const extension = path.extname(name).toLowerCase().replace(/[^.a-z0-9]/g, "") || ".docx";
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "rome-forge-"));
  const input = path.join(workDir, `document${extension}`);
  const output = path.join(workDir, "document.pdf");

  try {
    fs.writeFileSync(input, bytes);
    // A dedicated user profile keeps this from colliding with a LibreOffice the
    // user has open: a second instance sharing the default profile refuses to
    // start and reports success having written nothing.
    const profileDir = path.join(workDir, "profile");
    const code = await run(converter, [
      "--headless", "--norestore",
      `-env:UserInstallation=file://${profileDir}`,
      "--convert-to", "pdf:writer_pdf_Export",
      "--outdir", workDir, input,
    ]);

    if (!fs.existsSync(output)) {
      return { ok: false, reason: "failed", message: `LibreOffice exited with code ${code} and produced no PDF.` };
    }
    return { ok: true, pdf: new Uint8Array(fs.readFileSync(output)) };
  } catch (error) {
    return { ok: false, reason: "failed", message: error instanceof Error ? error.message : "Conversion failed." };
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* temp dir */ }
  }
}

function run(command: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore" });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("LibreOffice did not finish in time."));
    }, TIMEOUT_MS);
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => { clearTimeout(timer); resolve(code ?? -1); });
  });
}
