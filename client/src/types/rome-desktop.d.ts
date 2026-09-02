interface RomeBrowserTab {
  id: string;
  title: string;
  url: string;
  favicon: string | null;
  active: boolean;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  zoomFactor: number;
  incognito: boolean;
  crashed: boolean;
  error: string | null;
}

interface RomeBrowserHistoryEntry {
  id: string;
  title: string;
  url: string;
  visitedAt: number;
}

interface RomeBrowserBookmark {
  id: string;
  title: string;
  url: string;
  createdAt: number;
}

interface RomeBrowserDownload {
  id: string;
  filename: string;
  url: string;
  savePath: string;
  receivedBytes: number;
  totalBytes: number;
  state: "progressing" | "completed" | "cancelled" | "interrupted";
  paused: boolean;
}

interface RomeBrowserPermissionRequest {
  id: string;
  tabId: string | null;
  origin: string;
  permission: string;
}

interface RomeBrowserBootstrap {
  tabs: RomeBrowserTab[];
  history: RomeBrowserHistoryEntry[];
  bookmarks: RomeBrowserBookmark[];
  downloads: RomeBrowserDownload[];
  fullscreen: boolean;
}

type RomeAkiraStatus = import("@shared/akira").AkiraStatus;
type RomeAkiraSettings = import("@shared/akira").AkiraSettings;
type RomeAkiraApproval = import("@shared/akira").AkiraApprovalRequest;
type RomeAkiraAudioEvent = import("@shared/akira").AkiraAudioEvent;
type RomeAkiraTranscript = import("@shared/akira").AkiraTranscriptEvent;
type RomeAkiraDataChanged = import("@shared/akira").AkiraDataChanged;
type RomeAkiraRendererCommand = import("@shared/akira").AkiraRendererCommand;
type RomeAkiraRendererCommandResult = import("@shared/akira").AkiraRendererCommandResult;

interface RomeAkiraBridge {
  getStatus: () => Promise<RomeAkiraStatus>;
  activate: (viaWakeWord?: boolean) => Promise<RomeAkiraStatus>;
  standby: () => Promise<RomeAkiraStatus>;
  interrupt: () => Promise<RomeAkiraStatus>;
  submitText: (text: string) => Promise<RomeAkiraStatus>;
  transcribe: (dataUrl: string, mimeType: string) => Promise<{ text: string }>;
  respondToApproval: (id: string, approved: boolean) => Promise<void>;
  updateSettings: (patch: Partial<RomeAkiraSettings>) => Promise<RomeAkiraStatus>;
  setSecret: (name: string, value: string) => Promise<RomeAkiraStatus>;
  installRuntime: () => Promise<RomeAkiraStatus>;
  getActivity: () => Promise<import("@shared/akira").AkiraActivityEntry[]>;
  getDiagnostics: () => Promise<Record<string, unknown>>;
  getCapabilities: () => Promise<import("@shared/akira").AkiraCapabilityDescriptor[]>;
  callCapability: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  resolveRendererCommand: (result: RomeAkiraRendererCommandResult) => Promise<void>;
  shortcut: (action: string) => Promise<void>;
  /** Base64 PCM16 mono at 16 kHz. Fire-and-forget; no acknowledgement. */
  sendAudioChunk: (base64: string) => void;
  sendContext: (text: string) => void;
  onStatus: (listener: (value: RomeAkiraStatus) => void) => () => void;
  onVad: (listener: (value: { score: number; at: number }) => void) => () => void;
  onTranscript: (listener: (value: RomeAkiraTranscript) => void) => () => void;
  onAudio: (listener: (value: RomeAkiraAudioEvent) => void) => () => void;
  onApproval: (listener: (value: RomeAkiraApproval) => void) => () => void;
  onDataChanged: (listener: (value: RomeAkiraDataChanged) => void) => () => void;
  onRendererCommand: (listener: (value: RomeAkiraRendererCommand) => void) => () => void;
  onWakeDetected: (listener: (value: unknown) => void) => () => void;
  onShortcut: (listener: (value: { action?: string }) => void) => () => void;
}

interface RomeBrowserBridge {
  initialize: () => Promise<RomeBrowserBootstrap>;
  createTab: (url?: string, kind?: "default" | "incognito" | `profile:${string}`) => Promise<RomeBrowserTab>;
  closeTab: (id: string) => Promise<void>;
  activateTab: (id: string) => Promise<void>;
  navigate: (id: string, input: string) => Promise<void>;
  back: (id: string) => Promise<void>;
  forward: (id: string) => Promise<void>;
  reload: (id: string) => Promise<void>;
  stop: (id: string) => Promise<void>;
  home: (id: string) => Promise<void>;
  setZoom: (id: string, value: number) => Promise<void>;
  recover: (id: string) => Promise<void>;
  openExternal: (id: string) => Promise<void>;
  setViewport: (viewport: { x: number; y: number; width: number; height: number; visible: boolean }) => Promise<void>;
  setFullscreen: (value: boolean) => Promise<boolean>;
  /**
   * Background opacity of guest pages, 0–1. Text and images are unaffected —
   * see `electron/browser/guest-opacity.ts` for why that needs saying.
   */
  getOpacity: () => Promise<number>;
  setOpacity: (value: number) => Promise<number>;
  /** Hex colour forced on all guest text, or null for the page's own. */
  getTextColor: () => Promise<string | null>;
  setTextColor: (value: string | null) => Promise<string | null>;
  getHistory: () => Promise<RomeBrowserHistoryEntry[]>;
  clearHistory: () => Promise<void>;
  getBookmarks: () => Promise<RomeBrowserBookmark[]>;
  toggleBookmark: (url: string, title: string) => Promise<{ bookmarked: boolean; bookmarks: RomeBrowserBookmark[] }>;
  getDownloads: () => Promise<RomeBrowserDownload[]>;
  openDownload: (id: string) => Promise<void>;
  showDownload: (id: string) => Promise<void>;
  respondToPermission: (id: string, allowed: boolean) => Promise<void>;
  onTabs: (listener: (tabs: RomeBrowserTab[]) => void) => () => void;
  onDownload: (listener: (download: RomeBrowserDownload) => void) => () => void;
  onPermissionRequest: (listener: (request: RomeBrowserPermissionRequest) => void) => () => void;
  onRequestBounds: (listener: () => void) => () => void;
  onConstellationToggle: (listener: () => void) => () => void;
}

/** One calendar iCloud offers that can actually hold events. */
interface RomeDavCalendar {
  /** Path-only. Never an absolute URL — iCloud's partition host can move. */
  href: string;
  displayName: string;
  color: string;
  ctag: string;
  components: string[];
}

interface RomeKronosConfig {
  provider: "icloud";
  appleId: string;
  calendarHref: string;
  calendarName: string;
  enabled: boolean;
  pollMinutes: number;
  /** Derived. The password itself is never sent to the renderer. */
  passwordConfigured: boolean;
  secureStorageAvailable: boolean;
}

type RomeKronosVerifyResult =
  | { ok: true; origin: string; principalPath: string; homePath: string; calendars: RomeDavCalendar[] }
  | { ok: false; kind: string; message: string };

interface RomeKronosSyncStatus {
  state: "idle" | "syncing" | "error";
  lastSyncAt: number | null;
  lastError: string | null;
  lastPushed: number;
  /** Rows the last plan would send. */
  pending: number;
}

interface RomeKronosPushAction {
  kind: string;
  op: "create" | "update" | "skip";
  reason?: string;
  row: { id: number; title?: string };
}

interface RomeKronosCycleReport {
  ok: boolean;
  dryRun: boolean;
  plan: { actions: RomeKronosPushAction[]; creates: number; updates: number; skipped: number };
  pushed: number;
  failed: number;
  /** Already translated for a person. */
  problems: string[];
  finishedAt: number;
  summary: string;
}

interface RomeKronosBridge {
  getConfig: () => Promise<RomeKronosConfig>;
  updateConfig: (patch: Partial<RomeKronosConfig>) => Promise<RomeKronosConfig>;
  /**
   * Write-only. There is deliberately no counterpart that reads the password
   * back — see `electron/kronos/kronos-settings.ts`.
   */
  setPassword: (value: string) => Promise<RomeKronosConfig>;
  /** Logs in and lists calendars. Read-only against iCloud. */
  verify: () => Promise<RomeKronosVerifyResult>;
  createCalendar: (name: string) => Promise<RomeKronosVerifyResult>;
  disconnect: () => Promise<RomeKronosConfig>;
  openAppleIdPage: () => Promise<void>;
  syncStatus: () => Promise<RomeKronosSyncStatus>;
  /** `dryRun` computes the plan and writes nothing. */
  syncNow: (dryRun: boolean) => Promise<RomeKronosCycleReport>;
  onSyncStatus: (listener: (status: RomeKronosSyncStatus) => void) => () => void;
}

/**
 * Turning a document into something the Analysis State can render.
 *
 * Only office formats need this; a PDF is already what the viewer wants. The
 * bridge is absent in a browser-only `npm run dev`, which reads the same as a
 * machine with no LibreOffice — both mean "add it as a PDF instead".
 */
interface RomeForgeBridge {
  converterStatus: () => Promise<{ available: boolean; path: string | null }>;
  convertToPdf: (name: string, bytes: Uint8Array) => Promise<
    | { ok: true; pdf: Uint8Array }
    | { ok: false; reason: "no-converter" | "failed"; message?: string }
  >;
}

interface Window {
  romeDesktop?: {
    getDataDir: () => Promise<string>;
    getDbPath: () => Promise<string>;
    getAppVersion: () => Promise<string>;
    isDesktop: true;
    forge: RomeForgeBridge;
    akira: RomeAkiraBridge;
    browser: RomeBrowserBridge;
    kronos: RomeKronosBridge;
  };
}
