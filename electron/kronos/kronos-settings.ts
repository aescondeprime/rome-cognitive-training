/**
 * Where the iCloud connection is remembered.
 *
 * Two files, and the split is the point:
 *
 *   calendar.json      the Apple ID, the chosen calendar, the poll interval —
 *                      configuration, readable, backed up, boring
 *   calendar.enc.json  the app-specific password, encrypted through Electron's
 *                      `safeStorage`, which on macOS means the Keychain
 *
 * A deliberately separate store from Akira's rather than a fifth member of
 * `AkiraSecretName`. Akira's vault is Akira's; a calendar password filed under
 * it would be a type whose name is a lie, and every future reader would have to
 * learn that the union means "any secret, actually". The encryption primitives
 * (`json-store`, `SecureCipher`) are shared — only the namespace is not.
 *
 * ── The password never leaves the main process ──────────────────────────────
 *
 * There is a `setPassword` and there is no `getPassword` over IPC. The renderer
 * can write one and can ask whether one is configured; it cannot read it back.
 * That is the same shape Akira uses for the ElevenLabs key and it is what keeps
 * a compromised renderer from being able to exfiltrate the credential.
 */

import path from "node:path";
import { ensurePrivateDirectory, readJson, writeJsonAtomic } from "../akira/json-store";
import type { SecureCipher } from "../akira/settings-store";

export interface KronosCalendarConfig {
  provider: "icloud";
  /** The Apple ID email. Not a secret — it is a username. */
  appleId: string;
  /** Path-only href of the linked calendar. Never an absolute URL. */
  calendarHref: string;
  calendarName: string;
  /** False until a calendar has been chosen and the engine may run. */
  enabled: boolean;
  pollMinutes: number;
}

/** What the renderer is allowed to know. Note the absence of the password. */
export interface KronosPublicConfig extends KronosCalendarConfig {
  passwordConfigured: boolean;
  secureStorageAvailable: boolean;
}

export const DEFAULT_KRONOS_CALENDAR: KronosCalendarConfig = {
  provider: "icloud",
  appleId: "",
  calendarHref: "",
  calendarName: "",
  enabled: false,
  pollMinutes: 5,
};

const PASSWORD_KEY = "icloudAppPassword";

/**
 * Environment overrides, matching the names the live check uses.
 *
 * Same precedence rule as Akira's `getSecret`: the environment wins. It is what
 * makes `ROME_ICLOUD_TEST=1 … npm run test:kronos` and the app agree about
 * which account they are talking to, and it is the escape hatch on a machine
 * where `safeStorage` is unavailable.
 */
const ENV_PASSWORD = "ROME_ICLOUD_PASS";
const ENV_APPLE_ID = "ROME_ICLOUD_USER";

export class KronosSettingsStore {
  private readonly configFile: string;
  private readonly secretFile: string;
  private config: KronosCalendarConfig;
  // Assigned explicitly rather than as a constructor parameter property: those
  // need code generation, and node's strip-only type stripping refuses them.
  private readonly cipher: SecureCipher;

  constructor(root: string, cipher: SecureCipher) {
    this.cipher = cipher;
    ensurePrivateDirectory(root);
    this.configFile = path.join(root, "calendar.json");
    this.secretFile = path.join(root, "calendar.enc.json");
    this.config = merge(readJson<Partial<KronosCalendarConfig>>(this.configFile, {}));
  }

  get(): KronosCalendarConfig {
    const stored = structuredClone(this.config);
    const fromEnvironment = process.env[ENV_APPLE_ID]?.trim();
    return fromEnvironment ? { ...stored, appleId: fromEnvironment } : stored;
  }

  publicConfig(): KronosPublicConfig {
    return {
      ...this.get(),
      passwordConfigured: Boolean(this.getPassword()),
      secureStorageAvailable: this.cipher.isAvailable(),
    };
  }

  update(patch: Partial<KronosCalendarConfig>): KronosCalendarConfig {
    this.config = merge({ ...this.config, ...patch });
    writeJsonAtomic(this.configFile, this.config);
    return this.get();
  }

  /**
   * Store, or clear with an empty string.
   *
   * Throws when `safeStorage` is unavailable rather than falling back to
   * plaintext. A credential written unencrypted because the Keychain was
   * momentarily unhappy is worse than a credential that failed to save loudly.
   */
  setPassword(value: string): void {
    if (!this.cipher.isAvailable()) {
      throw new Error(
        "Secure credential storage is unavailable on this system. " +
        `Set ${ENV_PASSWORD} in the environment instead.`,
      );
    }
    const values = readJson<Record<string, string>>(this.secretFile, {});
    const trimmed = value.trim();
    if (trimmed) values[PASSWORD_KEY] = this.cipher.encrypt(trimmed).toString("base64");
    else delete values[PASSWORD_KEY];
    writeJsonAtomic(this.secretFile, values);
  }

  /** Main-process only. Never reachable from the renderer — see the header. */
  getPassword(): string | null {
    const fromEnvironment = process.env[ENV_PASSWORD]?.trim();
    if (fromEnvironment) return fromEnvironment;
    if (!this.cipher.isAvailable()) return null;
    const encoded = readJson<Record<string, string>>(this.secretFile, {})[PASSWORD_KEY];
    if (!encoded) return null;
    try {
      return this.cipher.decrypt(Buffer.from(encoded, "base64"));
    } catch {
      // A vault written by another machine or another OS user. Unreadable is
      // the same as absent; the panel will ask for it again.
      return null;
    }
  }

  /** Forget the link entirely. The iCloud copies are not touched. */
  disconnect(): KronosCalendarConfig {
    try { this.setPassword(""); } catch { /* nothing to clear if storage is unavailable */ }
    return this.update({ ...DEFAULT_KRONOS_CALENDAR });
  }
}

function merge(patch: Partial<KronosCalendarConfig>): KronosCalendarConfig {
  const pollMinutes = Number(patch.pollMinutes);
  return {
    provider: "icloud",
    appleId: typeof patch.appleId === "string" ? patch.appleId.trim() : "",
    // Defensive rather than decorative: an absolute URL here bakes in the
    // partition host and every request built from it 404s the day it moves.
    calendarHref: typeof patch.calendarHref === "string" ? toPathOnly(patch.calendarHref) : "",
    calendarName: typeof patch.calendarName === "string" ? patch.calendarName.slice(0, 200) : "",
    enabled: Boolean(patch.enabled),
    pollMinutes: Number.isFinite(pollMinutes) ? Math.min(60, Math.max(1, Math.round(pollMinutes))) : 5,
  };
}

function toPathOnly(href: string): string {
  const raw = href.trim();
  if (!raw || raw.startsWith("/")) return raw;
  try {
    return new URL(raw).pathname;
  } catch {
    return raw;
  }
}
