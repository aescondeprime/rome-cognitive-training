import path from "node:path";
import type { AkiraPublicSettings, AkiraSecretName, AkiraSettings } from "../../shared/akira";
import { ensurePrivateDirectory, readJson, writeJsonAtomic } from "./json-store";

export interface SecureCipher {
  isAvailable(): boolean;
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
}

export const DEFAULT_AKIRA_SETTINGS: AkiraSettings = {
  appearance: {
    auraSize: "standard",
    showTranscript: true,
    reduceMotion: false,
    gradientA: "#67e8f9",
    gradientB: "#a78bfa",
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
    deactivationShortcut: "Control+Escape",
  },
  agent: { provider: "openai", model: "gpt-5-mini", effort: "medium" },
  privacy: {
    allowActivePageReading: false,
    retainActivityDays: 30,
    includeRecentWorkspaceContext: true,
  },
  permissions: {},
};

function mergeSettings(value: Partial<AkiraSettings>): AkiraSettings {
  return {
    appearance: { ...DEFAULT_AKIRA_SETTINGS.appearance, ...value.appearance },
    voice: { ...DEFAULT_AKIRA_SETTINGS.voice, ...value.voice },
    input: { ...DEFAULT_AKIRA_SETTINGS.input, ...value.input },
    agent: { ...DEFAULT_AKIRA_SETTINGS.agent, ...value.agent },
    privacy: { ...DEFAULT_AKIRA_SETTINGS.privacy, ...value.privacy },
    permissions: { ...DEFAULT_AKIRA_SETTINGS.permissions, ...value.permissions },
  };
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
