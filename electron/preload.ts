import { contextBridge, ipcRenderer } from "electron";

// Expose safe APIs to the renderer (browser side)
contextBridge.exposeInMainWorld("romeDesktop", {
  getDataDir: () => ipcRenderer.invoke("get-data-dir"),
  getDbPath: () => ipcRenderer.invoke("get-db-path"),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  isDesktop: true,
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
