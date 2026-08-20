export const AKIRA_STATES = [
  "DORMANT",
  "WAKE_DETECTED",
  "LISTENING",
  "PROCESSING",
  "SPEAKING",
  "ACTING",
  "AWAITING_APPROVAL",
  "AWAKE_IDLE",
  "DEACTIVATING",
  "ERROR",
  "UNAVAILABLE",
] as const;

export type AkiraState = (typeof AKIRA_STATES)[number];

export type AkiraRuntimePhase =
  | "idle"
  | "discovering"
  | "starting"
  | "ready"
  | "degraded"
  | "installing"
  | "stopped";

export interface AkiraRuntimeStatus {
  phase: AkiraRuntimePhase;
  executable: string | null;
  port: number | null;
  version: string | null;
  restartCount: number;
  message: string | null;
  updatedAt: number;
}

/**
 * Akira keyboard shortcuts.
 *
 * V2 baked "Control+Escape" into the type system, so changing it meant editing
 * four files that each had to agree. These are validated strings instead.
 * Accelerators use Electron syntax so one literal works in the renderer, in
 * `before-input-event`, and in any future `globalShortcut` registration.
 */
export const AKIRA_SHORTCUT_CHOICES = [
  "Command+'",
  "Command+Shift+'",
  "Command+/",
  "Control+'",
  "Control+Shift+'",
] as const;

export type AkiraShortcut = (typeof AKIRA_SHORTCUT_CHOICES)[number];

export const DEFAULT_CONVERSATION_SHORTCUT: AkiraShortcut = "Command+'";
export const DEFAULT_CONSOLE_SHORTCUT: AkiraShortcut = "Command+Shift+'";

export interface AkiraShortcutParts {
  meta: boolean;
  control: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

/** Parse an Electron-style accelerator into the flags a key event exposes. */
export function parseAkiraShortcut(value: string): AkiraShortcutParts {
  const segments = String(value).split("+").map(part => part.trim()).filter(Boolean);
  const parts: AkiraShortcutParts = { meta: false, control: false, shift: false, alt: false, key: "" };
  for (const segment of segments) {
    const normalized = segment.toLowerCase();
    if (normalized === "command" || normalized === "cmd" || normalized === "meta" || normalized === "super") parts.meta = true;
    else if (normalized === "control" || normalized === "ctrl") parts.control = true;
    else if (normalized === "commandorcontrol" || normalized === "cmdorctrl") { parts.meta = true; parts.control = true; }
    else if (normalized === "shift") parts.shift = true;
    else if (normalized === "alt" || normalized === "option") parts.alt = true;
    else parts.key = segment;
  }
  return parts;
}

/**
 * Physical key codes for the punctuation we bind.
 *
 * `event.key` reports the *produced character*, which shifts: holding Shift
 * turns `'` into `"` and `/` into `?` on a US layout. Matching on `key` alone
 * means `Command+Shift+'` never fires, which is silent and maddening. `code`
 * names the physical key and is layout- and Shift-stable, so we accept either.
 */
const SHORTCUT_KEY_CODES: Record<string, string> = {
  "'": "Quote",
  '"': "Quote",
  "/": "Slash",
  "?": "Slash",
  ";": "Semicolon",
  "\\": "Backslash",
  "[": "BracketLeft",
  "]": "BracketRight",
};

function keyMatches(
  expected: string,
  event: { key: string; code?: string },
): boolean {
  if (String(event.key).toLowerCase() === expected.toLowerCase()) return true;
  const expectedCode = SHORTCUT_KEY_CODES[expected];
  return Boolean(expectedCode && event.code === expectedCode);
}

/**
 * Does this key event match the accelerator?
 *
 * Modifiers must match exactly, so `Command+'` never fires on `Command+Shift+'`.
 * `CommandOrControl` is the one exception and accepts either.
 */
export function matchesAkiraShortcut(
  accelerator: string,
  event: {
    key: string;
    code?: string;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
  },
): boolean {
  const parts = parseAkiraShortcut(accelerator);
  if (!parts.key) return false;
  if (!keyMatches(parts.key, event)) return false;
  if (Boolean(event.shiftKey) !== parts.shift) return false;
  if (Boolean(event.altKey) !== parts.alt) return false;
  if (parts.meta && parts.control) return Boolean(event.metaKey || event.ctrlKey);
  return Boolean(event.metaKey) === parts.meta && Boolean(event.ctrlKey) === parts.control;
}

export function normalizeAkiraShortcut(value: unknown, fallback: AkiraShortcut): AkiraShortcut {
  return (AKIRA_SHORTCUT_CHOICES as readonly string[]).includes(String(value))
    ? (String(value) as AkiraShortcut)
    : fallback;
}

export interface AkiraSettings {
  appearance: {
    showTranscript: boolean;
    reduceMotion: boolean;
    intensity: number;
    animationStrength: number;
  };
  voice: {
    enabled: boolean;
    voiceId: string;
    modelId: string;
    stability: number;
    similarityBoost: number;
    speed: number;
    volume: number;
  };
  input: {
    wakeWordEnabled: boolean;
    microphoneId: string;
    sttModel: "tiny" | "base";
    silenceMs: number;
    wakeSensitivity: number;
    wakeWhenUnfocused: boolean;
    bargeInEnabled: boolean;
    /**
     * Files served from client/public. Detection runs on-device via Picovoice
     * Porcupine, fed from ROME's existing microphone rather than opening a
     * second one.
     */
    wakeKeywordPath: string;
    wakeModelPath: string;
    /** Toggles the conversation on and off. Default `Command+'`. */
    conversationShortcut: AkiraShortcut;
    /** Summons the Akira console. Default `Command+Shift+'`. */
    consoleShortcut: AkiraShortcut;
  };
  /**
   * ElevenLabs Agents realtime conversation. This is the live loop as of V3;
   * `agent` below now only configures Hermes, which handles background
   * deep-work delegation and is entirely optional.
   */
  realtime: {
    /** `agent_…` from the ElevenLabs dashboard. Empty disables voice. */
    agentId: string;
    /** Speak a short acknowledgement when woken with no follow-up speech. */
    greetingEnabled: boolean;
    greetingText: string;
    /** How long to wait for continued speech before greeting. */
    greetingDelayMs: number;
    /** Send route changes and data updates as non-interrupting context. */
    shareLiveContext: boolean;
  };
  agent: {
    provider: "openai" | "anthropic" | "openrouter";
    model: string;
    effort: "low" | "medium" | "high";
  };
  privacy: {
    allowActivePageReading: boolean;
    retainActivityDays: number;
    includeRecentWorkspaceContext: boolean;
  };
  permissions: Record<string, "ask" | "allow" | "deny">;
}

export interface AkiraPublicSettings extends AkiraSettings {
  secrets: {
    picovoiceConfigured: boolean;
    elevenLabsConfigured: boolean;
    providerConfigured: boolean;
    secureStorageAvailable: boolean;
  };
}

export type AkiraSecretName =
  | "picovoiceAccessKey"
  | "elevenLabsApiKey"
  | "openaiApiKey"
  | "anthropicApiKey"
  | "openrouterApiKey";

export interface AkiraStatus {
  state: AkiraState;
  previousState: AkiraState | null;
  active: boolean;
  available: boolean;
  reason: string | null;
  runtime: AkiraRuntimeStatus;
  settings: AkiraPublicSettings;
  sessionId: string | null;
  lastUserText: string;
  lastAssistantText: string;
  updatedAt: number;
}

export type AkiraRisk = "read" | "write" | "destructive" | "financial";
export type AkiraVisualBehavior = "background" | "navigate" | "overlay";

export interface AkiraCapabilityDescriptor {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  risk: AkiraRisk;
  visual: AkiraVisualBehavior;
  queryKeys: string[][];
  localStores: string[];
  supportsUndo: boolean;
}

export interface AkiraApprovalRequest {
  id: string;
  capability: string;
  title: string;
  summary: string;
  risk: AkiraRisk;
  arguments: Record<string, unknown>;
  createdAt: number;
  expiresAt: number;
}

export interface AkiraActivityEntry {
  id: string;
  profileId: number | null;
  capability: string;
  summary: string;
  risk: AkiraRisk;
  status: "completed" | "denied" | "failed" | "undone";
  createdAt: number;
  finishedAt: number;
  undoId?: string;
  error?: string;
}

export interface AkiraDataChanged {
  source: string;
  queryKeys: string[][];
  localStores: string[];
  changedAt: number;
}

export interface AkiraRendererCommand {
  id: string;
  action: string;
  args: Record<string, unknown>;
  createdAt: number;
}

export interface AkiraRendererCommandResult {
  id: string;
  ok: boolean;
  value?: unknown;
  error?: string;
}

export interface AkiraAudioEvent {
  type: "start" | "chunk" | "end" | "cancel";
  audio?: string;
  sampleRate?: number;
}

export interface AkiraTranscriptEvent {
  role: "user" | "assistant" | "system";
  text: string;
  final: boolean;
  at: number;
}

export interface AkiraContextSnapshot {
  capturedAt: number;
  route: string;
  profile: Record<string, unknown> | null;
  browser: {
    active: Record<string, unknown> | null;
    tabs: Array<Record<string, unknown>>;
  };
  workspace: {
    boards: unknown[];
    tasks: unknown[];
    today: unknown[];
    notes: unknown[];
    memory: unknown[];
    local: Record<string, unknown>;
  };
}

export const AKIRA_CHANNELS = {
  status: "rome:akira:status",
  transcript: "rome:akira:transcript",
  audio: "rome:akira:audio",
  approval: "rome:akira:approval",
  dataChanged: "rome:akira:data-changed",
  rendererCommand: "rome:akira:renderer-command",
  wakeDetected: "rome:akira:wake-detected",
  /** Server-side voice activity, used to make the ambience breathe. */
  vad: "rome:akira:vad",
} as const;
