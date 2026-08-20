import path from "node:path";
import {
  DEFAULT_CONSOLE_SHORTCUT,
  DEFAULT_CONVERSATION_SHORTCUT,
  normalizeAkiraShortcut,
  type AkiraPublicSettings,
  type AkiraSecretName,
  type AkiraSettings,
} from "../../shared/akira";
import { ensurePrivateDirectory, readJson, writeJsonAtomic } from "./json-store";

export interface SecureCipher {
  isAvailable(): boolean;
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
}

export const DEFAULT_AKIRA_SETTINGS: AkiraSettings = {
  appearance: {
    showTranscript: true,
    reduceMotion: false,
    intensity: 0.75,
    animationStrength: 0.65,
  },
  voice: {
    enabled: true,
    voiceId: "21m00Tcm4TlvDq8ikWAM",
    modelId: "eleven_flash_v2_5",
    stability: 0.42,
    similarityBoost: 0.76,
    speed: 1,
    volume: 0.85,
  },
  input: {
    wakeWordEnabled: true,
    microphoneId: "",
    sttModel: "base",
    silenceMs: 950,
    wakeSensitivity: 0.65,
    wakeWhenUnfocused: false,
    bargeInEnabled: true,
    wakeKeywordPath: "akira/akira.onnx",
    wakeMelPath: "akira/melspectrogram.onnx",
    wakeEmbeddingPath: "akira/embedding_model.onnx",
    wakeThreshold: 0.5,
    conversationShortcut: DEFAULT_CONVERSATION_SHORTCUT,
    consoleShortcut: DEFAULT_CONSOLE_SHORTCUT,
  },
  realtime: {
    agentId: "",
    greetingEnabled: true,
    greetingText: "Yes?",
    greetingDelayMs: 1_200,
    shareLiveContext: true,
    idleTimeoutMs: 20_000,
  },
  agent: { provider: "openai", model: "gpt-5-mini", effort: "medium" },
  privacy: {
    allowActivePageReading: false,
    retainActivityDays: 30,
    includeRecentWorkspaceContext: true,
  },
  permissions: {},
};

/**
 * Keys written by Akira V2 that V3 no longer owns. The gradient moved to the
 * Constellation layout (the renderer draws it, so the renderer stores it), the
 * aura is gone, and the shortcut is now a validated accelerator pair. Dropping
 * them keeps `settings.json` honest instead of accumulating dead state.
 */
const LEGACY_SETTING_KEYS = {
  appearance: ["auraSize", "gradientA", "gradientB"],
  input: ["deactivationShortcut"],
} as const;

function stripLegacy<T extends Record<string, unknown>>(value: T | undefined, keys: readonly string[]): T | undefined {
  if (!value || typeof value !== "object") return value;
  const copy: Record<string, unknown> = { ...value };
  for (const key of keys) delete copy[key];
  return copy as T;
}

function mergeSettings(value: Partial<AkiraSettings>): AkiraSettings {
  const appearance = stripLegacy(value.appearance as Record<string, unknown> | undefined, LEGACY_SETTING_KEYS.appearance);
  const input = stripLegacy(value.input as Record<string, unknown> | undefined, LEGACY_SETTING_KEYS.input);
  const merged: AkiraSettings = {
    appearance: { ...DEFAULT_AKIRA_SETTINGS.appearance, ...appearance },
    voice: { ...DEFAULT_AKIRA_SETTINGS.voice, ...value.voice },
    input: { ...DEFAULT_AKIRA_SETTINGS.input, ...input },
    realtime: { ...DEFAULT_AKIRA_SETTINGS.realtime, ...value.realtime },
    agent: { ...DEFAULT_AKIRA_SETTINGS.agent, ...value.agent },
    privacy: { ...DEFAULT_AKIRA_SETTINGS.privacy, ...value.privacy },
    permissions: { ...DEFAULT_AKIRA_SETTINGS.permissions, ...value.permissions },
  };
  merged.input.conversationShortcut = normalizeAkiraShortcut(merged.input.conversationShortcut, DEFAULT_CONVERSATION_SHORTCUT);
  merged.input.consoleShortcut = normalizeAkiraShortcut(merged.input.consoleShortcut, DEFAULT_CONSOLE_SHORTCUT);
  // Both shortcuts landing on the same accelerator would make one unreachable.
  if (merged.input.consoleShortcut === merged.input.conversationShortcut) {
    merged.input.consoleShortcut = DEFAULT_CONSOLE_SHORTCUT === merged.input.conversationShortcut
      ? DEFAULT_CONVERSATION_SHORTCUT
      : DEFAULT_CONSOLE_SHORTCUT;
  }
  return merged;
}

export class AkiraSettingsStore {
  private readonly settingsFile: string;
  private readonly secretsFile: string;
  private settings: AkiraSettings;

  constructor(private readonly root: string, private readonly cipher: SecureCipher) {
    ensurePrivateDirectory(root);
    this.settingsFile = path.join(root, "settings.json");
    this.secretsFile = path.join(root, "secrets.enc.json");
    this.settings = mergeSettings(readJson<Partial<AkiraSettings>>(this.settingsFile, {}));
  }

  get(): AkiraSettings {
    return structuredClone(this.settings);
  }

  publicSettings(): AkiraPublicSettings {
    const providerSecret: AkiraSecretName = `${this.settings.agent.provider}ApiKey` as AkiraSecretName;
    return {
      ...this.get(),
      secrets: {
        elevenLabsConfigured: Boolean(this.getSecret("elevenLabsApiKey")),
        providerConfigured: Boolean(this.getSecret(providerSecret)),
        secureStorageAvailable: this.cipher.isAvailable(),
      },
    };
  }

  update(patch: Partial<AkiraSettings>): AkiraSettings {
    this.settings = mergeSettings({
      ...this.settings,
      ...patch,
      appearance: { ...this.settings.appearance, ...patch.appearance },
      voice: { ...this.settings.voice, ...patch.voice },
      input: { ...this.settings.input, ...patch.input },
      agent: { ...this.settings.agent, ...patch.agent },
      privacy: { ...this.settings.privacy, ...patch.privacy },
      permissions: { ...this.settings.permissions, ...patch.permissions },
    });
    writeJsonAtomic(this.settingsFile, this.settings);
    return this.get();
  }

  setSecret(name: AkiraSecretName, value: string): void {
    if (!this.cipher.isAvailable()) {
      throw new Error("Secure credential storage is unavailable on this system. Use a process environment variable instead.");
    }
    const values = readJson<Record<string, string>>(this.secretsFile, {});
    if (value.trim()) values[name] = this.cipher.encrypt(value.trim()).toString("base64");
    else delete values[name];
    writeJsonAtomic(this.secretsFile, values);
  }

  getSecret(name: AkiraSecretName): string | null {
    const environmentNames: Record<AkiraSecretName, string> = {
      elevenLabsApiKey: "ELEVENLABS_API_KEY",
      openaiApiKey: "OPENAI_API_KEY",
      anthropicApiKey: "ANTHROPIC_API_KEY",
      openrouterApiKey: "OPENROUTER_API_KEY",
    };
    const fromEnvironment = process.env[environmentNames[name]]?.trim();
    if (fromEnvironment) return fromEnvironment;
    if (!this.cipher.isAvailable()) return null;
    const encoded = readJson<Record<string, string>>(this.secretsFile, {})[name];
    if (!encoded) return null;
    try { return this.cipher.decrypt(Buffer.from(encoded, "base64")); } catch { return null; }
  }
}
