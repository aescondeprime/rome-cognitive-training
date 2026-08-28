import crypto from "crypto";
import {
  BrowserWindow,
  WebContentsView,
  shell,
  type WebContents,
} from "electron";
import { BrowserStorage, isWebUrl } from "./browser-storage";
import { GUEST_CURSOR_JS, guestCursorCss } from "./guest-cursor";
import { guestOpacityJs, normalizeTextColor } from "./guest-opacity";
import { DownloadManager } from "./download-manager";
import { PermissionManager } from "./permission-manager";
import { SessionManager } from "./session-manager";
import {
  DEFAULT_CONSOLE_SHORTCUT,
  DEFAULT_CONVERSATION_SHORTCUT,
  matchesAkiraShortcut,
} from "../../shared/akira";
import type {
  BrowserSessionKind,
  BrowserTabState,
  BrowserViewport,
} from "./types";

const HOME_URL = "https://www.google.com/";

/**
 * Akira accelerators, read fresh on every keystroke so a settings change takes
 * effect without recreating tabs.
 */
export interface AkiraShortcutBindings {
  conversation: string;
  console: string;
}

export const DEFAULT_AKIRA_SHORTCUT_BINDINGS: AkiraShortcutBindings = {
  conversation: DEFAULT_CONVERSATION_SHORTCUT,
  console: DEFAULT_CONSOLE_SHORTCUT,
};

interface ManagedTab {
  id: string;
  view: WebContentsView;
  sessionKind: BrowserSessionKind;
  state: BrowserTabState;
}

function isAllowedNavigation(value: string): boolean {
  if (value === "about:blank") return true;
  return isWebUrl(value);
}

export function resolveOmniboxInput(input: string): string {
  const value = input.trim().slice(0, 4096);
  if (!value) return HOME_URL;

  try {
    const parsed = new URL(value);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.toString();
  } catch {
    // Continue with domain/search detection.
  }

  const looksLikeHost =
    !/\s/.test(value) &&
    (value === "localhost" ||
      value.startsWith("localhost:") ||
      /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(value) ||
      /^[^/]+\.[a-z]{2,}(?::\d+)?(?:\/.*)?$/i.test(value));

  if (looksLikeHost) {
    const local = value.startsWith("localhost") || /^127\./.test(value);
    try {
      return new URL(`${local ? "http" : "https"}://${value}`).toString();
    } catch {
      // Fall through to search.
    }
  }

  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

export class TabManager {
  private readonly tabs = new Map<string, ManagedTab>();
  private activeId: string | null = null;
  private attachedView: WebContentsView | null = null;
  /**
   * Accent used by the cursor injected into guest pages. Cached because the
   * user retunes it live in the Constellation editor, and re-read on each
   * injection rather than pushed over IPC — a page load is not a hot path, and
   * one extra plumbing channel is worse than one extra round trip.
   */
  private cursorAccent = { h: "43", s: "88%" };
  private viewport: BrowserViewport = { x: 0, y: 0, width: 0, height: 0, visible: false };
  /**
   * How solid the browser surface is, 0.25–1.
   *
   * A `WebContentsView` is a native view composited above the React tree, so
   * no CSS in ROME can fade it — the same constraint that makes the guest draw
   * its own cursor. Translucency is three things done together: the view's own
   * backdrop is cleared here, the renderer paints ROME's sky behind the
   * viewport rectangle, and the page itself is faded by `guest-opacity`, which
   * has to relocate the page's background before `opacity` can touch it.
   */
  private opacity = 1;

  /**
   * Forced text colour for guest pages, or null for the page's own.
   *
   * Lives beside the opacity for the same reason: the main process is the only
   * thing that can reach a native `WebContentsView`, so it owns both values and
   * the renderer's controls are a view onto them.
   */
  private textColor: string | null = null;

  constructor(
    private readonly host: BrowserWindow,
    private readonly sessions: SessionManager,
    private readonly permissions: PermissionManager,
    private readonly downloads: DownloadManager,
    private readonly storage: BrowserStorage,
    private readonly emit: (channel: string, payload: unknown) => void,
    private readonly getAkiraShortcut: () => AkiraShortcutBindings = () => DEFAULT_AKIRA_SHORTCUT_BINDINGS,
  ) {}

  initialize(): BrowserTabState[] {
    if (this.tabs.size === 0) this.createTab(HOME_URL, "default", true);
    this.publish();
    return this.getStates();
  }

  createTab(
    requestedUrl = HOME_URL,
    sessionKind: BrowserSessionKind = "default",
    activate = true,
  ): BrowserTabState {
    const targetSession = this.sessions.get(sessionKind);
    this.permissions.attach(targetSession);
    this.downloads.attach(targetSession);

    const view = new WebContentsView({
      webPreferences: {
        session: targetSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        javascript: true,
      },
    });
    view.webContents.setBackgroundThrottling(true);

    const id = crypto.randomUUID();
    const tab: ManagedTab = {
      id,
      view,
      sessionKind,
      state: {
        id,
        title: "New Tab",
        url: "",
        favicon: null,
        active: false,
        loading: false,
        canGoBack: false,
        canGoForward: false,
        zoomFactor: 1,
        incognito: sessionKind === "incognito",
        crashed: false,
        error: null,
      },
    };
    this.tabs.set(id, tab);
    this.bind(tab);

    if (activate || !this.activeId) this.activate(id);
    void this.load(tab, resolveOmniboxInput(requestedUrl));
    this.publish();
    return { ...tab.state };
  }

  /** Read ROME's live accent out of the shell so the guest cursor matches it. */
  private async refreshCursorAccent(): Promise<void> {
    if (this.host.isDestroyed()) return;
    try {
      const read = (await this.host.webContents.executeJavaScript(
        `(() => { const s = getComputedStyle(document.documentElement);` +
        ` return { h: s.getPropertyValue("--accent-h").trim(),` +
        ` s: s.getPropertyValue("--accent-s").trim() }; })()`,
        true,
      )) as { h?: string; s?: string } | null;
      if (read && read.h) this.cursorAccent = { h: read.h, s: read.s || "88%" };
    } catch {
      // The shell may not have painted yet. The cached value is fine.
    }
  }

  private async injectGuestCursor(tab: ManagedTab): Promise<void> {
    const contents = tab.view.webContents;
    if (contents.isDestroyed()) return;
    // Only real pages. Error pages and about:blank get the native pointer,
    // which is the correct signal that nothing is loaded.
    if (!isWebUrl(contents.getURL())) return;
    await this.refreshCursorAccent();
    if (contents.isDestroyed()) return;
    try {
      await contents.insertCSS(guestCursorCss(this.cursorAccent.h, this.cursorAccent.s));
      await contents.executeJavaScript(GUEST_CURSOR_JS, true);
    } catch {
      // A page that navigated away mid-injection is not an error worth
      // surfacing; the next dom-ready will inject into whatever replaced it.
    }
  }

  private bind(tab: ManagedTab): void {
    const contents = tab.view.webContents;
    const sync = () => this.sync(tab);

    contents.on("did-start-loading", () => {
      tab.state.loading = true;
      tab.state.error = null;
      tab.state.crashed = false;
      this.publish();
    });
    contents.on("did-stop-loading", sync);
    // The renderer's own cursor cannot draw over a native WebContentsView, so
    // the page draws its own. Fires per navigation; the payload guards against
    // double-injection itself.
    contents.on("dom-ready", () => {
      void this.injectGuestCursor(tab);
      // Re-applied per navigation: the injected state belongs to the document,
      // and a tab that silently went opaque again after following a link would
      // read as the setting having been forgotten.
      void this.applyOpacity(tab, true);
    });
    contents.on("page-title-updated", (_event, title) => {
      tab.state.title = title || "New Tab";
      this.publish();
    });
    contents.on("page-favicon-updated", (_event, favicons) => {
      tab.state.favicon = favicons.find((favicon) => /^https?:|^data:/.test(favicon)) ?? null;
      this.publish();
    });
    contents.on("did-navigate", (_event, url) => {
      this.permissions.clearForTab(tab.id, this.originFor(url));
      this.sync(tab);
      if (tab.sessionKind !== "incognito" && isWebUrl(url)) {
        this.storage.recordHistory(url, contents.getTitle());
      }
    });
    contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      this.sync(tab);
      if (tab.sessionKind !== "incognito" && isMainFrame && isWebUrl(url)) {
        this.storage.recordHistory(url, contents.getTitle());
      }
    });
    contents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame || errorCode === -3) return; // ERR_ABORTED is normal during redirects/stops.
        tab.state.loading = false;
        tab.state.error = `${errorDescription} (${errorCode})`;
        tab.state.url = validatedURL || tab.state.url;
        this.publish();
      },
    );
    contents.on("render-process-gone", (_event, details) => {
      tab.state.loading = false;
      tab.state.crashed = true;
      tab.state.error = `Renderer stopped: ${details.reason}`;
      this.publish();
    });
    contents.on("unresponsive", () => {
      tab.state.error = "This page is not responding.";
      this.publish();
    });
    contents.on("responsive", () => {
      if (!tab.state.crashed) tab.state.error = null;
      this.publish();
    });
    contents.on("will-navigate", (event, url) => {
      if (!isAllowedNavigation(url)) {
        event.preventDefault();
        tab.state.error = "ROME blocked a non-web navigation request.";
        this.publish();
      }
    });
    contents.on("before-input-event", (event, input) => {
      // Akira's shortcuts have to work while a native browser view holds focus,
      // otherwise the only way out of a conversation is clicking back into ROME.
      if (input.type === "keyDown" && !input.isAutoRepeat) {
        const bindings = this.getAkiraShortcut();
        const asKeyEvent = {
          key: input.key,
          code: input.code,
          metaKey: input.meta,
          ctrlKey: input.control,
          shiftKey: input.shift,
          altKey: input.alt,
        };
        if (matchesAkiraShortcut(bindings.conversation, asKeyEvent)) {
          event.preventDefault();
          this.emit("rome:akira:shortcut", { action: "toggle" });
          return;
        }
        if (matchesAkiraShortcut(bindings.console, asKeyEvent)) {
          event.preventDefault();
          this.emit("rome:akira:shortcut", { action: "console" });
          return;
        }
      }
      const commandOrControl = process.platform === "darwin" ? input.meta : input.control;
      if (input.type === "keyDown" && commandOrControl && !input.alt && !input.isAutoRepeat) {
        if (input.key.toLowerCase() === "t" && !input.shift) {
          event.preventDefault();
          this.createTab(HOME_URL, tab.sessionKind, true);
          return;
        }
        if (input.key.toLowerCase() === "w" && !input.shift) {
          event.preventDefault();
          this.close(tab.id);
          return;
        }
      }
      if (
        input.type === "keyDown" && input.key === "Tab" && input.control &&
        !input.alt && !input.meta && !input.isAutoRepeat
      ) {
        event.preventDefault();
        this.cycleActive(input.shift ? -1 : 1);
        return;
      }
      if (
        input.type === "keyDown" &&
        input.key === "Tab" &&
        !input.shift &&
        !input.control &&
        !input.alt &&
        !input.meta &&
        !input.isAutoRepeat
      ) {
        event.preventDefault();
        this.viewport = { ...this.viewport, visible: false };
        this.detachView();
        this.host.webContents.focus();
        this.emit("rome:constellation:toggle", null);
      }
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (isWebUrl(url)) this.createTab(url, tab.sessionKind, true);
      return { action: "deny" };
    });
  }

  private sync(tab: ManagedTab): void {
    if (tab.view.webContents.isDestroyed()) return;
    const contents = tab.view.webContents;
    tab.state.url = contents.getURL() === "about:blank" ? "" : contents.getURL();
    tab.state.title = contents.getTitle() || tab.state.title;
    tab.state.loading = contents.isLoading();
    tab.state.canGoBack = contents.navigationHistory.canGoBack();
    tab.state.canGoForward = contents.navigationHistory.canGoForward();
    tab.state.zoomFactor = contents.getZoomFactor();
    this.publish();
  }

  private async load(tab: ManagedTab, url: string): Promise<void> {
    if (!isAllowedNavigation(url)) throw new Error("Blocked navigation protocol");
    tab.state.error = null;
    try {
      await tab.view.webContents.loadURL(url);
    } catch (error) {
      if (tab.view.webContents.isDestroyed()) return;
      const message = error instanceof Error ? error.message : String(error);
      if (!/ERR_ABORTED/.test(message)) {
        tab.state.error = message;
        tab.state.loading = false;
        this.publish();
      }
    }
  }

  activate(id: string): void {
    const next = this.tabs.get(id);
    if (!next) throw new Error("Unknown browser tab");
    this.activeId = id;
    for (const tab of this.tabs.values()) tab.state.active = tab.id === id;
    this.attachActiveView();
    this.publish();
  }

  cycleActive(direction: -1 | 1): void {
    const ids = Array.from(this.tabs.keys());
    if (ids.length < 2) return;
    const currentIndex = this.activeId ? ids.indexOf(this.activeId) : 0;
    const nextIndex = (currentIndex + direction + ids.length) % ids.length;
    this.activate(ids[nextIndex]);
  }

  close(id: string): void {
    const tab = this.tabs.get(id);
    if (!tab) return;
    const wasActive = this.activeId === id;
    if (this.attachedView === tab.view) this.detachView();
    this.permissions.clearForTab(id);
    this.tabs.delete(id);
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();

    if (wasActive) {
      this.activeId = Array.from(this.tabs.keys()).at(-1) ?? null;
      if (this.activeId) this.tabs.get(this.activeId)!.state.active = true;
    }
    if (this.tabs.size === 0) {
      this.createTab(HOME_URL, "default", true);
      return;
    }
    this.attachActiveView();
    this.publish();
  }

  navigate(id: string, input: string): void {
    const tab = this.requireTab(id);
    void this.load(tab, resolveOmniboxInput(input));
  }

  goBack(id: string): void {
    const history = this.requireTab(id).view.webContents.navigationHistory;
    if (history.canGoBack()) history.goBack();
  }

  goForward(id: string): void {
    const history = this.requireTab(id).view.webContents.navigationHistory;
    if (history.canGoForward()) history.goForward();
  }

  reload(id: string): void {
    this.requireTab(id).view.webContents.reload();
  }

  stop(id: string): void {
    this.requireTab(id).view.webContents.stop();
  }

  home(id: string): void {
    void this.load(this.requireTab(id), HOME_URL);
  }

  setZoom(id: string, zoomFactor: number): void {
    const value = Math.min(3, Math.max(0.5, Number(zoomFactor) || 1));
    this.requireTab(id).view.webContents.setZoomFactor(value);
    this.sync(this.requireTab(id));
  }

  recover(id: string): void {
    const failed = this.requireTab(id);
    const { sessionKind } = failed;
    const url = isWebUrl(failed.state.url) ? failed.state.url : HOME_URL;
    const wasActive = failed.state.active;
    this.createTab(url, sessionKind, wasActive);
    this.close(id);
  }

  openExternal(id: string): void {
    const url = this.requireTab(id).state.url;
    if (isWebUrl(url)) void shell.openExternal(url);
  }

  /** Current surface opacity, so the renderer can restore its slider on mount. */
  getOpacity(): number {
    return this.opacity;
  }

  /**
   * 0–1.
   *
   * The floor used to be a quarter, because the old implementation faded the
   * whole page and below that the text was gone. `guest-opacity` now puts the
   * alpha on backgrounds only and leaves text and images at full strength, so
   * zero is a legitimate setting: the page becomes its own words and pictures
   * floating over ROME.
   */
  setOpacity(value: number): number {
    const next = Math.min(1, Math.max(0, Number.isFinite(value) ? Number(value) : 1));
    this.opacity = next;
    for (const tab of this.tabs.values()) void this.applyOpacity(tab);
    return this.opacity;
  }

  /** Current forced text colour, so the renderer can restore its swatch. */
  getTextColor(): string | null {
    return this.textColor;
  }

  /**
   * A hex colour to force on all guest text, or null to hand the page back its
   * own. Anything else is treated as null rather than passed through — this
   * value is concatenated into an injected script.
   */
  setTextColor(value: string | null): string | null {
    const next = normalizeTextColor(value);
    this.textColor = next;
    for (const tab of this.tabs.values()) void this.applyOpacity(tab);
    return this.textColor;
  }

  /**
   * @param refresh True when the page is new to us — a load or a navigation —
   *                so the payload re-reads every surface. A slider move passes
   *                false and is written from the cache the page already has.
   */
  private async applyOpacity(tab: ManagedTab, refresh = false): Promise<void> {
    const contents = tab.view.webContents;
    if (contents.isDestroyed()) return;

    // Clearing the view's backdrop is what lets ROME show through the gap the
    // faded page leaves. Restored to an opaque near-black at full opacity so a
    // page that paints no background of its own (a bare PDF viewer, a blank
    // document) still looks like a browser rather than a hole in the app.
    try {
      tab.view.setBackgroundColor(this.opacity >= 0.999 ? "#070a0f" : "#00000000");
    } catch {
      // A build without a settable view backdrop. The page-level fade below is
      // still visible against whatever the view does paint.
    }

    // Only real pages, matching the cursor injection: error pages and
    // about:blank are chrome, not content, and should not be tampered with.
    if (!isWebUrl(contents.getURL())) return;

    try {
      await contents.executeJavaScript(guestOpacityJs(this.opacity, this.textColor, refresh), true);
    } catch {
      // A page that navigated away mid-call. The next dom-ready re-applies.
    }
  }

  setViewport(viewport: BrowserViewport): void {
    const content = this.host.getContentBounds();
    const x = Math.max(0, Math.floor(viewport.x));
    const y = Math.max(0, Math.floor(viewport.y));
    const width = Math.max(0, Math.min(Math.floor(viewport.width), content.width - x));
    const height = Math.max(0, Math.min(Math.floor(viewport.height), content.height - y));
    this.viewport = { x, y, width, height, visible: Boolean(viewport.visible) };
    this.attachActiveView();
  }

  private attachActiveView(): void {
    const tab = this.activeId ? this.tabs.get(this.activeId) : null;
    if (!tab || !this.viewport.visible || this.viewport.width < 2 || this.viewport.height < 2) {
      this.detachView();
      return;
    }
    if (this.attachedView !== tab.view) {
      this.detachView();
      this.host.contentView.addChildView(tab.view);
      this.attachedView = tab.view;
    }
    tab.view.setBounds({
      x: this.viewport.x,
      y: this.viewport.y,
      width: this.viewport.width,
      height: this.viewport.height,
    });
  }

  private detachView(): void {
    if (!this.attachedView) return;
    try {
      this.host.contentView.removeChildView(this.attachedView);
    } catch {
      // The host may already be tearing down.
    }
    this.attachedView = null;
  }

  getStates(): BrowserTabState[] {
    return Array.from(this.tabs.values(), ({ state }) => ({ ...state }));
  }

  getActiveState(): BrowserTabState | null {
    const tab = this.activeId ? this.tabs.get(this.activeId) : null;
    return tab ? { ...tab.state } : null;
  }

  async readActivePage(maxCharacters = 24_000): Promise<{
    title: string;
    url: string;
    text: string;
    truncated: boolean;
    trust: "untrusted-web-content";
  }> {
    const tab = this.activeId ? this.tabs.get(this.activeId) : null;
    if (!tab || tab.view.webContents.isDestroyed()) throw new Error("There is no readable active browser tab.");
    const safeLimit = Math.max(1_000, Math.min(50_000, Math.floor(maxCharacters)));
    const result = await tab.view.webContents.executeJavaScript(`(() => {
      const root = document.querySelector('main, article, [role="main"]') || document.body;
      if (!root) return { title: document.title || '', url: location.href, text: '' };
      const clone = root.cloneNode(true);
      clone.querySelectorAll('script,style,noscript,svg,canvas,form,input,textarea,select,button,[aria-hidden="true"],[hidden]').forEach(node => node.remove());
      return {
        title: (document.title || '').slice(0, 500),
        url: location.href,
        text: (clone.innerText || clone.textContent || '').replace(/\\s+/g, ' ').trim()
      };
    })()`, true) as { title?: unknown; url?: unknown; text?: unknown };
    const complete = typeof result.text === "string" ? result.text : "";
    return {
      title: typeof result.title === "string" ? result.title : tab.state.title,
      url: typeof result.url === "string" ? result.url : tab.state.url,
      text: complete.slice(0, safeLimit),
      truncated: complete.length > safeLimit,
      trust: "untrusted-web-content",
    };
  }

  getTabIdForContents(contents: WebContents): string | null {
    for (const tab of this.tabs.values()) {
      if (tab.view.webContents.id === contents.id) return tab.id;
    }
    return null;
  }

  isBrowserContents(contents: WebContents): boolean {
    return this.getTabIdForContents(contents) !== null;
  }

  markCertificateError(contents: WebContents, url: string, error: string): boolean {
    const id = this.getTabIdForContents(contents);
    if (!id) return false;
    const tab = this.requireTab(id);
    tab.state.url = url;
    tab.state.loading = false;
    tab.state.error = `Certificate error: ${error}`;
    this.publish();
    return true;
  }

  private originFor(url: string): string | undefined {
    try {
      return new URL(url).origin;
    } catch {
      return undefined;
    }
  }

  private requireTab(id: string): ManagedTab {
    const tab = this.tabs.get(id);
    if (!tab) throw new Error("Unknown browser tab");
    return tab;
  }

  private publish(): void {
    this.emit("rome:browser:tabs", this.getStates());
  }

  dispose(): void {
    this.detachView();
    for (const tab of this.tabs.values()) {
      this.permissions.clearForTab(tab.id);
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    }
    this.tabs.clear();
    this.activeId = null;
  }
}
