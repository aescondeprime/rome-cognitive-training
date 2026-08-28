import { contextBridge, ipcRenderer } from "electron";
import { AKIRA_CHANNELS } from "../shared/akira";

function on<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

// Expose safe APIs to the renderer (browser side)
contextBridge.exposeInMainWorld("romeDesktop", {
  getDataDir: () => ipcRenderer.invoke("get-data-dir"),
  getDbPath: () => ipcRenderer.invoke("get-db-path"),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  isDesktop: true,
  akira: {
    getStatus: () => ipcRenderer.invoke("rome:akira:status"),
    activate: (viaWakeWord?: boolean) => ipcRenderer.invoke("rome:akira:activate", viaWakeWord),
    standby: () => ipcRenderer.invoke("rome:akira:standby"),
    interrupt: () => ipcRenderer.invoke("rome:akira:interrupt"),
    submitText: (text: string) => ipcRenderer.invoke("rome:akira:submit-text", text),
    transcribe: (dataUrl: string, mimeType: string) => ipcRenderer.invoke("rome:akira:transcribe", dataUrl, mimeType),
    respondToApproval: (id: string, approved: boolean) => ipcRenderer.invoke("rome:akira:approval-response", id, approved),
    updateSettings: (patch: unknown) => ipcRenderer.invoke("rome:akira:update-settings", patch),
    setSecret: (name: string, value: string) => ipcRenderer.invoke("rome:akira:set-secret", name, value),
    installRuntime: () => ipcRenderer.invoke("rome:akira:install-runtime"),
    getActivity: () => ipcRenderer.invoke("rome:akira:activity"),
    getDiagnostics: () => ipcRenderer.invoke("rome:akira:diagnostics"),
    getCapabilities: () => ipcRenderer.invoke("rome:akira:capabilities"),
    callCapability: (name: string, args: Record<string, unknown>) => ipcRenderer.invoke("rome:akira:call-capability", name, args),
    resolveRendererCommand: (result: unknown) => ipcRenderer.invoke("rome:akira:renderer-command-result", result),
    shortcut: (action: string) => ipcRenderer.invoke("rome:akira:shortcut", action),
    // Fire-and-forget: these run several times a second while a conversation is
    // live, so they deliberately skip the invoke round-trip.
    sendAudioChunk: (base64: string) => ipcRenderer.send("rome:akira:audio-chunk", base64),
    sendContext: (text: string) => ipcRenderer.send("rome:akira:context", text),
    onStatus: (listener: (value: unknown) => void) => on(AKIRA_CHANNELS.status, listener),
    onVad: (listener: (value: unknown) => void) => on(AKIRA_CHANNELS.vad, listener),
    onTranscript: (listener: (value: unknown) => void) => on(AKIRA_CHANNELS.transcript, listener),
    onAudio: (listener: (value: unknown) => void) => on(AKIRA_CHANNELS.audio, listener),
    onApproval: (listener: (value: unknown) => void) => on(AKIRA_CHANNELS.approval, listener),
    onDataChanged: (listener: (value: unknown) => void) => on(AKIRA_CHANNELS.dataChanged, listener),
    onRendererCommand: (listener: (value: unknown) => void) => on(AKIRA_CHANNELS.rendererCommand, listener),
    onWakeDetected: (listener: (value: unknown) => void) => on(AKIRA_CHANNELS.wakeDetected, listener),
    onShortcut: (listener: (value: unknown) => void) => on("rome:akira:shortcut", listener),
  },
  browser: {
    initialize: () => ipcRenderer.invoke("rome:browser:initialize"),
    createTab: (url?: string, kind?: string) => ipcRenderer.invoke("rome:browser:create-tab", url, kind),
    closeTab: (id: string) => ipcRenderer.invoke("rome:browser:close-tab", id),
    activateTab: (id: string) => ipcRenderer.invoke("rome:browser:activate-tab", id),
    navigate: (id: string, input: string) => ipcRenderer.invoke("rome:browser:navigate", id, input),
    back: (id: string) => ipcRenderer.invoke("rome:browser:back", id),
    forward: (id: string) => ipcRenderer.invoke("rome:browser:forward", id),
    reload: (id: string) => ipcRenderer.invoke("rome:browser:reload", id),
    stop: (id: string) => ipcRenderer.invoke("rome:browser:stop", id),
    home: (id: string) => ipcRenderer.invoke("rome:browser:home", id),
    setZoom: (id: string, value: number) => ipcRenderer.invoke("rome:browser:set-zoom", id, value),
    recover: (id: string) => ipcRenderer.invoke("rome:browser:recover", id),
    openExternal: (id: string) => ipcRenderer.invoke("rome:browser:open-external", id),
    setViewport: (viewport: { x: number; y: number; width: number; height: number; visible: boolean }) =>
      ipcRenderer.invoke("rome:browser:set-viewport", viewport),
    setFullscreen: (value: boolean) => ipcRenderer.invoke("rome:browser:set-fullscreen", value),
    getOpacity: () => ipcRenderer.invoke("rome:browser:get-opacity"),
    setOpacity: (value: number) => ipcRenderer.invoke("rome:browser:set-opacity", value),
    getTextColor: () => ipcRenderer.invoke("rome:browser:get-text-color"),
    setTextColor: (value: string | null) => ipcRenderer.invoke("rome:browser:set-text-color", value),
    getHistory: () => ipcRenderer.invoke("rome:browser:get-history"),
    clearHistory: () => ipcRenderer.invoke("rome:browser:clear-history"),
    getBookmarks: () => ipcRenderer.invoke("rome:browser:get-bookmarks"),
    toggleBookmark: (url: string, title: string) => ipcRenderer.invoke("rome:browser:toggle-bookmark", url, title),
    getDownloads: () => ipcRenderer.invoke("rome:browser:get-downloads"),
    openDownload: (id: string) => ipcRenderer.invoke("rome:browser:open-download", id),
    showDownload: (id: string) => ipcRenderer.invoke("rome:browser:show-download", id),
    respondToPermission: (id: string, allowed: boolean) =>
      ipcRenderer.invoke("rome:browser:permission-response", id, allowed),
    onTabs: (listener: (tabs: unknown[]) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, tabs: unknown[]) => listener(tabs);
      ipcRenderer.on("rome:browser:tabs", handler);
      return () => ipcRenderer.removeListener("rome:browser:tabs", handler);
    },
    onDownload: (listener: (download: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, download: unknown) => listener(download);
      ipcRenderer.on("rome:browser:download", handler);
      return () => ipcRenderer.removeListener("rome:browser:download", handler);
    },
    onPermissionRequest: (listener: (request: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, request: unknown) => listener(request);
      ipcRenderer.on("rome:browser:permission-request", handler);
      return () => ipcRenderer.removeListener("rome:browser:permission-request", handler);
    },
    onRequestBounds: (listener: () => void) => {
      const handler = () => listener();
      ipcRenderer.on("rome:browser:request-bounds", handler);
      return () => ipcRenderer.removeListener("rome:browser:request-bounds", handler);
    },
    onConstellationToggle: (listener: () => void) => {
      const handler = () => listener();
      ipcRenderer.on("rome:constellation:toggle", handler);
      return () => ipcRenderer.removeListener("rome:constellation:toggle", handler);
    },
  },
});
