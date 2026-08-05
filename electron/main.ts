import {
  app,
  BrowserWindow,
  shell,
  ipcMain,
  dialog,
  utilityProcess,
} from "electron";
import path from "path";
import fs from "fs";

declare const __dirname: string;

// ── Application state ─────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
let serverProcess: ReturnType<typeof utilityProcess.fork> | null = null;

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
  // Prevent the application from starting a second server process.
  if (serverProcess) {
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
      reject(new Error("Server bundle not found"));
      return;
    }

    const envVars = loadEnvFile();

    let startupSettled = false;
    let startupTimer: NodeJS.Timeout | null = null;

    const finishStartup = () => {
      if (startupSettled) {
        return;
      }

      startupSettled = true;

      if (startupTimer) {
        clearTimeout(startupTimer);
        startupTimer = null;
      }

      resolve();
    };

    const failStartup = (error: Error) => {
      if (startupSettled) {
        return;
      }

      startupSettled = true;

      if (startupTimer) {
        clearTimeout(startupTimer);
        startupTimer = null;
      }

      reject(error);
    };

    try {
      /*
       * Run the Express server as an Electron utility process.
       *
       * This is the critical correction. Do not replace this with:
       *
       * spawn(process.execPath, [serverEntry])
       *
       * That can relaunch the packaged ROME executable recursively.
       */
      const child = utilityProcess.fork(serverEntry, [], {
        env: {
          ...process.env,
          ...envVars,
          NODE_ENV: "production",
          PORT: String(SERVER_PORT),
          ROME_DB_PATH: getDbPath(),
        },
        stdio: "pipe",
        serviceName: "ROME Server",
      });

      serverProcess = child;

      child.on("spawn", () => {
        console.log(`[ROME] Server process started. PID: ${child.pid}`);
      });

      child.stdout?.on("data", (data: Buffer) => {
        const message = data.toString().trim();

        if (!message) {
          return;
        }

        console.log("[server]", message);

        const normalizedMessage = message.toLowerCase();

        if (
          normalizedMessage.includes("listening") ||
          normalizedMessage.includes(String(SERVER_PORT)) ||
          normalizedMessage.includes("started") ||
          normalizedMessage.includes("ready")
        ) {
          finishStartup();
        }
      });

      child.stderr?.on("data", (data: Buffer) => {
        const message = data.toString().trim();

        if (message) {
          console.error("[server err]", message);
        }
      });

      child.on("exit", (code) => {
        console.log(`[ROME] Server process exited with code ${code}`);

        if (serverProcess === child) {
          serverProcess = null;
        }

        if (!startupSettled) {
          failStartup(
            new Error(
              `ROME server stopped before startup completed. Exit code: ${code}`
            )
          );
        }
      });

      /*
       * Preserve the original four-second fallback.
       * Ideally the server resolves earlier through its startup log.
       */
      startupTimer = setTimeout(() => {
        console.log(
          "[ROME] Server startup timeout reached; attempting to open application"
        );

        finishStartup();
      }, 4000);
    } catch (error) {
      const normalizedError =
        error instanceof Error
          ? error
          : new Error("Unknown server startup error");

      serverProcess = null;
      failStartup(normalizedError);
    }
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
