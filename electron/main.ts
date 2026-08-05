import { app, BrowserWindow, shell, ipcMain, dialog } from "electron";
import path from "path";
import { spawn, ChildProcess } from "child_process";
import fs from "fs";

declare const __dirname: string;

// ── Persistent data directory ──────────────────────────────────────────────
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

// ── Load .env file from app userData dir ──────────────────────────────────
// In production: ~/Library/Application Support/ROME/.env
// In dev: <project-root>/.env (already loaded by dotenv in server)
function loadEnvFile(): Record<string, string> {
  const envPaths = [
    path.join(getDataDir(), ".env"),           // production
    path.join(app.getAppPath(), "..", ".env"), // alongside app
    path.join(process.cwd(), ".env"),          // dev fallback
  ];

  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf-8");
      const vars: Record<string, string> = {};
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
        vars[key] = val;
      }
      console.log(`[ROME] Loaded env from: ${envPath}`);
      return vars;
    }
  }
  console.warn("[ROME] No .env file found — server will use process environment");
  return {};
}

// ── Express server ─────────────────────────────────────────────────────────
let serverProcess: ChildProcess | null = null;
const SERVER_PORT = 5000;

function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const serverEntry = path.join(__dirname, "..", "dist", "index.cjs");

    if (!fs.existsSync(serverEntry)) {
      dialog.showErrorBox(
        "ROME — Startup Error",
        `Server bundle not found at:\n${serverEntry}\n\nPlease rebuild the app.`
      );
      reject(new Error("Server not built"));
      return;
    }

    const envVars = loadEnvFile();

    serverProcess = spawn(process.execPath, [serverEntry], {
      env: {
        ...process.env,
        ...envVars,
        NODE_ENV: "production",
        PORT: String(SERVER_PORT),
        ROME_DB_PATH: getDbPath(),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    serverProcess.stdout?.on("data", (d) => {
      const msg = d.toString().trim();
      console.log("[server]", msg);
      if (
        msg.includes("listening") ||
        msg.includes("5000") ||
        msg.includes("started") ||
        msg.includes("ready")
      ) {
        resolve();
      }
    });

    serverProcess.stderr?.on("data", (d) => {
      console.error("[server err]", d.toString().trim());
    });

    serverProcess.on("error", (err) => {
      dialog.showErrorBox("ROME — Server Error", err.message);
      reject(err);
    });

    // Fallback resolve after 4s
    setTimeout(resolve, 4000);
  });
}

// ── Main window ────────────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: "ROME — Cognitive Training Lab",
    backgroundColor: "#070a0f",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 16, y: 16 },
    show: false,
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  await mainWindow.loadURL(`http://localhost:${SERVER_PORT}`);
}

// ── IPC handlers ───────────────────────────────────────────────────────────
ipcMain.handle("get-data-dir", () => getDataDir());
ipcMain.handle("get-db-path", () => getDbPath());
ipcMain.handle("get-app-version", () => app.getVersion());

// ── App lifecycle ──────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  try {
    console.log("[ROME] Starting server...");
    await startServer();
    console.log("[ROME] Server ready, opening window...");
    await createWindow();
  } catch (err) {
    console.error("[ROME] Startup failed:", err);
    app.quit();
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
