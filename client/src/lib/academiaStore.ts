/**
 * Everything the Knowledge Forge keeps, in the browser.
 *
 * Sources are documents you read and annotate; notes are what you write from
 * them. Nothing here is sent to a server: the Forge is a renderer-side feature
 * and IndexedDB is the whole of its persistence.
 *
 * **The model no longer reads sources.** Digests, Studio artifacts and recall
 * archives were the three stores that existed only for that, and they are gone
 * along with it — a source is now a document to look at, not a corpus to
 * summarise. What survives is the note, because Recall State drills the note,
 * and a note is short enough to hand to a model verbatim.
 */

export type AcademiaSourceKind = "pdf" | "text";

/** What the file was before it reached the Forge, which the viewer explains. */
export type SourceFormat = "pdf" | "docx" | "pptx" | "text";

export interface AcademiaSource {
  id: string;
  profileId: number;
  name: string;
  kind: AcademiaSourceKind;
  mimeType: string;
  size: number;
  text: string;
  /**
   * The bytes the viewer renders. For an office document this is the PDF it
   * was converted to, not the original — the Analysis State has one rendering
   * path and captures have to be exact, so conversion happens once at import
   * rather than in front of the viewer.
   */
  file?: Blob;
  format?: SourceFormat;
  createdAt: number;
}

export interface AcademiaNote {
  id: string;
  profileId: number;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Coverage of one corpus, one row per chunk.
 *
 * Sessions are disposable and this is not: what you want to resume is not the
 * sitting you were in the middle of but how much of the material you have
 * actually covered. Keyed by the chunk's content hash, so editing a note keeps
 * the history of every passage that did not change.
 *
 * Tallies are split by question type because pooling them hides the finding
 * that matters most — recognising a passage in a multiple choice while being
 * unable to produce it from a blank is the difference between "seen" and
 * "known", and a single accuracy number cannot show it.
 */
export type RecallQuestionType = "choice" | "blank" | "open";

export interface LedgerTally { asked: number; correct: number }

export interface LedgerEntry {
  hash: string;
  index: number;
  presentations: number;
  lastSeenAt: number;
  tallies: Record<RecallQuestionType, LedgerTally>;
  /** Rounds where nothing about this passage was missed. Mastery, not coverage. */
  cleanRounds: number;
}

export interface SourceLedger {
  /** The corpus id — `note:<id>` for a note, which is now the only corpus. */
  id: string;
  profileId: number;
  chunkingVersion: number;
  targetChars: number;
  entries: Record<string, LedgerEntry>;
  updatedAt: number;
}

/**
 * Questions already written for a corpus's passages.
 *
 * The important property: **questions belong to the passage, not to the round
 * order.** That is what makes banking them safe where banking whole scheduled
 * rounds was not — a stored question is as valid on the twentieth sitting as on
 * the first, whatever the scheduler decides to show next, and nothing about it
 * goes stale when the ledger moves.
 *
 * Written by a background job so that studying costs no model time at all,
 * which is the only way a large model and a responsive app can coexist on one
 * machine.
 *
 * `questions` is typed loosely here to keep the store free of a dependency on
 * the round machine; `recallBank` owns the shape.
 */
export interface QuestionBank {
  /** The corpus id, as with ledgers. */
  id: string;
  profileId: number;
  model: string;
  chunkingVersion: number;
  targetChars: number;
  /** Passage content hash to the questions written for it. */
  pools: Record<string, unknown[]>;
  /** Passages the corpus has, so a partial bank can report how far it got. */
  chunkCount: number;
  complete: boolean;
  updatedAt: number;
}

type StoreName = "sources" | "notes" | "ledgers" | "banks";
type AcademiaRecord = AcademiaSource | AcademiaNote | SourceLedger | QuestionBank;

const LIVE_STORES: StoreName[] = ["sources", "notes", "ledgers", "banks"];

/**
 * Stores from the generation era, deleted on upgrade.
 *
 * Left behind they would be invisible and permanent: a forty-page PDF's digest
 * is megabytes, and nothing would ever read it again. Dropping them is the one
 * destructive thing this file does, and it is safe because every one of them
 * was derived from a source that is still there.
 */
const RETIRED_STORES = ["artifacts", "digests", "archives"];

const DB_NAME = "rome-academia";
// 2 added `digests`, 3 `ledgers`, 4 `banks`, 5 `archives`. 6 removes the three
// stores that belonged to source analysis.
const DB_VERSION = 6;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of LIVE_STORES) {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: "id" });
          store.createIndex("profileId", "profileId", { unique: false });
        }
      }
      for (const name of RETIRED_STORES) {
        if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open Academia storage"));
  });
}

async function listByProfile<T extends AcademiaRecord>(storeName: StoreName, profileId: number): Promise<T[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).index("profileId").getAll(profileId);
    // Ledgers carry no `createdAt`; sorting falls back to 0 for them, which is
    // fine because nothing reads them in order — they are looked up by id.
    request.onsuccess = () => resolve((request.result as T[]).sort(
      (a, b) => ((b as { createdAt?: number }).createdAt ?? 0) - ((a as { createdAt?: number }).createdAt ?? 0),
    ));
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

async function putRecord(storeName: StoreName, value: AcademiaRecord): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function deleteRecord(storeName: StoreName, id: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export const academiaStore = {
  sources: (profileId: number) => listByProfile<AcademiaSource>("sources", profileId),
  notes: (profileId: number) => listByProfile<AcademiaNote>("notes", profileId),
  ledgers: (profileId: number) => listByProfile<SourceLedger>("ledgers", profileId),
  banks: (profileId: number) => listByProfile<QuestionBank>("banks", profileId),
  saveSource: (source: AcademiaSource) => putRecord("sources", source),
  saveNote: (note: AcademiaNote) => putRecord("notes", note),
  saveLedger: (ledger: SourceLedger) => putRecord("ledgers", ledger),
  saveBank: (bank: QuestionBank) => putRecord("banks", bank),
  deleteSource: (id: string) => deleteRecord("sources", id),
  deleteNote: (id: string) => deleteRecord("notes", id),
  deleteLedger: (id: string) => deleteRecord("ledgers", id),
  deleteBank: (id: string) => deleteRecord("banks", id),
};
