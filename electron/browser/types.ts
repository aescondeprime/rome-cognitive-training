export type BrowserSessionKind = "default" | "incognito" | `profile:${string}`;

export interface BrowserViewport {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}

export interface BrowserTabState {
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

export interface BrowserDownloadState {
  id: string;
  filename: string;
  url: string;
  savePath: string;
  receivedBytes: number;
  totalBytes: number;
  state: "progressing" | "completed" | "cancelled" | "interrupted";
  paused: boolean;
}

export interface BrowserPermissionRequest {
  id: string;
  tabId: string | null;
  origin: string;
  permission: string;
}

export interface BrowserHistoryEntry {
  id: string;
  title: string;
  url: string;
  visitedAt: number;
}

export interface BrowserBookmark {
  id: string;
  title: string;
  url: string;
  createdAt: number;
}
