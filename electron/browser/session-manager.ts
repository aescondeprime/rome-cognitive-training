import { session, type Session } from "electron";
import type { BrowserSessionKind } from "./types";

const DEFAULT_PARTITION = "persist:rome-browser-default";

function sanitizeProfileName(name: string): string {
  const clean = name.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 48);
  if (!clean) throw new Error("Invalid browser profile name");
  return clean;
}

export class SessionManager {
  private readonly incognitoPartition = `rome-browser-incognito-${Date.now()}`;
  private readonly hardened = new Set<Session>();

  get(kind: BrowserSessionKind): Session {
    let target: Session;
    if (kind === "default") {
      target = session.fromPartition(DEFAULT_PARTITION, { cache: true });
    } else if (kind === "incognito") {
      // A partition without the persist: prefix lives only for this app process.
      target = session.fromPartition(this.incognitoPartition, { cache: true });
    } else {
      const profile = sanitizeProfileName(kind.slice("profile:".length));
      target = session.fromPartition(`persist:rome-browser-${profile}`, { cache: true });
    }

    this.harden(target);
    return target;
  }

  private harden(target: Session): void {
    if (this.hardened.has(target)) return;
    this.hardened.add(target);

    // Remote pages never need the privileged ROME Express API. Keeping the
    // browser partition away from it adds a network boundary in addition to
    // renderer sandboxing and same-origin protections.
    target.webRequest.onBeforeRequest(
      { urls: ["http://127.0.0.1:5000/*", "http://localhost:5000/*"] },
      (_details, callback) => callback({ cancel: true }),
    );
  }
}
