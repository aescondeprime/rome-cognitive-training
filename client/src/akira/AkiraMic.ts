/**
 * AkiraMic — one microphone stream, opened once, held open.
 *
 * V2 opened a fresh `getUserMedia` + `AudioContext` + `AudioWorklet` *after*
 * every wake event and started recording 30ms later. On macOS that cold start
 * costs hundreds of milliseconds, so the opening syllables were lost and
 * anything said after "Akira" in the same breath vanished entirely.
 *
 * Here the stream is opened once and never torn down. Two consequences:
 *
 * 1. Starting a conversation is instantaneous — there is no device to acquire.
 * 2. A rolling ring buffer always holds the last few seconds, so when a
 *    conversation starts we can flush what was said *before* the trigger. That
 *    is what makes "Akira, open my idea workshop" work as one sentence.
 *
 * Audio only leaves the machine while streaming is explicitly enabled. Dormant
 * capture stays in this process, in a fixed-size buffer, and is never written
 * to disk.
 */

const TARGET_SAMPLE_RATE = 16_000;   // ElevenLabs agent input format
const CHUNK_SAMPLES = 4_000;         // 250ms at 16kHz
const RING_SECONDS = 3;
const RING_SAMPLES = TARGET_SAMPLE_RATE * RING_SECONDS;

/**
 * How long the room keeps ringing after Akira's last scheduled sample.
 *
 * Covers the output device's own latency as well as reflection: the moment the
 * renderer stops scheduling audio is not the moment the microphone stops
 * hearing it.
 */
const ECHO_TAIL_MS = 320;
/**
 * The opening of her sentence is the cleanest measurement of the echo we will
 * ever get — the user cannot yet be reacting to words they have not heard. No
 * barge-in is recognised inside it; the level is what everything after is
 * measured against.
 */
const ECHO_CALIBRATION_MS = 400;
/** Sustained speech required before it counts as interrupting rather than noise. */
const BARGE_IN_MS = 260;
/** Absolute floor, so a silent room cannot make the threshold meaninglessly small. */
const BARGE_IN_FLOOR = 0.02;
/** Handed back when a barge-in fires, so its opening syllables survive. */
const BARGE_IN_PRE_ROLL_MS = 600;

/** Emitted so the ambience can breathe even before the server reports VAD. */
export type LevelListener = (rms: number) => void;

export interface AkiraMicOptions {
  deviceId?: string;
  onChunk: (base64: string) => void;
  onLevel?: LevelListener;
  /**
   * Raw 16kHz Int16 frames, delivered whether or not streaming is enabled.
   *
   * This is what lets wake-word detection share the single microphone rather
   * than opening its own — the contention that broke V2's wake word.
   */
  onPcm?: (pcm: Int16Array) => void;
  /**
   * Sustained speech heard while Akira herself is audible.
   *
   * Barge-in is decided here rather than by the agent's own voice activity
   * detector, because the server cannot tell her voice from the user's — it
   * only ever receives one stream — whereas this class knows exactly when she
   * is playing and how loud she comes back.
   */
  onBargeIn?: () => void;
  /** Whether barge-in is recognised at all. Mirrors the setting of the same name. */
  bargeInEnabled?: boolean;
  onError?: (error: Error) => void;
  /**
   * Injectable clock.
   *
   * The echo guard is entirely a statement about time — how long ago she
   * stopped, how far into her sentence we are — and a test that has to sleep
   * through those windows in real time is a test nobody runs.
   */
  now?: () => number;
}

const CAPTURE_WORKLET = `
class AkiraCapture extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (input && input.length) this.port.postMessage(input.slice(0));
    return true;
  }
}
registerProcessor('akira-capture', AkiraCapture);
`;

export class AkiraMic {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private sink: GainNode | null = null;

  /** Circular 16kHz history, always filled while the mic is open. */
  private readonly ring = new Int16Array(RING_SAMPLES);
  private ringWrite = 0;
  private ringFilled = 0;

  /** Partial chunk waiting to reach CHUNK_SAMPLES before being sent. */
  private pending: number[] = [];
  private streaming = false;
  private resampleCursor = 0;

  /**
   * Echo guard.
   *
   * Akira plays through the speakers this microphone is listening to. Left
   * ungated, her own voice arrives back as user audio, the agent's turn
   * detector reads it as someone talking over her, and she cuts herself off
   * mid-sentence — an interruption with no interrupter.
   */
  private selfSpeaking = false;
  private selfSpeechStartedAt = 0;
  private selfSpeechEndedAt = 0;
  /** Loudest the echo of her own voice measured this sentence. */
  private echoLevel = 0;
  /** Slow-moving estimate of the quiet room, used when she is not speaking. */
  private noiseFloor = 0.004;
  /** Milliseconds of above-threshold audio accumulated during her speech. */
  private speechMs = 0;
  private bargeInArmed = true;
  private bargeInEnabled: boolean;

  private readonly now: () => number;

  constructor(private readonly options: AkiraMicOptions) {
    this.bargeInEnabled = options.bargeInEnabled ?? true;
    this.now = options.now ?? (() => Date.now());
  }

  get open(): boolean {
    return Boolean(this.stream);
  }

  get isStreaming(): boolean {
    return this.streaming;
  }

  /** True while Akira's own voice could still be reaching the microphone. */
  get guarded(): boolean {
    return this.selfSpeaking || this.now() - this.selfSpeechEndedAt < ECHO_TAIL_MS;
  }

  setBargeInEnabled(enabled: boolean): void {
    this.bargeInEnabled = enabled;
  }

  /**
   * Akira is, or is no longer, audible.
   *
   * Driven by the renderer's playback schedule rather than by conversation
   * state, because the two do not agree: the acknowledgement plays while the
   * state machine is LISTENING, and a focus warning plays while it is dormant.
   * What matters is whether sound is coming out of the speakers, and only the
   * thing scheduling that sound knows.
   */
  setSelfSpeaking(active: boolean): void {
    if (active === this.selfSpeaking) return;
    this.selfSpeaking = active;
    if (active) {
      this.selfSpeechStartedAt = this.now();
      this.echoLevel = 0;
      this.speechMs = 0;
      this.bargeInArmed = true;
    } else {
      this.selfSpeechEndedAt = this.now();
      this.speechMs = 0;
    }
  }

  async start(): Promise<void> {
    if (this.stream) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone capture is unavailable.");

    const deviceId = this.options.deviceId;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        channelCount: 1,
        // Echo cancellation matters more than usual here: Akira's own voice is
        // playing through the same speakers the mic is listening to, and
        // without it the agent hears itself and interrupts its own sentences.
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    this.stream = stream;

    const context = new AudioContext({ latencyHint: "interactive" });
    this.context = context;
    await context.resume();

    const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "text/javascript" }));
    try { await context.audioWorklet.addModule(url); }
    finally { URL.revokeObjectURL(url); }

    const node = new AudioWorkletNode(context, "akira-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    const source = context.createMediaStreamSource(stream);
    // A muted sink keeps the graph alive without routing the microphone to the
    // speakers, which would feed back immediately.
    const sink = context.createGain();
    sink.gain.value = 0;
    source.connect(node).connect(sink).connect(context.destination);

    this.node = node;
    this.source = source;
    this.sink = sink;
    node.port.onmessage = event => this.consume(event.data as Float32Array);
  }

  /**
   * Begin sending audio upstream.
   *
   * `flushPreRoll` prepends buffered history so speech that happened before the
   * conversation started is not lost — the difference between Akira hearing
   * "open my idea workshop" and hearing nothing at all.
   */
  beginStreaming(flushPreRoll = true, preRollMs = 1_500): void {
    if (this.streaming) return;
    this.pending = [];
    this.streaming = true;
    if (!flushPreRoll) return;
    this.flushPreRoll(preRollMs);
  }

  /**
   * Replay recent history upstream, stopping short of anything Akira said.
   *
   * The ring keeps recording while she speaks, so a conversation opened moments
   * after a spoken warning would otherwise begin by uploading the warning — and
   * she would answer herself before the user had said a word. This is the one
   * self-hearing path the streaming guard cannot catch, because the audio was
   * captured before the guard was asked about it.
   */
  private flushPreRoll(preRollMs: number): void {
    const sinceEcho = this.guarded ? 0 : this.now() - this.selfSpeechEndedAt - ECHO_TAIL_MS;
    const usable = Math.max(0, Math.min(preRollMs, sinceEcho));
    const wanted = Math.min(this.ringFilled, Math.floor((usable / 1_000) * TARGET_SAMPLE_RATE));
    if (wanted <= 0) return;
    const preRoll = new Int16Array(wanted);
    const start = (this.ringWrite - wanted + RING_SAMPLES) % RING_SAMPLES;
    for (let index = 0; index < wanted; index += 1) {
      preRoll[index] = this.ring[(start + index) % RING_SAMPLES];
    }
    this.emit(preRoll);
  }

  endStreaming(): void {
    this.streaming = false;
    this.pending = [];
  }

  async stop(): Promise<void> {
    this.endStreaming();
    const { node, context, stream, source, sink } = this;
    this.node = null;
    this.context = null;
    this.stream = null;
    this.source = null;
    this.sink = null;
    this.ringWrite = 0;
    this.ringFilled = 0;
    this.selfSpeaking = false;
    this.selfSpeechEndedAt = 0;
    this.speechMs = 0;
    this.echoLevel = 0;
    if (node) {
      node.port.onmessage = null;
      try { node.disconnect(); } catch { /* already disconnected */ }
    }
    try { source?.disconnect(); } catch { /* already disconnected */ }
    try { sink?.disconnect(); } catch { /* already disconnected */ }
    stream?.getTracks().forEach(track => track.stop());
    if (context && context.state !== "closed") await context.close().catch(() => undefined);
  }

  /**
   * Resample a worklet frame to 16kHz, record it, and stream it if enabled.
   *
   * The hardware rate is usually 48kHz but is not guaranteed, so the ratio is
   * read from the context rather than assumed. `resampleCursor` carries the
   * fractional position across frames — dropping it would introduce a click at
   * every 128-sample boundary.
   */
  private consume(input: Float32Array): void {
    const context = this.context;
    if (!context || !input.length) return;

    const ratio = context.sampleRate / TARGET_SAMPLE_RATE;
    let sum = 0;
    let cursor = this.resampleCursor;
    const out: number[] = [];

    while (cursor < input.length) {
      const index = Math.floor(cursor);
      const sample = input[index] ?? 0;
      out.push(sample);
      sum += sample * sample;
      cursor += ratio;
    }
    this.resampleCursor = cursor - input.length;

    if (!out.length) return;

    const pcm = new Int16Array(out.length);
    for (let index = 0; index < out.length; index += 1) {
      const clamped = Math.max(-1, Math.min(1, out[index]));
      pcm[index] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    }

    this.writeRing(pcm);
    const rms = Math.sqrt(sum / out.length);
    this.options.onLevel?.(rms);

    const guarded = this.guarded;
    if (guarded) {
      // Her own voice is not a wake word either: without this she can summon
      // herself by saying her own name.
      this.watchForBargeIn(rms, (out.length / TARGET_SAMPLE_RATE) * 1_000);
    } else {
      this.trackNoiseFloor(rms);
      this.speechMs = 0;
      this.options.onPcm?.(pcm);
    }

    if (!this.streaming) return;
    // The stream keeps its cadence while she speaks, carrying silence rather
    // than stopping. A gap would leave the agent's turn detector guessing;
    // silence tells it plainly that nobody is talking.
    // If a barge-in fired on this very frame it has already gone upstream in the
    // pre-roll, so the frame itself is still muted here rather than sent twice.
    for (let index = 0; index < pcm.length; index += 1) this.pending.push(guarded ? 0 : pcm[index]);
    while (this.pending.length >= CHUNK_SAMPLES) {
      this.emit(Int16Array.from(this.pending.splice(0, CHUNK_SAMPLES)));
    }
  }

  /**
   * Decide whether someone is talking over Akira.
   *
   * The threshold is calibrated against her own echo at the start of each
   * sentence, so it adapts to the thing that actually varies: speaker volume,
   * the room, and whether headphones are in. On headphones the echo is nil, the
   * threshold falls to the noise floor, and interrupting stays as easy as it
   * should be.
   */
  private watchForBargeIn(rms: number, frameMs: number): void {
    if (this.now() - this.selfSpeechStartedAt < ECHO_CALIBRATION_MS) {
      this.echoLevel = Math.max(this.echoLevel, rms);
      return;
    }
    if (!this.bargeInEnabled || !this.bargeInArmed || !this.options.onBargeIn) return;
    const threshold = Math.max(this.echoLevel * 2.2, this.noiseFloor * 8, BARGE_IN_FLOOR);
    // Decays twice as fast as it builds, so a single loud consonant bleeding
    // through does not accumulate into an interruption across a whole sentence.
    this.speechMs = rms > threshold ? this.speechMs + frameMs : Math.max(0, this.speechMs - frameMs * 2);
    if (this.speechMs < BARGE_IN_MS) return;

    this.bargeInArmed = false;
    this.speechMs = 0;
    // Drop the guard here rather than waiting for the round trip through the
    // main process, and hand back the moment they started speaking — losing the
    // first half-second is the usual price of interrupting, and it need not be.
    this.selfSpeaking = false;
    this.selfSpeechEndedAt = 0;
    if (this.streaming) this.flushPreRoll(BARGE_IN_PRE_ROLL_MS);
    this.options.onBargeIn();
  }

  /**
   * Minimum statistics: fall to a new quiet quickly, climb out of it slowly, so
   * a passing sentence cannot raise the floor above the next one.
   */
  private trackNoiseFloor(rms: number): void {
    this.noiseFloor = rms < this.noiseFloor
      ? this.noiseFloor * 0.9 + rms * 0.1
      : Math.min(this.noiseFloor * 1.0008, 0.05);
  }

  private writeRing(pcm: Int16Array): void {
    for (let index = 0; index < pcm.length; index += 1) {
      this.ring[this.ringWrite] = pcm[index];
      this.ringWrite = (this.ringWrite + 1) % RING_SAMPLES;
    }
    this.ringFilled = Math.min(RING_SAMPLES, this.ringFilled + pcm.length);
  }

  private emit(pcm: Int16Array): void {
    try {
      this.options.onChunk(encodeBase64(pcm));
    } catch (error) {
      this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

/**
 * Int16 PCM to base64.
 *
 * Chunked because `String.fromCharCode(...bytes)` blows the argument limit on
 * anything larger than a few thousand samples.
 */
function encodeBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = "";
  const STRIDE = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += STRIDE) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(offset, offset + STRIDE)) as unknown as number[],
    );
  }
  return btoa(binary);
}
