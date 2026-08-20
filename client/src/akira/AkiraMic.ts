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
  onError?: (error: Error) => void;
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

  constructor(private readonly options: AkiraMicOptions) {}

  get open(): boolean {
    return Boolean(this.stream);
  }

  get isStreaming(): boolean {
    return this.streaming;
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
    const wanted = Math.min(this.ringFilled, Math.floor((preRollMs / 1_000) * TARGET_SAMPLE_RATE));
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
    this.options.onLevel?.(Math.sqrt(sum / out.length));
    this.options.onPcm?.(pcm);

    if (!this.streaming) return;
    for (let index = 0; index < pcm.length; index += 1) this.pending.push(pcm[index]);
    while (this.pending.length >= CHUNK_SAMPLES) {
      this.emit(Int16Array.from(this.pending.splice(0, CHUNK_SAMPLES)));
    }
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
