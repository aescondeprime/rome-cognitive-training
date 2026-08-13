import crypto from "node:crypto";
import type { BrowserWindow } from "electron";
import { AKIRA_CHANNELS, type AkiraRendererCommand, type AkiraRendererCommandResult } from "../../shared/akira";

interface PendingCommand {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class AkiraRendererBridge {
  private readonly pending = new Map<string, PendingCommand>();

  constructor(private readonly getWindow: () => BrowserWindow | null) {}

  command(action: string, args: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<unknown> {
    const window = this.getWindow();
    if (!window || window.isDestroyed()) return Promise.reject(new Error("ROME renderer is unavailable."));
    const command: AkiraRendererCommand = { id: crypto.randomUUID(), action, args, createdAt: Date.now() };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(command.id);
        reject(new Error(`Renderer command timed out: ${action}`));
      }, timeoutMs);
      this.pending.set(command.id, { resolve, reject, timer });
      window.webContents.send(AKIRA_CHANNELS.rendererCommand, command);
    });
  }

  resolve(result: AkiraRendererCommandResult): void {
    const pending = this.pending.get(result.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(result.id);
    if (result.ok) pending.resolve(result.value);
    else pending.reject(new Error(result.error || "Renderer command failed."));
  }

  dispose(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Akira renderer bridge stopped."));
    }
    this.pending.clear();
  }
}

