var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// electron/main.ts
var main_exports = {};
__export(main_exports, {
  getDataDir: () => getDataDir,
  getDbPath: () => getDbPath
});
module.exports = __toCommonJS(main_exports);
var import_electron = require("electron");
var import_path = __toESM(require("path"), 1);
var import_child_process = require("child_process");
var import_fs = __toESM(require("fs"), 1);
function getDataDir() {
  if (process.env.NODE_ENV === "development") {
    return import_path.default.join(process.cwd(), "data");
  }
  return import_path.default.join(import_electron.app.getPath("userData"), "ROME");
}
function getDbPath() {
  const dir = getDataDir();
  if (!import_fs.default.existsSync(dir)) import_fs.default.mkdirSync(dir, { recursive: true });
  return import_path.default.join(dir, "rome.db");
}
var serverProcess = null;
var SERVER_PORT = 5e3;
function startServer() {
  return new Promise((resolve, reject) => {
    const serverEntry = import_path.default.join(".", "..", "dist", "index.cjs");
    if (!import_fs.default.existsSync(serverEntry)) {
      console.error("Server entry not found:", serverEntry);
      reject(new Error("Server not built"));
      return;
    }
    serverProcess = (0, import_child_process.spawn)(process.execPath, [serverEntry], {
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: String(SERVER_PORT),
        ROME_DB_PATH: getDbPath()
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    serverProcess.stdout?.on("data", (d) => {
      const msg = d.toString();
      console.log("[server]", msg.trim());
      if (msg.includes("listening") || msg.includes("5000") || msg.includes("started")) {
        resolve();
      }
    });
    serverProcess.stderr?.on("data", (d) => console.error("[server err]", d.toString().trim()));
    serverProcess.on("error", reject);
    setTimeout(resolve, 3e3);
  });
}
var mainWindow = null;
async function createWindow() {
  mainWindow = new import_electron.BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: "ROME \u2014 Cognitive Training Lab",
    backgroundColor: "#070a0f",
    webPreferences: {
      preload: import_path.default.join(".", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    },
    // macOS traffic lights
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    show: false
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(({ url: url2 }) => {
    import_electron.shell.openExternal(url2);
    return { action: "deny" };
  });
  const url = process.env.NODE_ENV === "development" ? `http://localhost:${SERVER_PORT}` : `http://localhost:${SERVER_PORT}`;
  await mainWindow.loadURL(url);
}
import_electron.ipcMain.handle("get-data-dir", () => getDataDir());
import_electron.ipcMain.handle("get-db-path", () => getDbPath());
import_electron.ipcMain.handle("get-app-version", () => import_electron.app.getVersion());
import_electron.app.whenReady().then(async () => {
  try {
    await startServer();
    await createWindow();
  } catch (err) {
    console.error("Startup error:", err);
  }
  import_electron.app.on("activate", () => {
    if (import_electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
import_electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") import_electron.app.quit();
});
import_electron.app.on("before-quit", () => {
  serverProcess?.kill();
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  getDataDir,
  getDbPath
});
