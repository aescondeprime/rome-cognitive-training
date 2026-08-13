import crypto from "node:crypto";
import path from "node:path";
import type { AkiraActivityEntry, AkiraRisk } from "../../shared/akira";
import { BoundedJsonLog, readJson, writeJsonAtomic } from "./json-store";

export interface UndoRecord {
  id: string;
  capability: string;
  profileId: number | null;
  payload: Record<string, unknown>;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
}

export class AkiraActivityStore {
  private readonly activity: BoundedJsonLog<AkiraActivityEntry>;
  private readonly undoFile: string;

  constructor(root: string) {
    this.activity = new BoundedJsonLog(path.join(root, "activity.json"), 500);
    this.undoFile = path.join(root, "undo.json");
  }

  list(retainDays = 30): AkiraActivityEntry[] {
    const cutoff = Date.now() - Math.max(1, retainDays) * 86_400_000;
    return this.activity.list().filter(entry => entry.createdAt >= cutoff);
  }

  record(input: Omit<AkiraActivityEntry, "id" | "createdAt" | "finishedAt">): AkiraActivityEntry {
    const now = Date.now();
    const entry: AkiraActivityEntry = { ...input, id: crypto.randomUUID(), createdAt: now, finishedAt: now };
    this.activity.prepend(entry);
    return entry;
  }

  addUndo(capability: string, profileId: number | null, payload: Record<string, unknown>, lifetimeMs = 86_400_000): UndoRecord {
    const now = Date.now();
    const record: UndoRecord = {
      id: crypto.randomUUID(), capability, profileId, payload,
      createdAt: now, expiresAt: now + lifetimeMs, usedAt: null,
    };
    const existing = readJson<UndoRecord[]>(this.undoFile, [])
      .filter(item => item.expiresAt > now && !item.usedAt)
      .slice(0, 99);
    writeJsonAtomic(this.undoFile, [record, ...existing]);
    return record;
  }

  getUndo(id: string): UndoRecord {
    const records = readJson<UndoRecord[]>(this.undoFile, []);
    const record = records.find(item => item.id === id);
    if (!record || record.usedAt || record.expiresAt <= Date.now()) throw new Error("Undo is no longer available.");
    return structuredClone(record);
  }

  markUndoUsed(id: string): void {
    const records = readJson<UndoRecord[]>(this.undoFile, []);
    const record = records.find(item => item.id === id);
    if (!record || record.usedAt || record.expiresAt <= Date.now()) throw new Error("Undo is no longer available.");
    record.usedAt = Date.now();
    writeJsonAtomic(this.undoFile, records);
    const activity = this.activity.list();
    this.activity.replace(activity.map(entry => entry.undoId === id ? { ...entry, status: "undone" as const } : entry));
  }

  static summary(capability: string, risk: AkiraRisk, ok: boolean): string {
    return `${ok ? "Completed" : "Failed"} ${risk} capability ${capability}`;
  }
}
