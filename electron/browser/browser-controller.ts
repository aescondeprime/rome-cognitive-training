import {
  app,
  BrowserWindow,
  type Certificate,
  type Event,
  type WebContents,
} from "electron";
import { BrowserStorage } from "./browser-storage";
import { DownloadManager } from "./download-manager";
import { PermissionManager } from "./permission-manager";
import { SessionManager } from "./session-manager";
import { TabManager } from "./tab-manager";
import type { BrowserSessionKind, BrowserViewport } from "./types";

export class BrowserController {
  readonly tabs: TabManager;
  readonly storage: BrowserStorage;
  readonly downloads: DownloadManager;
  readonly permissions: PermissionManager;
  private readonly sessions = new SessionManager();

  private readonly certificateHandler = (
    event: Event,
    contents: WebContents,
    url: string,
    error: string,
    _certificate: Certificate,
    callback: (isTrusted: boolean) => void,
  ) => {
    event.preventDefault();
    this.tabs.markCertificateError(contents, url, error);
    callback(false);
  };

  constructor(
    private readonly host: BrowserWindow,
    dataDir: string,
    getAkiraShortcut: () => "Control+Escape" | "Control+Shift+Escape" = () => "Control+Escape",
  ) {
    const emit = (channel: string, payload: unknown) => {
      if (!host.isDestroyed()) host.webContents.send(channel, payload);
    };

    let tabManager: TabManager;
    this.storage = new BrowserStorage(dataDir);
    this.permissions = new PermissionManager(
      emit,
      (contents) => tabManager?.getTabIdForContents(contents) ?? null,
    );
    this.downloads = new DownloadManager(
      emit,
      (contents) => tabManager?.isBrowserContents(contents) ?? false,
    );
    tabManager = new TabManager(
      host,
      this.sessions,
      this.permissions,
      this.downloads,
      this.storage,
      emit,
      getAkiraShortcut,
    );
    this.tabs = tabManager;

    app.on("certificate-error", this.certificateHandler);
    host.on("resize", () => {
      if (!host.isDestroyed()) host.webContents.send("rome:browser:request-bounds");
    });
  }

  owns(contents: WebContents): boolean {
    return !this.host.isDestroyed() && contents.id === this.host.webContents.id;
  }

  initialize() {
    return {
      tabs: this.tabs.initialize(),
      history: this.storage.getHistory(),
      bookmarks: this.storage.getBookmarks(),
      downloads: this.downloads.list(),
      fullscreen: this.host.isFullScreen(),
    };
  }

  createTab(url?: string, kind: BrowserSessionKind = "default") {
    return this.tabs.createTab(url, kind, true);
  }

  readActivePage(maxCharacters?: number) {
    return this.tabs.readActivePage(maxCharacters);
  }

  setViewport(viewport: BrowserViewport): void {
    if (
      !viewport ||
      ![viewport.x, viewport.y, viewport.width, viewport.height].every(Number.isFinite)
    ) {
      throw new Error("Invalid browser viewport");
    }
    this.tabs.setViewport(viewport);
  }

  setFullscreen(value: boolean): boolean {
    this.host.setFullScreen(Boolean(value));
    return this.host.isFullScreen();
  }

  dispose(): void {
    app.removeListener("certificate-error", this.certificateHandler);
    this.permissions.dispose();
    this.tabs.dispose();
  }
}
