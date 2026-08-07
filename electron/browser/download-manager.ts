import crypto from "crypto";
import { shell, type Session, type WebContents } from "electron";
import type { BrowserDownloadState } from "./types";

interface DownloadRecord {
  state: BrowserDownloadState;
}

function validDownloadUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:" || protocol === "blob:";
  } catch {
    return false;
  }
}

export class DownloadManager {
  private readonly configured = new Set<Session>();
  private readonly downloads = new Map<string, DownloadRecord>();

  constructor(
    private readonly emit: (channel: string, payload: unknown) => void,
    private readonly isBrowserContents: (contents: WebContents) => boolean,
  ) {}

  attach(targetSession: Session): void {
    if (this.configured.has(targetSession)) return;
    this.configured.add(targetSession);

    targetSession.on("will-download", (event, item, contents) => {
      const url = item.getURL();
      if (!contents || !this.isBrowserContents(contents) || !validDownloadUrl(url)) {
        event.preventDefault();
        return;
      }

      const id = crypto.randomUUID();
      const state: BrowserDownloadState = {
        id,
        filename: item.getFilename(),
        url,
        savePath: item.getSavePath(),
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        state: "progressing",
        paused: false,
      };
      this.downloads.set(id, { state });

      const publish = () => {
        state.savePath = item.getSavePath();
        state.receivedBytes = item.getReceivedBytes();
        state.totalBytes = item.getTotalBytes();
        state.paused = item.isPaused();
        this.emit("rome:browser:download", { ...state });
      };

      item.on("updated", (_downloadEvent, updateState) => {
        state.state = updateState === "interrupted" ? "interrupted" : "progressing";
        publish();
      });
      item.once("done", (_downloadEvent, finalState) => {
        state.state = finalState;
        publish();
      });
      publish();
    });
  }

  list(): BrowserDownloadState[] {
    return Array.from(this.downloads.values(), ({ state }) => ({ ...state }));
  }

  async open(id: string): Promise<void> {
    const record = this.downloads.get(id);
    if (!record?.state.savePath || record.state.state !== "completed") return;
    const error = await shell.openPath(record.state.savePath);
    if (error) throw new Error(error);
  }

  showInFolder(id: string): void {
    const record = this.downloads.get(id);
    if (!record?.state.savePath) return;
    shell.showItemInFolder(record.state.savePath);
  }
}
