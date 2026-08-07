import crypto from "crypto";
import type { Session, WebContents } from "electron";
import type { BrowserPermissionRequest } from "./types";

interface PendingPermission {
  callback: (allowed: boolean) => void;
  timeout: NodeJS.Timeout;
}

const PROMPTABLE_PERMISSIONS = new Set([
  "media",
  "geolocation",
  "notifications",
  "clipboard-read",
  "clipboard-sanitized-write",
  "display-capture",
  "fullscreen",
  "pointerLock",
  "midi",
  "midiSysex",
  "idle-detection",
]);

export class PermissionManager {
  private readonly configured = new Set<Session>();
  private readonly pending = new Map<string, PendingPermission>();

  constructor(
    private readonly emit: (channel: string, payload: unknown) => void,
    private readonly resolveTabId: (contents: WebContents) => string | null,
  ) {}

  attach(targetSession: Session): void {
    if (this.configured.has(targetSession)) return;
    this.configured.add(targetSession);

    targetSession.setPermissionRequestHandler((contents, permission, callback, details) => {
      if (!PROMPTABLE_PERMISSIONS.has(permission)) {
        callback(false);
        return;
      }

      const requestingUrl = details.requestingUrl || contents.getURL();
      let origin = "unknown";
      try {
        const parsed = new URL(requestingUrl);
        if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
          callback(false);
          return;
        }
        origin = parsed.origin;
      } catch {
        callback(false);
        return;
      }

      const id = crypto.randomUUID();
      const timeout = setTimeout(() => this.respond(id, false), 30_000);
      this.pending.set(id, { callback, timeout });

      const mediaTypes = "mediaTypes" in details ? details.mediaTypes : [];
      const requestedPermission = permission === "media" && mediaTypes?.length
        ? mediaTypes.map((type) => type === "video" ? "camera" : type === "audio" ? "microphone" : type).join(" & ")
        : permission;

      const request: BrowserPermissionRequest = {
        id,
        tabId: this.resolveTabId(contents),
        origin,
        permission: requestedPermission,
      };
      this.emit("rome:browser:permission-request", request);
    });
  }

  respond(id: string, allowed: boolean): void {
    const request = this.pending.get(id);
    if (!request) return;
    clearTimeout(request.timeout);
    this.pending.delete(id);
    request.callback(Boolean(allowed));
  }

  dispose(): void {
    for (const [id] of this.pending) this.respond(id, false);
  }
}
