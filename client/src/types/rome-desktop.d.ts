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
  activate: () => Promise<RomeAkiraStatus>;
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
  onStatus: (listener: (value: RomeAkiraStatus) => void) => () => void;
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

interface Window {
  romeDesktop?: {
    getDataDir: () => Promise<string>;
    getDbPath: () => Promise<string>;
    getAppVersion: () => Promise<string>;
    isDesktop: true;
    akira: RomeAkiraBridge;
    browser: RomeBrowserBridge;
  };
}
