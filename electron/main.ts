import { app, BrowserWindow, shell, ipcMain } from "electron";
import path from "path";
import { spawn, ChildProcess } from "child_process";
import fs from "fs";

// In the compiled CJS output, __dirname is available natively.
// We declare it here for TypeScript — esbuild injects it at compile time.
declare const __dirname: string;

// ── Persistent data directory ──────────────────────────────────────────────
// Windows: %APPDATA%\ROME\
// macOS:   ~/Library/Application Support/ROME/
// Dev:     ./data  (relative to project root)
export function getDataDir(): string {
  if (process.env.NODE_ENV === "development") {
    return path.join(process.cwd(), "data");
  }
  return path.join(app.getPath("userData"), "ROME");
}

export function getDbPath(): string {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "rome.db");
}

// ── Express server ─────────────────────────────────────────────────────────
let serverProcess: ChildProcess | null = null;
const SERVER_PORT = 5000;

function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const serverEntry = path.join(__dirname, "..", "dist", "index.cjs");

    if (!fs.existsSync(serverEntry)) {
      console.error("Server entry not found:", serverEntry);
      reject(new Error("Server not built"));
      return;
    }

    serverProcess = spawn(process.execPath, [serverEntry], {
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: String(SERVER_PORT),
        ROME_DB_PATH: getDbPath(),
      },
      stdio: ["ignore", "pipe", "pipe"],
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

    // Fallback: resolve after 3s even if no "listening" message
    setTimeout(resolve, 3000);
  });
}

// ── Window ─────────────────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: "ROME — Cognitive Training Lab",
    backgroundColor: "#070a0f",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    // macOS traffic lights
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    show: false,
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  // Open external links in browser, not Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  const url =
    process.env.NODE_ENV === "development"
      ? `http://localhost:${SERVER_PORT}`
      : `http://localhost:${SERVER_PORT}`;

  await mainWindow.loadURL(url);
}

// ── IPC ────────────────────────────────────────────────────────────────────
ipcMain.handle("get-data-dir", () => getDataDir());
ipcMain.handle("get-db-path", () => getDbPath());
ipcMain.handle("get-app-version", () => app.getVersion());

// ── App lifecycle ──────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  try {
    await startServer();
    await createWindow();
  } catch (err) {
    console.error("Startup error:", err);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  serverProcess?.kill();
});
