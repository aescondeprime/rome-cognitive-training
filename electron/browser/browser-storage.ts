import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { BrowserBookmark, BrowserHistoryEntry } from "./types";

interface BrowserStoreFile {
  history: BrowserHistoryEntry[];
  bookmarks: BrowserBookmark[];
}

export class BrowserStorage {
  private readonly filePath: string;
  private data: BrowserStoreFile;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "browser-data.json");
    this.data = this.read();
  }

  private read(): BrowserStoreFile {
    try {
      if (!fs.existsSync(this.filePath)) return { history: [], bookmarks: [] };
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      return {
        history: Array.isArray(parsed.history) ? parsed.history : [],
        bookmarks: Array.isArray(parsed.bookmarks) ? parsed.bookmarks : [],
      };
    } catch (error) {
      console.error("[ROME Browser] Could not read browser data:", error);
      return { history: [], bookmarks: [] };
    }
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tempPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.data, null, 2), { mode: 0o600 });
      fs.renameSync(tempPath, this.filePath);
    } catch (error) {
      console.error("[ROME Browser] Could not persist browser data:", error);
    }
  }

  recordHistory(url: string, title: string): void {
    if (!isWebUrl(url)) return;
    const previous = this.data.history[0];
    if (previous?.url === url && Date.now() - previous.visitedAt < 5_000) {
      previous.title = title || previous.title;
      previous.visitedAt = Date.now();
    } else {
      this.data.history.unshift({
        id: crypto.randomUUID(),
        title: title || url,
        url,
        visitedAt: Date.now(),
      });
    }
    this.data.history = this.data.history.slice(0, 1000);
    this.persist();
  }

  getHistory(): BrowserHistoryEntry[] {
    return this.data.history.map((entry) => ({ ...entry }));
  }

  clearHistory(): void {
    this.data.history = [];
    this.persist();
  }

  getBookmarks(): BrowserBookmark[] {
    return this.data.bookmarks.map((entry) => ({ ...entry }));
  }

  toggleBookmark(url: string, title: string): { bookmarked: boolean; bookmarks: BrowserBookmark[] } {
    if (!isWebUrl(url)) throw new Error("Only HTTP(S) pages can be bookmarked");
    const existing = this.data.bookmarks.findIndex((entry) => entry.url === url);
    let bookmarked = false;
    if (existing >= 0) {
      this.data.bookmarks.splice(existing, 1);
    } else {
      this.data.bookmarks.unshift({
        id: crypto.randomUUID(),
        title: title || url,
        url,
        createdAt: Date.now(),
      });
      bookmarked = true;
    }
    this.persist();
    return { bookmarked, bookmarks: this.getBookmarks() };
  }
}

export function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
