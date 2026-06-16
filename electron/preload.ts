import { contextBridge, ipcRenderer } from "electron";

// Expose safe APIs to the renderer (browser side)
contextBridge.exposeInMainWorld("romeDesktop", {
  getDataDir: () => ipcRenderer.invoke("get-data-dir"),
  getDbPath: () => ipcRenderer.invoke("get-db-path"),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  isDesktop: true,
});
