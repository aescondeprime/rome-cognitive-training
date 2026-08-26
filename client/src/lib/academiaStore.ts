export type AcademiaSourceKind = "pdf" | "text";
export type StudioKind = "audio" | "slides" | "video" | "mindmap" | "report" | "flashcards" | "quiz" | "infographic" | "table";

export interface AcademiaSource {
  id: string;
  profileId: number;
  name: string;
  kind: AcademiaSourceKind;
  mimeType: string;
  size: number;
  text: string;
  file?: Blob;
  createdAt: number;
}

export interface AcademiaNote {
  id: string;
  profileId: number;
  title: string;
  content: string;
  /** Set on a note built from a comparison, so its provenance survives. */
  derivedFrom?: { archiveId: string; sourceIds: string[] };
  createdAt: number;
  updatedAt: number;
}

/**
 * What you could recall, and what the comparison made of it.
 *
 * Written after a run, from memory, with the sources out of sight. Kept because
 * the comparison is the expensive part and because leaving mid-write should
 * cost nothing — the same reasoning as everywhere else here.
 */
export type ClaimVerdict = "covered" | "partial" | "missed";

export interface ClaimAlignment {
  /** The claim, as the source's own digest stated it. */
  claim: string;
  sourceId: string;
  /** Passage this claim came from, so a miss can point at the text. */
  chunkIndex: number;
  chunkHash: string;
  verdict: ClaimVerdict;
  note?: string;
  /** Whether you kept this as a gap worth writing up. Model proposes, you confirm. */
  confirmed?: boolean;
}

export interface RecallArchive {
  id: string;
  profileId: number;
  /** Sources or `note:<id>` the run drew from. */
  corpusIds: string[];
  label: string;
  text: string;
  alignments: ClaimAlignment[];
  /** False while a comparison is unfinished, so it can be resumed. */
  compared: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * One passage of a source, as the model understood it.
 *
 * The expensive half of generation is reading, and it used to be paid again for
 * every artifact — the same forty pages digested from scratch to make a quiz,
 * then again to make a slide deck. A source is read once into this record and
 * every later composition is a single fast call over it.
 *
 * `hash` is the chunk's content hash, so a re-read after an edit can keep the
 * passages whose text did not change.
 */
export interface DigestPassage {
  index: number;
  hash: string;
  summary: string;
  points: string[];
  terms: string[];
}

export interface SourceDigest {
  /** The source's own id — one digest per source. */
  id: string;
  profileId: number;
  /** Which model produced it. A different model makes the digest stale, not wrong. */
  model: string;
  chunkingVersion: number;
  targetChars: number;
  passages: DigestPassage[];
  /** Chunks in the source, so a partial read can report how far it got. */
  chunkCount: number;
  /** False while a read is unfinished, so it can be resumed rather than restarted. */
  complete: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface StudioArtifact {
  id: string;
  profileId: number;
  kind: StudioKind;
  title: string;
  content: string;
  sourceIds: string[];
  createdAt: number;
}

/**
 * Coverage of one source, one row per chunk.
 *
 * Sessions are disposable and this is not: what you want to resume is not the
 * sitting you were in the middle of but how much of the document you have
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
  /** The source's own id — one ledger per source, as with digests. */
  id: string;
  profileId: number;
  chunkingVersion: number;
  targetChars: number;
  entries: Record<string, LedgerEntry>;
  updatedAt: number;
}

/**
 * Questions already written for a source's passages.
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
  /** The source's own id, as with digests and ledgers. */
  id: string;
  profileId: number;
  model: string;
  chunkingVersion: number;
  targetChars: number;
  /** Passage content hash to the questions written for it. */
  pools: Record<string, unknown[]>;
  /** Passages the source has, so a partial bank can report how far it got. */
  chunkCount: number;
  complete: boolean;
  updatedAt: number;
}

type StoreName = "sources" | "notes" | "artifacts" | "digests" | "ledgers" | "banks" | "archives";
type AcademiaRecord = AcademiaSource | AcademiaNote | StudioArtifact | SourceDigest | SourceLedger | QuestionBank | RecallArchive;

const DB_NAME = "rome-academia";
// 2 added `digests`, 3 `ledgers`, 4 `banks`, 5 `archives`. The upgrade loop
// below creates whatever is missing, so an existing library gains the store
// without touching sources, notes, artifacts or anything already read.
const DB_VERSION = 5;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of ["sources", "notes", "artifacts", "digests", "ledgers", "banks", "archives"] as StoreName[]) {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: "id" });
          store.createIndex("profileId", "profileId", { unique: false });
        }
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
  artifacts: (profileId: number) => listByProfile<StudioArtifact>("artifacts", profileId),
  digests: (profileId: number) => listByProfile<SourceDigest>("digests", profileId),
  ledgers: (profileId: number) => listByProfile<SourceLedger>("ledgers", profileId),
  banks: (profileId: number) => listByProfile<QuestionBank>("banks", profileId),
  archives: (profileId: number) => listByProfile<RecallArchive>("archives", profileId),
  saveSource: (source: AcademiaSource) => putRecord("sources", source),
  saveNote: (note: AcademiaNote) => putRecord("notes", note),
  saveArtifact: (artifact: StudioArtifact) => putRecord("artifacts", artifact),
  saveDigest: (digest: SourceDigest) => putRecord("digests", digest),
  saveLedger: (ledger: SourceLedger) => putRecord("ledgers", ledger),
  saveBank: (bank: QuestionBank) => putRecord("banks", bank),
  saveArchive: (archive: RecallArchive) => putRecord("archives", archive),
  deleteSource: (id: string) => deleteRecord("sources", id),
  deleteNote: (id: string) => deleteRecord("notes", id),
  deleteArtifact: (id: string) => deleteRecord("artifacts", id),
  deleteDigest: (id: string) => deleteRecord("digests", id),
  deleteLedger: (id: string) => deleteRecord("ledgers", id),
  deleteBank: (id: string) => deleteRecord("banks", id),
  deleteArchive: (id: string) => deleteRecord("archives", id),
};
