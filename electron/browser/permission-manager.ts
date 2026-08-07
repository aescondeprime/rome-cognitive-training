import crypto from "crypto";
import type { Session, WebContents } from "electron";
import type { BrowserPermissionRequest } from "./types";

interface PendingPermission {
  callbacks: Array<(allowed: boolean) => void>;
  timeout: NodeJS.Timeout;
  tabId: string;
  origin: string;
  scopes: string[];
  coalesceKey: string;
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
  private readonly pendingByKey = new Map<string, string>();
  private readonly decisions = new Map<string, boolean>();

  constructor(
    private readonly emit: (channel: string, payload: unknown) => void,
    private readonly resolveTabId: (contents: WebContents) => string | null,
  ) {}

  attach(targetSession: Session): void {
    if (this.configured.has(targetSession)) return;
    this.configured.add(targetSession);

    targetSession.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
      if (!contents || !PROMPTABLE_PERMISSIONS.has(permission)) return false;
      const tabId = this.resolveTabId(contents);
      const origin = this.resolveOrigin(details.requestingUrl || details.securityOrigin || requestingOrigin || contents.getURL());
      if (!tabId || !origin) return false;

      const scope = permission === "media" && details.mediaType && details.mediaType !== "unknown"
        ? `media:${details.mediaType}`
        : permission;
      return this.getDecision(tabId, origin, scope) ?? false;
    });

    targetSession.setPermissionRequestHandler((contents, permission, callback, details) => {
      if (!PROMPTABLE_PERMISSIONS.has(permission)) {
        callback(false);
        return;
      }

      const requestingUrl = details.requestingUrl || contents.getURL();
      const origin = this.resolveOrigin(requestingUrl);
      const tabId = this.resolveTabId(contents);
      if (!origin || !tabId) {
        callback(false);
        return;
      }

      const mediaTypes = "mediaTypes" in details ? details.mediaTypes : [];
      const scopes = permission === "media" && mediaTypes?.length
        ? [...new Set(mediaTypes.map((type) => `media:${type}`))].sort()
        : [permission];
      const knownDecisions = scopes.map((scope) => this.getDecision(tabId, origin, scope));
      if (knownDecisions.some((decision) => decision === false)) {
        callback(false);
        return;
      }
      if (knownDecisions.every((decision) => decision !== undefined)) {
        callback(true);
        return;
      }

      const coalesceKey = `${tabId}\u0000${origin}\u0000${scopes.join(",")}`;
      const existingId = this.pendingByKey.get(coalesceKey);
      if (existingId) {
        const existing = this.pending.get(existingId);
        if (existing) {
          existing.callbacks.push(callback);
          return;
        }
        this.pendingByKey.delete(coalesceKey);
      }

      const id = crypto.randomUUID();
      const timeout = setTimeout(() => this.finish(id, false, false), 30_000);
      this.pending.set(id, { callbacks: [callback], timeout, tabId, origin, scopes, coalesceKey });
      this.pendingByKey.set(coalesceKey, id);

      const requestedPermission = permission === "media" && mediaTypes?.length
        ? mediaTypes.map((type) => type === "video" ? "camera" : type === "audio" ? "microphone" : type).join(" & ")
        : permission;

      const request: BrowserPermissionRequest = {
        id,
        tabId,
        origin,
        permission: requestedPermission,
      };
      this.emit("rome:browser:permission-request", request);
    });
  }

  respond(id: string, allowed: boolean): void {
    this.finish(id, Boolean(allowed), true);
  }

  clearForTab(tabId: string, keepOrigin?: string): void {
    for (const key of this.decisions.keys()) {
      const [decisionTabId, decisionOrigin] = key.split("\u0000", 2);
      if (decisionTabId === tabId && (!keepOrigin || decisionOrigin !== keepOrigin)) {
        this.decisions.delete(key);
      }
    }

    for (const [id, request] of this.pending) {
      if (request.tabId === tabId && (!keepOrigin || request.origin !== keepOrigin)) {
        this.finish(id, false, false);
      }
    }
  }

  private finish(id: string, allowed: boolean, remember: boolean): void {
    const request = this.pending.get(id);
    if (!request) return;
    clearTimeout(request.timeout);
    this.pending.delete(id);
    this.pendingByKey.delete(request.coalesceKey);
    if (remember) {
      for (const scope of request.scopes) {
        this.decisions.set(this.decisionKey(request.tabId, request.origin, scope), allowed);
      }
    }
    for (const callback of request.callbacks) callback(allowed);
  }

  private getDecision(tabId: string, origin: string, scope: string): boolean | undefined {
    const exact = this.decisions.get(this.decisionKey(tabId, origin, scope));
    if (exact !== undefined || !scope.startsWith("media:")) return exact;
    return this.decisions.get(this.decisionKey(tabId, origin, "media"));
  }

  private decisionKey(tabId: string, origin: string, scope: string): string {
    return `${tabId}\u0000${origin}\u0000${scope}`;
  }

  private resolveOrigin(value: string): string | null {
    try {
      const parsed = new URL(value);
      const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
      if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocal)) return null;
      return parsed.origin;
    } catch {
      return null;
    }
  }

  dispose(): void {
    for (const [id] of this.pending) this.finish(id, false, false);
    this.decisions.clear();
  }
}
