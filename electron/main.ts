import {
  app,
  BrowserWindow,
  shell,
  ipcMain,
  dialog,
} from "electron";
import path from "path";
import { spawn, ChildProcess } from "child_process";
import fs from "fs";

declare const __dirname: string;

// ── Application state ─────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;

const gotSingleInstanceLock = app.requestSingleInstanceLock();

// ── Persistent data directory ─────────────────────────────────────────────

export function getDataDir(): string {
  if (process.env.NODE_ENV === "development") {
    return path.join(process.cwd(), "data");
  }

  return path.join(app.getPath("userData"), "ROME");
}

export function getDbPath(): string {
  const dir = getDataDir();

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return path.join(dir, "rome.db");
}

// ── Load .env file from app userData directory ────────────────────────────
// Production: ~/Library/Application Support/ROME/.env
// Development: <project-root>/.env

function loadEnvFile(): Record<string, string> {
  const envPaths = [
    path.join(getDataDir(), ".env"),
    path.join(app.getAppPath(), "..", ".env"),
    path.join(process.cwd(), ".env"),
  ];

  for (const envPath of envPaths) {
    if (!fs.existsSync(envPath)) {
      continue;
    }

    const content = fs.readFileSync(envPath, "utf-8");
    const vars: Record<string, string> = {};

    for (const line of content.split("\n")) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const eqIdx = trimmed.indexOf("=");

      if (eqIdx === -1) {
        continue;
      }

      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed
        .slice(eqIdx + 1)
        .trim()
        .replace(/^["']|["']$/g, "");

      vars[key] = value;
    }

    console.log(`[ROME] Loaded env from: ${envPath}`);
    return vars;
  }

  console.warn(
    "[ROME] No .env file found — server will use process environment"
  );

  return {};
}

// ── Express server ────────────────────────────────────────────────────────

const SERVER_PORT = 5000;

function startServer(): Promise<void> {
  if (serverProcess && !serverProcess.killed) {
    console.log("[ROME] Server process already exists");
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const serverEntry = path.join(
      __dirname,
      "..",
      "dist",
      "index.cjs"
    );

    if (!fs.existsSync(serverEntry)) {
      const message =
        `Server bundle not found at:\n${serverEntry}\n\n` +
        "Please rebuild the app.";

      dialog.showErrorBox("ROME — Startup Error", message);
      reject(new Error(message));
      return;
    }

    const envVars = loadEnvFile();

    let startupComplete = false;
    let stderrOutput = "";

    const startupTimer = setTimeout(() => {
      if (!startupComplete) {
        startupComplete = true;
        console.log("[ROME] Server startup fallback reached");
        resolve();
      }
    }, 4000);

    /*
     * process.execPath is the packaged ROME executable.
     *
     * ELECTRON_RUN_AS_NODE prevents it from opening another
     * copy of ROME and instead runs index.cjs as a Node process.
     */
    serverProcess = spawn(process.execPath, [serverEntry], {
      cwd: path.dirname(serverEntry),

      env: {
        ...process.env,
        ...envVars,

        ELECTRON_RUN_AS_NODE: "1",
        NODE_ENV: "production",
        PORT: String(SERVER_PORT),
        ROME_DB_PATH: getDbPath(),
      },

      stdio: ["ignore", "pipe", "pipe"],
    });

    serverProcess.stdout?.on("data", (data: Buffer) => {
      const message = data.toString().trim();

      if (!message) {
        return;
      }

      console.log("[server]", message);

      const normalized = message.toLowerCase();

      if (
        !startupComplete &&
        (
          normalized.includes("listening") ||
          normalized.includes(`localhost:${SERVER_PORT}`) ||
          normalized.includes(`port ${SERVER_PORT}`) ||
          normalized.includes("server started") ||
          normalized.includes("server ready")
        )
      ) {
        startupComplete = true;
        clearTimeout(startupTimer);
        resolve();
      }
    });

    serverProcess.stderr?.on("data", (data: Buffer) => {
      const message = data.toString();

      stderrOutput += message;
      console.error("[server err]", message.trim());
    });

    serverProcess.on("error", (error) => {
      clearTimeout(startupTimer);
      serverProcess = null;

      if (!startupComplete) {
        startupComplete = true;
        reject(error);
      }
    });

    serverProcess.on("exit", (code, signal) => {
      clearTimeout(startupTimer);
      serverProcess = null;

      console.error(
        `[ROME] Server exited. Code: ${code}; signal: ${signal}`
      );

      if (!startupComplete) {
        startupComplete = true;

        const details =
          stderrOutput.trim() ||
          `The server exited with code ${code ?? "unknown"}.`;

        reject(
          new Error(
            `ROME server stopped before startup completed.\n\n${details}`
          )
        );
      }
    });
  });
}

// ── Main window ───────────────────────────────────────────────────────────

async function createWindow(): Promise<void> {
  // Never create a duplicate BrowserWindow.
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.show();
    mainWindow.focus();
    return;
  }

  const window = new BrowserWindow({
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
    titleBarStyle:
      process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: {
      x: 16,
      y: 16,
    },
    show: false,
  });

  mainWindow = window;

  window.once("ready-to-show", () => {
    if (!window.isDestroyed()) {
      window.show();
      window.focus();
    }
  });

  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  /*
   * Prevent window.open() or target="_blank" links from
   * creating additional Electron BrowserWindows.
   */
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  try {
    await window.loadURL(`http://localhost:${SERVER_PORT}`);
  } catch (error) {
    if (!window.isDestroyed()) {
      window.destroy();
    }

    throw error;
  }
}

// ── IPC handlers ──────────────────────────────────────────────────────────

ipcMain.handle("get-data-dir", () => getDataDir());
ipcMain.handle("get-db-path", () => getDbPath());
ipcMain.handle("get-app-version", () => app.getVersion());

// ── App lifecycle ─────────────────────────────────────────────────────────

if (!gotSingleInstanceLock) {
  /*
   * Another ROME instance already owns the application lock.
   * Exit this instance immediately.
   */
  app.quit();
} else {
  app.on("second-instance", () => {
    /*
     * A second launch should focus the existing window,
     * not create another application or server.
     */
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.show();
    mainWindow.focus();
  });

  app
    .whenReady()
    .then(async () => {
      try {
        console.log("[ROME] Starting server...");
        await startServer();

        console.log("[ROME] Server ready, opening window...");
        await createWindow();
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "An unknown startup error occurred.";

        console.error("[ROME] Startup failed:", error);

        dialog.showErrorBox(
          "ROME — Startup Failed",
          `ROME could not start:\n\n${message}`
        );

        app.quit();
        return;
      }

      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          void createWindow().catch((error) => {
            console.error("[ROME] Failed to reopen window:", error);
          });

          return;
        }

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
        }
      });
    })
    .catch((error) => {
      console.error("[ROME] Application initialization failed:", error);
      app.quit();
    });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (serverProcess) {
    console.log("[ROME] Stopping server process...");
    serverProcess.kill();
    serverProcess = null;
  }
});
