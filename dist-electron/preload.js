// electron/preload.ts
var import_electron = require("electron");
import_electron.contextBridge.exposeInMainWorld("romeDesktop", {
  getDataDir: () => import_electron.ipcRenderer.invoke("get-data-dir"),
  getDbPath: () => import_electron.ipcRenderer.invoke("get-db-path"),
  getAppVersion: () => import_electron.ipcRenderer.invoke("get-app-version"),
  isDesktop: true
});
