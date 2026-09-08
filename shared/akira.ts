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
  /**
   * Schema version of the stored settings.
   *
   * Stored settings win over defaults — which is right for anything the user
   * chose, and wrong for internal timings they have never seen. Without a
   * version, a default fixed in code never reaches a machine that has run the
   * app once: `toolDeadlineMs` stayed at the old 9 seconds on every existing
   * install while the source said 3.5.
   */
  settingsVersion: number;
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
     * openWakeWord ONNX models served from client/public. Detection runs
     * on-device, fed from ROME's existing microphone rather than opening a
     * second one. Only `wakeKeywordPath` is specific to the wake word.
     */
    wakeKeywordPath: string;
    wakeMelPath: string;
    wakeEmbeddingPath: string;
    /** 0-1; higher is stricter. */
    wakeThreshold: number;
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
    /**
     * Close a conversation nobody is having.
     *
     * Matters because conversations bill per minute and the wake word has a
     * real false-positive rate: without this, a spurious trigger at 2am leaves
     * the meter running until morning. 0 disables it.
     */
    idleTimeoutMs: number;
    /**
     * The same, during a focus cycle.
     *
     * A cycle is the case where the socket is opened for one question and
     * should shut again immediately — you are working, not conversing, and
     * every second of held silence is billed. Falls back to `idleTimeoutMs`
     * when 0.
     */
    focusIdleTimeoutMs: number;
    /**
     * How long a closed conversation stays resumable.
     *
     * Silence ends the socket, not the thread. Speak again inside this window
     * and the last few exchanges are compiled back into the prompt, so "put
     * that one on Thursday too" still means something. 0 disables it.
     */
    resumeWindowMs: number;
  };
  /**
   * When Akira may act without stopping to ask.
   *
   * V3 gated every [write] behind a modal that waits up to 90 seconds — far
   * longer than ElevenLabs will hold a client tool call open, so a spoken
   * "schedule that for Thursday" timed out before the dialog could be answered.
   */
  approvals: {
    /**
     * Perform write capabilities that record an undo entry without asking.
     *
     * The safety net is undo plus the Activity log, not a dialog. Destructive
     * and financial capabilities always ask, and a per-capability "ask"
     * override still wins.
     */
    autoApproveReversibleWrites: boolean;
    /**
     * How long a capability may run before the agent is told it is still
     * working. Anything slower reports back through a context update instead
     * of holding the tool call open past the socket's own timeout.
     */
    toolDeadlineMs: number;
  };
  /**
   * Answering questions that need the open web.
   *
   * Routed through OpenAI's Responses API with its built-in web search rather
   * than the ElevenLabs agent, which has no web access — and billed as tokens,
   * so asking a question mid-focus-cycle costs cents rather than conversation
   * minutes. Uses the OpenAI key ROME already stores.
   */
  research: {
    enabled: boolean;
    model: string;
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
    elevenLabsConfigured: boolean;
    providerConfigured: boolean;
    secureStorageAvailable: boolean;
  };
}

export type AkiraSecretName =
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
  /**
   * `speak` is the fallback voice: no audio, just a line for the renderer to
   * read with the operating system's own speech synthesiser. Used when
   * ElevenLabs cannot synthesise — a focus warning in the system voice is
   * worth far more than a warning that silently never happens.
   */
  type: "start" | "chunk" | "end" | "cancel" | "speak";
  audio?: string;
  sampleRate?: number;
  text?: string;
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

/**
 * A running focus cycle, as the main process sees it.
 *
 * Sent from the renderer, which owns the cycle: it lives in localStorage, and
 * the main process needs only enough of it to shorten the silence leash and to
 * tell Akira what the user is working on.
 */
export interface AkiraFocusState {
  taskName: string;
  remainingSeconds: number;
  paused: boolean;
  awaitingAnswer: boolean;
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

/**
 * Is this the whole utterance a request to end the conversation?
 *
 * Matched here rather than left to the agent so it lands instantly, mid-
 * sentence if need be, and costs no turn. Deliberately anchored to the entire
 * utterance: "standby" inside a sentence about standby modes is not a command.
 * Speech recognition writes it as one word or two, and often adds a name or a
 * politeness on either end, so both are absorbed.
 */
export function isStandbyCommand(value: string): boolean {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return false;
  const core = normalized
    .replace(/^(ok|okay|alright|hey|yo|and|well|thanks|thank you)\s+/g, "")
    .replace(/^akira\s+/, "")
    .replace(/\s+(akira|please|now|for now|thanks|thank you)$/g, "")
    .trim();
  return new Set([
    "standby", "stand by", "on standby", "go to standby", "go on standby", "go into standby",
    "deactivate", "stand down", "go dormant", "go to sleep",
    "that will be all", "that is all", "that s all", "thats all",
  ]).has(core);
}

/**
 * Find the records a spoken name refers to.
 *
 * Voice never produces an id, and rarely produces an exact title — "mark the
 * dentist thing done" has to reach "Call the dentist". Matching walks from
 * exact to loose and stops at the first tier that hits, so a precise name is
 * never widened into a pile of near-misses; only a genuinely ambiguous one
 * returns several, which the caller turns into a question.
 */
export function matchByLabel<T>(values: T[], label: string, read: (value: T) => string): T[] {
  const wanted = normalizeLabel(label);
  if (!wanted) return [];
  const entries = values.map(value => ({ value, text: normalizeLabel(read(value)) })).filter(entry => entry.text);
  const tiers: ((text: string) => boolean)[] = [
    text => text === wanted,
    text => text.startsWith(wanted) || wanted.startsWith(text),
    text => text.includes(wanted) || wanted.includes(text),
    text => {
      const words = wanted.split(" ").filter(word => word.length > 2);
      if (!words.length) return false;
      const other = new Set(text.split(" "));
      const shared = words.filter(word => other.has(word)).length;
      return shared / words.length >= 0.6;
    },
  ];
  for (const tier of tiers) {
    const matches = entries.filter(entry => tier(entry.text));
    if (matches.length) return matches.map(entry => entry.value);
  }
  return [];
}

/** Lowercase, strip punctuation, drop the filler words speech adds. */
export function normalizeLabel(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(the|a|an|my|please)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
