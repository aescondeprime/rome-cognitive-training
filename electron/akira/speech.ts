import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Everything Akira says outside a conversation.
 *
 * Two things need this: the wake-word acknowledgement, and the focus cycle's
 * warnings — five minutes, one minute, time's up. Neither is worth opening a
 * realtime socket for. Conversations bill by the minute; this bills by the
 * character, so a 25-minute cycle that you never speak during costs the price
 * of three short sentences.
 *
 * On the acknowledgement in particular:
 *
 * Deliberately not the agent's `first_message`, which fires on every
 * connection. "Akira, open my idea workshop" would then get answered with
 * "Yes?" before the workshop opened, which is exactly wrong: JARVIS answers a
 * bare summons and simply acts on an instruction. ROME decides instead, based
 * on whether speech followed the wake word.
 *
 * The clip is synthesised once and cached on disk, then played straight from
 * local audio. A round trip would cost ~600ms on the one utterance whose whole
 * job is to feel instant, and would burn conversation minutes for a single
 * word. The cache key includes the voice and the text, so changing either
 * re-renders automatically.
 */

const API_BASE = "https://api.elevenlabs.io";

/** ElevenLabs' own field names, so this passes straight through. */
export interface SpeechVoiceSettings {
  stability?: number;
  similarity_boost?: number;
  style?: number;
  speed?: number;
  use_speaker_boost?: boolean;
}

export interface SpeechOptions {
  root: string;
  apiKey: string;
  agentId: string;
  text: string;
  modelId?: string;
  /**
   * How the agent speaks, not just which voice it uses.
   *
   * A voice id alone gets the right larynx and the wrong delivery: the API
   * falls back to the voice's own defaults for stability, similarity and
   * speed, while the agent renders its conversation with whatever it was tuned
   * to. Same voice, faster and flatter — which is exactly what a warning
   * sounded like next to the conversation it interrupted.
   */
  voiceSettings?: SpeechVoiceSettings;

  /**
   * The voice from ROME's own settings.
   *
   * Used when the agent will not say which voice it uses. Reading it off the
   * agent keeps the two in step, but a key that cannot read the agent — the
   * wrong scope, a workspace-owned agent — used to mean no voice at all, and
   * therefore no wake acknowledgement and no focus warnings, silently.
   */
  fallbackVoiceId?: string;
}

export class AkiraSpeech {
  private readonly memory = new Map<string, string>();
  private voiceIdCache: { agentId: string; voiceId: string } | null = null;
  /**
   * Why the voice being used is not the agent's, when it is not.
   *
   * Falling back to the settings voice keeps Akira audible, but it means she
   * answers in a different voice from the one she converses in — which is
   * exactly the sort of silent substitution that hid the broken key for weeks.
   * The caller reports this once.
   */
  voiceNote: string | null = null;
  /** The voice last used, and whether it came from the agent or from settings. */
  lastVoiceId: string | null = null;
  lastVoiceSource: "agent" | "settings" | null = null;
  /** How the agent speaks, when it has told us. */
  lastVoiceSettings: SpeechVoiceSettings | null = null;
  lastModelId: string | null = null;

  constructor(private readonly cacheDir: string) {}

  /**
   * Base64 PCM16 at 16 kHz, matching the realtime stream's format so it can go
   * out over the same playback path.
   *
   * Throws with the reason rather than returning null. Every failure here is
   * silence somewhere the user was expecting a voice, and "nothing happened"
   * is the least debuggable outcome there is — ElevenLabs' own message is
   * usually the whole diagnosis.
   */
  async render(options: SpeechOptions): Promise<string> {
    const text = options.text.trim().slice(0, 240);
    if (!text) throw new Error("Nothing to say.");
    if (!options.apiKey) throw new Error("No ElevenLabs API key is configured.");

    {
      const voiceId = await this.resolveVoiceId(options);

      // The agent's own delivery wins when we could read it; the caller's is
      // the fallback for when we could not.
      const settings = this.lastVoiceSettings ?? options.voiceSettings ?? undefined;
      const key = crypto
        .createHash("sha256")
        // Delivery is part of the identity of a clip: change the speed and the
        // cached file is no longer the line you asked for.
        .update(`${voiceId} ${text} ${options.modelId ?? "eleven_flash_v2_5"} ${JSON.stringify(settings ?? {})}`)
        .digest("hex")
        .slice(0, 24);

      const cached = this.memory.get(key);
      if (cached) return cached;

      const file = path.join(this.cacheDir, `speech-${key}.pcm`);
      if (fs.existsSync(file)) {
        const base64 = fs.readFileSync(file).toString("base64");
        this.memory.set(key, base64);
        return base64;
      }

      const audio = await this.synthesize(options, voiceId, text, settings);

      try {
        fs.mkdirSync(this.cacheDir, { recursive: true, mode: 0o700 });
        fs.writeFileSync(file, audio, { mode: 0o600 });
      } catch { /* an uncacheable line is still a spoken line */ }
      const base64 = audio.toString("base64");
      this.memory.set(key, base64);
      return base64;
    }
  }

  /**
   * Read the voice off the agent rather than asking the user to repeat it in
   * ROME's settings. These lines have to match the voice that answers the rest
   * of the conversation, and duplicating that value invites it to drift.
   */
  private async resolveVoiceId(options: SpeechOptions): Promise<string> {
    if (this.voiceIdCache?.agentId === options.agentId) {
      this.lastVoiceId = this.voiceIdCache.voiceId;
      return this.voiceIdCache.voiceId;
    }
    const fallback = (options.fallbackVoiceId ?? "").trim();
    let why = "";
    try {
      const response = await fetch(`${API_BASE}/v1/convai/agents/${encodeURIComponent(options.agentId)}`, {
        headers: { "xi-api-key": options.apiKey },
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) {
        const payload = await response.json().catch(() => ({} as Record<string, any>));
        // The agent schema has moved around; check the documented location
        // first and fall back to a shallow search rather than breaking on a
        // rename.
        const voiceId =
          payload?.conversation_config?.tts?.voice_id ??
          payload?.conversation_config?.agent?.tts?.voice_id ??
          findVoiceId(payload);
        if (typeof voiceId === "string" && voiceId) {
          this.voiceIdCache = { agentId: options.agentId, voiceId };
          this.voiceNote = null;
          this.lastVoiceId = voiceId;
          this.lastVoiceSource = "agent";
          // The same request carries how the agent speaks. Taking it here means
          // the warnings match the conversation without anyone copying numbers
          // between two places.
          this.lastVoiceSettings = readVoiceSettings(payload);
          this.lastModelId = readModelId(payload);
          return voiceId;
        }
        why = "the agent did not report a voice";
      } else {
        why = `reading the agent returned HTTP ${response.status}${await describeError(response)}`;
      }
    } catch (error) {
      why = `the agent could not be reached (${error instanceof Error ? error.message : String(error)})`;
    }

    if (fallback) {
      // Cached under the agent id: if the agent lookup is broken it will stay
      // broken for this session, and retrying it before every warning would
      // add a failed round trip to each one.
      this.voiceIdCache = { agentId: options.agentId, voiceId: fallback };
      this.lastVoiceId = fallback;
      this.lastVoiceSource = "settings";
      this.voiceNote =
        `Akira's short lines are using the voice from ROME's settings (${fallback}), not the agent's: ${why}. ` +
        "Set the same voice ID in Voice settings, or give the key access to the agent, so both voices match.";
      return fallback;
    }
    throw new Error(`ROME has no voice to speak with: ${why}, and no voice ID is set in Voice settings.`);
  }

  private async synthesize(
    options: SpeechOptions,
    voiceId: string,
    text: string,
    voiceSettings?: SpeechVoiceSettings,
  ): Promise<Buffer> {
    const query = new URLSearchParams({ output_format: "pcm_16000" });
    const response = await fetch(
      `${API_BASE}/v1/text-to-speech/${encodeURIComponent(voiceId)}?${query}`,
      {
        method: "POST",
        headers: { "xi-api-key": options.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          // The agent's model when it has one: a quality model and a latency
          // model do not read a sentence the same way, and a warning that does
          // not sound like her is worth a few hundred milliseconds.
          model_id: this.lastModelId ?? options.modelId ?? "eleven_flash_v2_5",
          ...(voiceSettings && Object.keys(voiceSettings).length ? { voice_settings: voiceSettings } : {}),
        }),
        // Short: these are one-sentence lines, and a warning that arrives
        // twenty seconds late is worse than one in the system voice on time.
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!response.ok) {
      const detail = await describeError(response);
      const hint = response.status === 401
        ? " The key needs text-to-speech permission, which is separate from the agents permission."
        : "";
      throw new Error(`ElevenLabs refused to synthesise speech (HTTP ${response.status}${detail}).${hint}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.byteLength) throw new Error("ElevenLabs returned no audio.");
    return buffer;
  }

  /** Drop cached audio when the voice changes underneath us. */
  invalidate(): void {
    this.memory.clear();
    this.voiceIdCache = null;
    this.voiceNote = null;
    this.lastVoiceId = null;
    this.lastVoiceSource = null;
    this.lastVoiceSettings = null;
    this.lastModelId = null;
  }
}

/** ElevenLabs puts the useful part in the body; a status code alone is not a diagnosis. */
async function describeError(response: Response): Promise<string> {
  try {
    const text = (await response.text()).slice(0, 400);
    if (!text) return "";
    try {
      const payload = JSON.parse(text);
      const detail = payload?.detail ?? payload?.error ?? payload;
      const message = typeof detail === "string" ? detail : detail?.message ?? detail?.status ?? "";
      return message ? `: ${String(message).slice(0, 200)}` : "";
    } catch {
      return `: ${text}`;
    }
  } catch {
    return "";
  }
}

/**
 * The agent's delivery settings, in ElevenLabs' own field names.
 *
 * Only what is actually present is copied: sending `stability: undefined` and
 * sending nothing are different requests, and the second is the one that means
 * "use the voice's own default".
 */
function readVoiceSettings(payload: any): SpeechVoiceSettings | null {
  const tts = payload?.conversation_config?.tts ?? payload?.conversation_config?.agent?.tts;
  if (!tts || typeof tts !== "object") return null;
  const settings: SpeechVoiceSettings = {};
  for (const field of ["stability", "similarity_boost", "style", "speed", "use_speaker_boost"] as const) {
    const value = (tts as Record<string, unknown>)[field];
    if (typeof value === "number" && Number.isFinite(value)) (settings[field] as number) = value;
    else if (typeof value === "boolean") (settings[field] as boolean) = value;
  }
  return Object.keys(settings).length ? settings : null;
}

function readModelId(payload: any): string | null {
  const model = payload?.conversation_config?.tts?.model_id ?? payload?.conversation_config?.agent?.tts?.model_id;
  return typeof model === "string" && model ? model : null;
}

/** Shallow breadth-first search for a `voice_id` key, bounded. */
function findVoiceId(payload: unknown): string | null {
  const queue: unknown[] = [payload];
  let visited = 0;
  while (queue.length && visited < 200) {
    const current = queue.shift();
    visited += 1;
    if (!current || typeof current !== "object") continue;
    for (const [key, value] of Object.entries(current as Record<string, unknown>)) {
      if (key === "voice_id" && typeof value === "string" && value) return value;
      if (value && typeof value === "object") queue.push(value);
    }
  }
  return null;
}
