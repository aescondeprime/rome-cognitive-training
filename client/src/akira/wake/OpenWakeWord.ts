/**
 * On-device wake word detection for "Akira", via openWakeWord.
 *
 * Three ONNX models chained, run through onnxruntime-web:
 *
 *   audio → melspectrogram → embedding (Google, frozen) → classifier
 *
 * Only the last stage is specific to the wake word, which is why the trained
 * file is tiny and why swapping wake words later means replacing one model.
 *
 * Fed from `AkiraMic` rather than opening its own microphone. Every wake-word
 * library ships a helper that grabs the device itself, and using one would
 * recreate exactly the two-capture contention that made V2's wake word
 * unreliable. `AkiraMic` already produces 16 kHz mono Int16 — openWakeWord's
 * native input format — so nothing is resampled twice.
 *
 * Entirely optional. A missing package or model file leaves detection off and
 * Command+' keeps working.
 *
 * Pipeline constants are taken from openWakeWord's own `AudioFeatures`:
 * 1280-sample chunks, a 76-frame mel window stepped by 8, 96-dimension
 * embeddings, and a `spec/10 + 2` scaling on the spectrogram.
 */

const SAMPLE_RATE = 16_000;
/** 80ms at 16kHz — openWakeWord's processing unit. */
const CHUNK_SAMPLES = 1_280;
const MEL_WINDOW = 76;
const MEL_STEP = 8;
const MEL_BINS = 32;
const EMBED_DIM = 96;
/** Ignore repeat detections inside this window. */
const COOLDOWN_MS = 1_500;

export interface OpenWakeWordOptions {
  /** Served from client/public — e.g. "akira/akira.onnx". */
  keywordModelPath: string;
  melModelPath: string;
  embeddingModelPath: string;
  /** 0–1. Higher is stricter. */
  threshold: number;
  onDetected: (score: number) => void;
  onError?: (error: Error) => void;
}

export class OpenWakeWord {
  private ort: any = null;
  private melSession: any = null;
  private embedSession: any = null;
  private keywordSession: any = null;

  /** Raw audio waiting to reach CHUNK_SAMPLES. */
  private audio: number[] = [];
  /** Mel frames, each MEL_BINS wide. */
  private mel: Float32Array[] = [];
  /** Embeddings, each EMBED_DIM wide. */
  private features: Float32Array[] = [];
  /** How many embeddings the trained classifier expects. */
  private keywordFrames = 16;

  private running = false;
  private starting: Promise<boolean> | null = null;
  private failed = false;
  private busy = false;
  private lastDetectionAt = 0;

  constructor(private readonly options: OpenWakeWordOptions) {}

  get listening(): boolean {
    return this.running;
  }

  /** Resolves false when detection is unavailable, rather than throwing. */
  async start(): Promise<boolean> {
    if (this.running) return true;
    if (this.failed) return false;
    if (this.starting) return this.starting;
    this.starting = this.startInternal().finally(() => { this.starting = null; });
    return this.starting;
  }

  private async startInternal(): Promise<boolean> {
    try {
      // Dynamic import so a missing package is a disabled feature rather than
      // a build failure or a blank window.
      const ort: any = await import(/* @vite-ignore */ "onnxruntime-web");
      this.ort = ort;
      const options = { executionProviders: ["wasm"] };

      const [mel, embed, keyword] = await Promise.all([
        ort.InferenceSession.create(this.options.melModelPath, options),
        ort.InferenceSession.create(this.options.embeddingModelPath, options),
        ort.InferenceSession.create(this.options.keywordModelPath, options),
      ]);
      this.melSession = mel;
      this.embedSession = embed;
      this.keywordSession = keyword;

      // Read the classifier's expected window rather than assuming 16 — models
      // trained with different settings use different lengths.
      const inputName = keyword.inputNames?.[0];
      const dims = keyword.inputMetadata?.[inputName]?.dimensions
        ?? keyword.inputMetadata?.[0]?.dimensions;
      const declared = Array.isArray(dims) ? Number(dims[1]) : NaN;
      if (Number.isFinite(declared) && declared > 0) this.keywordFrames = declared;

      this.reset();
      this.running = true;
      return true;
    } catch (error) {
      this.failed = true;
      this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  /**
   * Feed microphone audio.
   *
   * Inference is asynchronous and slower than the audio callback, so frames
   * arriving mid-run are buffered rather than queued — dropping them would clip
   * the wake word, and queueing them unboundedly would drift further behind
   * real time with every chunk.
   */
  process(pcm: Int16Array): void {
    if (!this.running) return;
    for (let index = 0; index < pcm.length; index += 1) this.audio.push(pcm[index]);
    if (this.busy || this.audio.length < CHUNK_SAMPLES) return;
    void this.drain();
  }

  private async drain(): Promise<void> {
    this.busy = true;
    try {
      while (this.audio.length >= CHUNK_SAMPLES) {
        const chunk = this.audio.splice(0, CHUNK_SAMPLES);
        await this.consumeChunk(chunk);
      }
    } catch (error) {
      this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
      this.running = false;
    } finally {
      this.busy = false;
    }
  }

  private async consumeChunk(chunk: number[]): Promise<void> {
    const ort = this.ort;
    // openWakeWord feeds int16 magnitudes as float32 — NOT normalised to
    // [-1, 1]. Normalising here produces a silent-looking spectrogram and the
    // model never fires.
    const samples = Float32Array.from(chunk);

    const melOutput = await runSession(this.melSession, ort, samples, [1, samples.length]);
    if (!melOutput) return;

    // Scaling openWakeWord applies before the embedding stage.
    const frames = melOutput.data.length / MEL_BINS;
    for (let frame = 0; frame < frames; frame += 1) {
      const row = new Float32Array(MEL_BINS);
      for (let bin = 0; bin < MEL_BINS; bin += 1) {
        row[bin] = (melOutput.data[frame * MEL_BINS + bin] as number) / 10 + 2;
      }
      this.mel.push(row);
    }

    while (this.mel.length >= MEL_WINDOW) {
      const window = new Float32Array(MEL_WINDOW * MEL_BINS);
      for (let frame = 0; frame < MEL_WINDOW; frame += 1) {
        window.set(this.mel[frame], frame * MEL_BINS);
      }
      this.mel.splice(0, MEL_STEP);

      const embedding = await runSession(this.embedSession, ort, window, [1, MEL_WINDOW, MEL_BINS, 1]);
      if (!embedding) continue;
      this.features.push(Float32Array.from(embedding.data as Float32Array));
      // Bounded: the classifier only ever looks at the most recent frames.
      if (this.features.length > this.keywordFrames * 4) {
        this.features.splice(0, this.features.length - this.keywordFrames * 2);
      }

      if (this.features.length >= this.keywordFrames) await this.classify();
    }
  }

  private async classify(): Promise<void> {
    const recent = this.features.slice(-this.keywordFrames);
    const input = new Float32Array(this.keywordFrames * EMBED_DIM);
    recent.forEach((frame, index) => input.set(frame, index * EMBED_DIM));

    const output = await runSession(this.keywordSession, this.ort, input, [1, this.keywordFrames, EMBED_DIM]);
    if (!output) return;
    const score = Number(output.data[0]);
    if (!Number.isFinite(score) || score < this.options.threshold) return;

    const now = Date.now();
    if (now - this.lastDetectionAt < COOLDOWN_MS) return;
    this.lastDetectionAt = now;
    // Clear so the same utterance cannot retrigger as the window slides on.
    this.reset();
    this.options.onDetected(score);
  }

  private reset(): void {
    this.audio = [];
    this.mel = [];
    this.features = [];
  }

  async stop(): Promise<void> {
    this.running = false;
    this.reset();
    for (const session of [this.melSession, this.embedSession, this.keywordSession]) {
      try { await session?.release?.(); } catch { /* releasing twice is fine */ }
    }
    this.melSession = null;
    this.embedSession = null;
    this.keywordSession = null;
  }
}

/** Run a single-input session, tolerating naming differences between models. */
async function runSession(
  session: any,
  ort: any,
  data: Float32Array,
  dims: number[],
): Promise<{ data: ArrayLike<number> } | null> {
  if (!session || !ort) return null;
  const name = session.inputNames?.[0];
  if (!name) return null;
  const feeds: Record<string, unknown> = { [name]: new ort.Tensor("float32", data, dims) };
  const result = await session.run(feeds);
  const outputName = session.outputNames?.[0];
  const tensor = outputName ? result[outputName] : Object.values(result)[0];
  return tensor ? { data: tensor.data } : null;
}

export const WAKE_SAMPLE_RATE = SAMPLE_RATE;
