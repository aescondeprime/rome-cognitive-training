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

export interface AkiraSettings {
  appearance: {
    auraSize: "compact" | "standard" | "large";
    showTranscript: boolean;
    reduceMotion: boolean;
    gradientA: string;
    gradientB: string;
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
    deactivationShortcut: "Control+Escape" | "Control+Shift+Escape";
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
} as const;
