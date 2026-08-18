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
import net from "net";
import { BrowserController } from "./browser/browser-controller";
import { registerBrowserIpc } from "./browser/browser-ipc";
import { AkiraController } from "./akira/controller";
import { registerAkiraIpc } from "./akira/akira-ipc";
import {
  DEFAULT_CONSOLE_SHORTCUT,
  DEFAULT_CONVERSATION_SHORTCUT,
} from "../shared/akira";

declare const __dirname: string;

// ── Application state ─────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
let browserController: BrowserController | null = null;
let akiraController: AkiraController | null = null;
let serverProcess: ChildProcess | null = null;
let isQuitting = false;

registerBrowserIpc(() => browserController);
registerAkiraIpc(() => akiraController);

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

// ── Load .env file ────────────────────────────────────────────────────────

function loadEnvFile(): Record<string, string> {
  const envPaths = [
    path.join(getDataDir(), ".env"),
    path.join(process.resourcesPath, ".env"),
    path.join(process.cwd(), ".env"),
  ];

  for (const envPath of envPaths) {
    if (!fs.existsSync(envPath)) {
      continue;
    }

    const content = fs.readFileSync(envPath, "utf-8");
    const vars: Record<string, string> = {};

    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const equalsIndex = trimmed.indexOf("=");

      if (equalsIndex === -1) {
        continue;
      }

      const key = trimmed.slice(0, equalsIndex).trim();
      const value = trimmed
        .slice(equalsIndex + 1)
        .trim()
        .replace(/^["']|["']$/g, "");

      if (key) {
        vars[key] = value;
      }
    }

    console.log(`[ROME] Loaded environment file: ${envPath}`);
    return vars;
  }

  console.warn(
    "[ROME] No .env file found; server will use process environment"
  );

  return {};
}

// ── Express server ────────────────────────────────────────────────────────

const SERVER_PORT = 5000;

function getServerEntry(): string {
  if (app.isPackaged) {
    /*
     * electron-builder places files matched by asarUnpack here:
     *
     * macOS:
     * ROME.app/Contents/Resources/app.asar.unpacked/dist/index.cjs
     *
     * Windows:
     * resources/app.asar.unpacked/dist/index.cjs
     */
    return path.join(
      process.resourcesPath,
      "app.asar.unpacked",
      "dist",
      "index.cjs"
    );
  }

  /*
   * Development/compiled structure:
   *
   * dist-electron/main.js
   * dist/index.cjs
   */
  return path.join(
    __dirname,
    "..",
    "dist",
    "index.cjs"
  );
}

function waitForServer(
  port: number,
  timeoutMs = 15000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    let settled = false;

    const attemptConnection = () => {
      if (settled) {
        return;
      }

      const socket = net.createConnection({
        host: "127.0.0.1",
        port,
      });

      let attemptFinished = false;

      const retry = (error: Error) => {
        if (attemptFinished || settled) {
          return;
        }

        attemptFinished = true;
        socket.destroy();

        if (Date.now() >= deadline) {
          settled = true;

          reject(
            new Error(
              `ROME server did not begin listening on port ${port} ` +
                `within ${timeoutMs / 1000} seconds.\n\n` +
                `Last connection error: ${error.message}`
            )
          );

          return;
        }

        setTimeout(attemptConnection, 250);
      };

      socket.setTimeout(1000);

      socket.once("connect", () => {
        if (attemptFinished || settled) {
          return;
        }

        attemptFinished = true;
        settled = true;

        socket.end();
        resolve();
      });

      socket.once("timeout", () => {
        retry(new Error("Connection timed out"));
      });

      socket.once("error", (error) => {
        retry(error);
      });
    };

    attemptConnection();
  });
}

async function startServer(): Promise<void> {
  if (serverProcess && !serverProcess.killed) {
    console.log("[ROME] Server process already exists");
    await waitForServer(SERVER_PORT);
    return;
  }

  const serverEntry = getServerEntry();
  const serverWorkingDirectory = path.dirname(serverEntry);

  console.log("[ROME] Packaged:", app.isPackaged);
  console.log("[ROME] Resources path:", process.resourcesPath);
  console.log("[ROME] Server entry:", serverEntry);
  console.log(
    "[ROME] Server working directory:",
    serverWorkingDirectory
  );

  if (!fs.existsSync(serverEntry)) {
    throw new Error(
      `Server bundle was not found at:\n\n${serverEntry}\n\n` +
        "Confirm that electron-builder.yml contains:\n\n" +
        "asarUnpack:\n" +
        '  - "dist/**/*"'
    );
  }

  const entryStats = fs.statSync(serverEntry);

  if (!entryStats.isFile()) {
    throw new Error(
      `The server entry exists but is not a file:\n\n${serverEntry}`
    );
  }

  if (!fs.existsSync(serverWorkingDirectory)) {
    throw new Error(
      `Server working directory does not exist:\n\n` +
        serverWorkingDirectory
    );
  }

  const workingDirectoryStats = fs.statSync(
    serverWorkingDirectory
  );

  if (!workingDirectoryStats.isDirectory()) {
    throw new Error(
      `Server working path is not a directory:\n\n` +
        serverWorkingDirectory
    );
  }

  const envVars = loadEnvFile();
  let stderrOutput = "";
  let serverReady = false;

  /*
   * process.execPath normally points to the packaged ROME executable.
   * ELECTRON_RUN_AS_NODE makes that executable run index.cjs as Node
   * instead of opening another copy of ROME.
   */
  const child = spawn(process.execPath, [serverEntry], {
    cwd: serverWorkingDirectory,

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

  serverProcess = child;

  child.stdout?.on("data", (data: Buffer) => {
    const message = data.toString().trim();

    if (message) {
      console.log("[server]", message);
    }
  });

  child.stderr?.on("data", (data: Buffer) => {
    const message = data.toString();

    stderrOutput += message;

    if (message.trim()) {
      console.error("[server err]", message.trim());
    }
  });

  const earlyFailure = new Promise<never>((_, reject) => {
    child.once("error", (error) => {
      if (serverProcess === child) {
        serverProcess = null;
      }

      reject(
        new Error(
          `Could not launch the ROME server process.\n\n${error.message}`
        )
      );
    });

    child.once("exit", (code, signal) => {
      if (serverProcess === child) {
        serverProcess = null;
      }

      const details =
        stderrOutput.trim() ||
        `Exit code: ${code ?? "unknown"}\n` +
          `Signal: ${signal ?? "none"}`;

      if (!serverReady) {
        reject(
          new Error(
            `ROME server stopped before startup completed.\n\n${details}`
          )
        );

        return;
      }

      if (!isQuitting) {
        console.error(
          "[ROME] Server stopped unexpectedly:",
          details
        );

        dialog.showErrorBox(
          "ROME — Server Stopped",
          `The local ROME server stopped unexpectedly.\n\n${details}`
        );

        app.quit();
      }
    });
  });

  const readinessCheck = waitForServer(SERVER_PORT).then(() => {
    serverReady = true;
  });

  await Promise.race([
    readinessCheck,
    earlyFailure,
  ]);

  console.log(
    `[ROME] Server is listening on port ${SERVER_PORT}`
  );
}

// ── Main window ───────────────────────────────────────────────────────────

async function createWindow(): Promise<void> {
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
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },

    titleBarStyle:
      process.platform === "darwin"
        ? "hiddenInset"
        : "default",

    trafficLightPosition: {
      x: 16,
      y: 16,
    },

    show: false,
  });

  const isTrustedShellUrl = (value: string) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port === String(SERVER_PORT);
    } catch {
      return false;
    }
  };

  mainWindow = window;
  window.webContents.session.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
    if (permission !== "media" || !contents || contents.id !== window.webContents.id) return false;
    if (!isTrustedShellUrl(details.requestingUrl || details.securityOrigin || requestingOrigin || contents.getURL())) return false;
    const mediaType = "mediaType" in details ? details.mediaType : undefined;
    return !mediaType || mediaType === "audio" || mediaType === "unknown";
  });
  window.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => {
    const mediaTypes = "mediaTypes" in details ? details.mediaTypes ?? [] : [];
    const trusted = contents.id === window.webContents.id && isTrustedShellUrl(details.requestingUrl || contents.getURL());
    const microphoneOnly = permission === "media" && mediaTypes.length > 0 && mediaTypes.every(type => type === "audio");
    callback(trusted && microphoneOnly);
  });
  akiraController = new AkiraController({
    root: path.join(getDataDir(), "Akira"),
    mcpEntry: app.isPackaged
      ? path.join(process.resourcesPath, "app.asar.unpacked", "dist-electron", "akira-mcp.cjs")
      : path.join(__dirname, "akira-mcp.cjs"),
    getWindow: () => mainWindow,
    getBrowser: () => browserController,
    electronExecutable: process.execPath,
  });
  browserController = new BrowserController(
    window,
    getDataDir(),
    () => {
      const input = akiraController?.status().settings.input;
      return {
        conversation: input?.conversationShortcut ?? DEFAULT_CONVERSATION_SHORTCUT,
        console: input?.consoleShortcut ?? DEFAULT_CONSOLE_SHORTCUT,
      };
    },
  );
  void akiraController.initialize().catch((error) => {
    console.error("[Akira] Background initialization failed:", error);
  });

  const keepShellOnTrustedOrigin = (event: Electron.Event, url: string) => {
    if (isTrustedShellUrl(url)) return;
    event.preventDefault();
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") void shell.openExternal(url);
    } catch {
      // Invalid/non-web protocols stay blocked.
    }
  };

  // The preload bridge belongs only to ROME's local React shell. A normal
  // navigation or server redirect must never carry that bridge to a website.
  window.webContents.on("will-navigate", keepShellOnTrustedOrigin);
  window.webContents.on("will-redirect", keepShellOnTrustedOrigin);

// ── TEMPORARY RENDERER DIAGNOSTICS ──────────────────────────────────────


// Capture console.log / console.error from the React renderer.
window.webContents.on("console-message", (details) => {
  console.log(
    `[renderer:${details.level}] ${details.message} ` +
      `(${details.sourceId}:${details.lineNumber})`
  );
});

// Detect preload script failures.
window.webContents.on(
  "preload-error",
  (_event, preloadPath, error) => {
    dialog.showErrorBox(
      "ROME — Preload Error",
      [
        `Preload: ${preloadPath}`,
        "",
        error.stack || error.message,
      ].join("\n")
    );
  }
);

// Detect failures loading http://127.0.0.1:5000.
window.webContents.on(
  "did-fail-load",
  (
    _event,
    errorCode,
    errorDescription,
    validatedURL,
    isMainFrame
  ) => {
    if (!isMainFrame) return;

    dialog.showErrorBox(
      "ROME — Page Load Failed",
      [
        `URL: ${validatedURL}`,
        "",
        `Error ${errorCode}: ${errorDescription}`,
      ].join("\n")
    );
  }
);

// Detect an actual Chromium renderer crash.
window.webContents.on(
  "render-process-gone",
  (_event, details) => {
    dialog.showErrorBox(
      "ROME — Renderer Stopped",
      [
        `Reason: ${details.reason}`,
        `Exit code: ${details.exitCode}`,
      ].join("\n")
    );
  }
);

// Confirm that the HTML document itself loaded.
window.webContents.on("did-finish-load", () => {
  console.log(
    "[ROME] Renderer finished loading:",
    window.webContents.getURL()
  );
});

  window.once("ready-to-show", () => {
    if (!window.isDestroyed()) {
      window.show();
      window.focus();
    }
  });

  window.on("closed", () => {
    if (akiraController) {
      akiraController.shutdown();
      akiraController = null;
    }
    if (browserController) {
      browserController.dispose();
      browserController = null;
    }
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsedUrl = new URL(url);

      if (
        parsedUrl.protocol === "http:" ||
        parsedUrl.protocol === "https:" ||
        parsedUrl.protocol === "mailto:"
      ) {
        void shell.openExternal(url);
      }
    } catch (error) {
      console.error("[ROME] Invalid external URL:", error);
    }

    return {
      action: "deny",
    };
  });

  try {
    await window.loadURL(
      `http://127.0.0.1:${SERVER_PORT}`
    );
  } catch (error) {
    if (!window.isDestroyed()) {
      window.destroy();
    }

    throw error;
  }
}

// ── IPC handlers ──────────────────────────────────────────────────────────

function assertTrustedRenderer(event: Electron.IpcMainInvokeEvent): void {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event.sender.id !== mainWindow.webContents.id
  ) {
    throw new Error("Unauthorized IPC sender");
  }
}

ipcMain.handle("get-data-dir", (event) => {
  assertTrustedRenderer(event);
  return getDataDir();
});
ipcMain.handle("get-db-path", (event) => {
  assertTrustedRenderer(event);
  return getDbPath();
});
ipcMain.handle("get-app-version", (event) => {
  assertTrustedRenderer(event);
  return app.getVersion();
});

// ── App lifecycle ─────────────────────────────────────────────────────────

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      if (app.isReady()) {
        void createWindow().catch((error) => {
          console.error(
            "[ROME] Could not recreate the main window:",
            error
          );
        });
      }

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
        console.log("[ROME] Starting local server...");
        await startServer();

        console.log(
          "[ROME] Server ready; opening application window..."
        );

        await createWindow();
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

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
            console.error(
              "[ROME] Failed to reopen window:",
              error
            );
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
      console.error(
        "[ROME] Application initialization failed:",
        error
      );

      app.quit();
    });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  isQuitting = true;

  if (akiraController) {
    akiraController.shutdown();
    akiraController = null;
  }

  if (serverProcess) {
    console.log("[ROME] Stopping local server...");

    serverProcess.kill();
    serverProcess = null;
  }
});
