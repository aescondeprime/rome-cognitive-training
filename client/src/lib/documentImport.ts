/**
 * Getting a document into the Forge.
 *
 * One rule decides the shape of this file: **the Analysis State renders PDFs
 * and nothing else.** A capture is a crop of the canvas a page was drawn into,
 * so an approximate HTML rendering of a .docx would produce annotations of
 * something that is not quite the document — and .pptx has no browser renderer
 * worth the name at all.
 *
 * So office documents are converted to PDF once, at import, by the LibreOffice
 * already on the machine. That is an external dependency, and it is the same
 * bargain the local model is: ROME says plainly what to install and works
 * without it, rather than shipping a worse renderer and calling it support.
 * Conversion runs in the Electron main process because it is a subprocess;
 * `npm run dev` in a browser has no main process, so it reports the same
 * "unavailable" as a machine with no LibreOffice.
 *
 * Text is extracted here too, for every format, because Recall State drills a
 * note and a note is often written by hand from a source you have open.
 */

import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { AcademiaSource, SourceFormat } from "@/lib/academiaStore";

const OFFICE: Record<string, SourceFormat> = {
  doc: "docx", docx: "docx", odt: "docx", rtf: "docx",
  ppt: "pptx", pptx: "pptx", odp: "pptx",
};

export const ACCEPTED_EXTENSIONS = ".pdf,.txt,.md,.doc,.docx,.odt,.rtf,.ppt,.pptx,.odp";

/**
 * Why a file did not become a source.
 *
 * The discriminant is `problem` rather than `kind`, and that is not cosmetic:
 * `AcademiaSource` has its own `kind` ("pdf" | "text"), so a guard testing for
 * `kind` said yes to every *successful* import. Every file then took the
 * failure path and reported "<name>: undefined" — the union looked
 * discriminated and shared a key with the type it was being told apart from.
 */
export type ImportFailure =
  /** An office document arrived and there is no converter to put it through. */
  | { problem: "no-converter"; name: string }
  | { problem: "unsupported"; name: string }
  | { problem: "failed"; name: string; message: string };

export interface ImportResult {
  sources: AcademiaSource[];
  failures: ImportFailure[];
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** Whether this build can turn office documents into something viewable. */
export async function converterAvailable(): Promise<boolean> {
  const bridge = window.romeDesktop?.forge;
  if (!bridge) return false;
  try {
    const status = await bridge.converterStatus();
    return status.available;
  } catch {
    return false;
  }
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  // pdf.js takes ownership of the buffer it is handed, and the same bytes are
  // also stored as the source's blob, so it gets a copy rather than the array.
  const document = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const pages: string[] = [];
  for (let page = 1; page <= document.numPages; page++) {
    const content = await (await document.getPage(page)).getTextContent();
    pages.push(content.items.map(item => ("str" in item ? item.str : "")).join(" "));
  }
  void document.destroy();
  return pages.join("\n\n");
}

/**
 * Import one file.
 *
 * Returns the source to save, or the reason it could not be made — never a
 * half-usable source. A document the viewer cannot open would be worse than a
 * refusal, because the failure would only show up when you tried to annotate.
 */
export async function importDocument(file: File, profileId: number): Promise<AcademiaSource | ImportFailure> {
  const extension = extensionOf(file.name);
  const isPdf = file.type === "application/pdf" || extension === "pdf";
  const office = OFFICE[extension];
  const isText = file.type.startsWith("text/") || extension === "txt" || extension === "md";
  const now = Date.now();

  try {
    if (isPdf) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return {
        id: crypto.randomUUID(), profileId, name: file.name, kind: "pdf",
        mimeType: "application/pdf", size: file.size,
        text: await extractPdfText(bytes), file: new Blob([bytes], { type: "application/pdf" }),
        format: "pdf", createdAt: now,
      };
    }

    if (office) {
      const bridge = window.romeDesktop?.forge;
      if (!bridge) return { problem: "no-converter", name: file.name };
      const result = await bridge.convertToPdf(file.name, new Uint8Array(await file.arrayBuffer()));
      if (!result.ok) {
        return result.reason === "no-converter"
          ? { problem: "no-converter", name: file.name }
          : { problem: "failed", name: file.name, message: result.message ?? "The document could not be converted." };
      }
      const bytes = new Uint8Array(result.pdf);
      return {
        id: crypto.randomUUID(), profileId, name: file.name, kind: "pdf",
        mimeType: "application/pdf", size: file.size,
        text: await extractPdfText(bytes), file: new Blob([bytes], { type: "application/pdf" }),
        format: office, createdAt: now,
      };
    }

    if (isText) {
      return {
        id: crypto.randomUUID(), profileId, name: file.name, kind: "text",
        mimeType: file.type || "text/plain", size: file.size,
        text: await file.text(), format: "text", createdAt: now,
      };
    }

    return { problem: "unsupported", name: file.name };
  } catch (error) {
    return { problem: "failed", name: file.name, message: error instanceof Error ? error.message : "Import failed." };
  }
}

export function isFailure(value: AcademiaSource | ImportFailure): value is ImportFailure {
  return "problem" in value;
}

export function describeFailure(failure: ImportFailure): string {
  if (failure.problem === "no-converter") {
    return `${failure.name} needs LibreOffice to become viewable. Install it, or open the file yourself and add it as a PDF.`;
  }
  if (failure.problem === "unsupported") return `${failure.name} is not a document the Forge can show.`;
  return `${failure.name}: ${failure.message}`;
}
