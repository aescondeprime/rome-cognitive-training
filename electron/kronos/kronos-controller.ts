/**
 * The main-process owner of the iCloud connection.
 *
 * At this phase it does exactly two things: remember the connection, and prove
 * it works. The sync engine is a later phase and will hang off this controller
 * — which is why `verify` and `listCalendars` live here rather than in the IPC
 * layer, where they would have to be rebuilt when the engine arrives.
 *
 * **Everything here is read-only against iCloud except `createCalendar`**, and
 * that one only ever makes an empty calendar. No ROME data is written to Apple
 * anywhere in this file. Pushing events is phase 4c and belongs behind the
 * dry-run confirmation.
 */

import { safeStorage, shell, type BrowserWindow } from "electron";
import { DavError, IcloudDav } from "./icloud-dav";
import { KronosSettingsStore, type KronosPublicConfig } from "./kronos-settings";
import { KronosSyncEngine, type CycleReport, type SyncStatus } from "./sync-engine";
import { describePlan } from "./sync-plan";
import type { DavCalendar } from "./dav-xml";

/** Where an app-specific password is generated. Hardcoded; never from the UI. */
export const APPLE_ID_URL = "https://appleid.apple.com/account/manage";

export interface VerifiedAccount {
  ok: true;
  /** The partition host in use. Diagnostics only — never stored. */
  origin: string;
  principalPath: string;
  homePath: string;
  calendars: DavCalendar[];
}

export interface VerifyFailure {
  ok: false;
  kind: string;
  /** Already translated for a person. See `DavError.userMessage`. */
  message: string;
}

export type VerifyResult = VerifiedAccount | VerifyFailure;

export interface KronosControllerOptions {
  /** Directory for `calendar.json` and `calendar.enc.json`. */
  root: string;
  getWindow: () => BrowserWindow | null;
  /** Loopback base for the Express server. */
  serverBase: string;
}

export class KronosController {
  private readonly store: KronosSettingsStore;
  private readonly options: KronosControllerOptions;
  private readonly engine: KronosSyncEngine;

  constructor(options: KronosControllerOptions) {
    this.options = options;
    this.store = new KronosSettingsStore(options.root, {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: value => safeStorage.encryptString(value),
      decrypt: value => safeStorage.decryptString(value),
    });
    this.engine = new KronosSyncEngine({
      serverBase: options.serverBase,
      getCalendarPath: () => (this.store.get().enabled ? this.store.get().calendarHref : ""),
      // Built per cycle rather than held: the account can be changed or
      // disconnected between syncs, and a cached client would keep using the
      // credentials of an account the user has already replaced.
      getClient: () => this.client(),
      onStatus: status => this.publishStatus(status),
    });
  }

  /** An authenticated client, or null when the link is not usable. */
  private client(): IcloudDav | null {
    const config = this.store.get();
    const password = this.store.getPassword();
    if (!config.appleId || !password) return null;
    return new IcloudDav({ credentials: { username: config.appleId, password } });
  }

  private publishStatus(status: SyncStatus): void {
    const window = this.options.getWindow();
    if (window && !window.isDestroyed()) {
      window.webContents.send("rome:kronos:sync-status", status);
    }
  }

  syncStatus(): SyncStatus {
    return this.engine.status();
  }

  /**
   * Run a push cycle, or work out what one would do.
   *
   * `dryRun` is not a courtesy. The first write goes into somebody's real
   * calendar, visible on every device they own, and a wrong calendar or a
   * misread plan is not undone by a button — it is undone by deleting events
   * one at a time on a phone. So the panel asks first, and what it shows is
   * this exact plan rather than an estimate of it.
   */
  async syncNow(dryRun: boolean): Promise<CycleReport & { summary: string }> {
    const report = await this.engine.runCycle({ dryRun });
    return { ...report, summary: describePlan(report.plan) };
  }

  /** Same guard as Akira: only the window we own may drive this. */
  owns(senderId: number): boolean {
    const window = this.options.getWindow();
    return Boolean(window && !window.isDestroyed() && window.webContents.id === senderId);
  }

  config(): KronosPublicConfig {
    return this.store.publicConfig();
  }

  updateConfig(patch: Partial<KronosPublicConfig>): KronosPublicConfig {
    // `passwordConfigured` and `secureStorageAvailable` are derived, and a
    // renderer echoing the whole object back must not be able to set them.
    const { passwordConfigured, secureStorageAvailable, ...writable } = patch as KronosPublicConfig;
    this.store.update(writable);
    return this.config();
  }

  setPassword(value: string): KronosPublicConfig {
    if (value.length > 512) throw new Error("That does not look like an app-specific password.");
    this.store.setPassword(value);
    return this.config();
  }

  disconnect(): KronosPublicConfig {
    this.store.disconnect();
    return this.config();
  }

  openAppleIdPage(): void {
    void shell.openExternal(APPLE_ID_URL);
  }

  /**
   * Log in and list the calendars that can hold events.
   *
   * Never throws across the IPC boundary. A `DavError` becomes a `VerifyResult`
   * with a sentence a person can act on — "Apple rejected the app-specific
   * password" is the whole point of the exercise, and an exception serialised
   * through IPC arrives as an opaque string with the useful part missing.
   */
  async verify(): Promise<VerifyResult> {
    const config = this.store.get();
    const password = this.store.getPassword();

    if (!config.appleId) return { ok: false, kind: "config", message: "Enter your Apple ID first." };
    if (!password) {
      return {
        ok: false,
        kind: "config",
        message: "Enter an app-specific password. Your ordinary Apple ID password will not work.",
      };
    }

    const dav = new IcloudDav({ credentials: { username: config.appleId, password } });
    try {
      const found = await dav.discover();
      const calendars = await dav.listCalendars();
      return { ok: true, ...found, calendars };
    } catch (error) {
      return toFailure(error);
    }
  }

  /**
   * Make an empty calendar and link to it.
   *
   * Recommended over picking an existing one, and the reason is not tidiness:
   * every ROME routine becomes a real repeating event on the user's phone, and
   * unpicking that from a personal calendar later is manual, event by event. A
   * calendar of its own is one deletion.
   */
  async createCalendar(name = "ROME"): Promise<VerifyResult> {
    const config = this.store.get();
    const password = this.store.getPassword();
    if (!config.appleId || !password) {
      return { ok: false, kind: "config", message: "Verify the account before creating a calendar." };
    }

    const dav = new IcloudDav({ credentials: { username: config.appleId, password } });
    try {
      const href = await dav.makeCalendar(name);
      this.store.update({ calendarHref: href, calendarName: name });
      const found = await dav.discover();
      return { ok: true, ...found, calendars: await dav.listCalendars() };
    } catch (error) {
      return toFailure(error);
    }
  }
}

function toFailure(error: unknown): VerifyFailure {
  if (error instanceof DavError) return { ok: false, kind: error.kind, message: error.userMessage };
  // Deliberately not `String(error)`: an undici failure can carry the request
  // headers, and those hold the password.
  return { ok: false, kind: "unexpected", message: "Could not reach iCloud." };
}
