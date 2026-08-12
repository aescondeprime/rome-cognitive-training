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

type StoreName = "sources" | "notes" | "artifacts";
type AcademiaRecord = AcademiaSource | AcademiaNote | StudioArtifact;

const DB_NAME = "rome-academia";
const DB_VERSION = 1;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of ["sources", "notes", "artifacts"] as StoreName[]) {
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
    request.onsuccess = () => resolve((request.result as T[]).sort((a, b) => b.createdAt - a.createdAt));
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
  saveSource: (source: AcademiaSource) => putRecord("sources", source),
  saveNote: (note: AcademiaNote) => putRecord("notes", note),
  saveArtifact: (artifact: StudioArtifact) => putRecord("artifacts", artifact),
  deleteSource: (id: string) => deleteRecord("sources", id),
  deleteNote: (id: string) => deleteRecord("notes", id),
  deleteArtifact: (id: string) => deleteRecord("artifacts", id),
};
