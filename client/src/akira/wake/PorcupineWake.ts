/**
 * On-device wake word detection for "Akira".
 *
 * Runs Picovoice Porcupine in a worker, fed from ROME's existing microphone
 * stream. Porcupine normally ships with `WebVoiceProcessor`, which opens and
 * manages its own microphone — that would recreate exactly the two-capture
 * contention that made V2's wake word unreliable. Instead we call
 * `PorcupineWorker.process()` directly with frames from `AkiraMic`, which
 * already produces 16 kHz mono Int16 PCM: the format Porcupine wants.
 *
 * One microphone, two consumers, no handoff.
 *
 * The whole module is optional. If the package is missing, the access key is
 * unset, or the keyword file is absent, detection stays off and Command+'
 * continues to work — the wake word is a convenience, not a dependency.
 */

/** Minimal shape of the Porcupine worker, so the package can stay a soft dependency. */
interface PorcupineWorkerLike {
  frameLength: number;
  sampleRate: number;
  process(pcm: Int16Array): void | Promise<void>;
  release(): Promise<void> | void;
  terminate(): void;
}

export interface WakeDetectorOptions {
  accessKey: string;
  /** Served from client/public — see the Phase 2b setup notes. */
  keywordPath: string;
  modelPath: string;
  sensitivity: number;
  onDetected: () => void;
  onError?: (error: Error) => void;
}

export class PorcupineWake {
  private worker: PorcupineWorkerLike | null = null;
  private frame: Int16Array | null = null;
  private frameFill = 0;
  private starting: Promise<boolean> | null = null;
  private failed = false;

  constructor(private readonly options: WakeDetectorOptions) {}

  get listening(): boolean {
    return Boolean(this.worker);
  }

  /** Resolves false when detection is unavailable, rather than throwing. */
  async start(): Promise<boolean> {
    if (this.worker) return true;
    if (this.failed) return false;
    if (this.starting) return this.starting;
    this.starting = this.startInternal().finally(() => { this.starting = null; });
    return this.starting;
  }

  private async startInternal(): Promise<boolean> {
    if (!this.options.accessKey.trim()) return false;
    try {
      // Dynamic import so a missing package is a disabled feature rather than
      // a build failure or a blank window.
      const module: any = await import(/* @vite-ignore */ "@picovoice/porcupine-web");
      const PorcupineWorker = module?.PorcupineWorker;
      if (!PorcupineWorker?.create) throw new Error("Porcupine worker unavailable.");

      const sensitivity = Math.max(0, Math.min(1, this.options.sensitivity));
      const worker: PorcupineWorkerLike = await PorcupineWorker.create(
        this.options.accessKey.trim(),
        { publicPath: this.options.keywordPath, label: "Akira", sensitivity },
        () => this.options.onDetected(),
        { publicPath: this.options.modelPath },
      );

      this.worker = worker;
      this.frame = new Int16Array(worker.frameLength || 512);
      this.frameFill = 0;
      return true;
    } catch (error) {
      this.failed = true;
      this.options.onError?.(
        error instanceof Error ? error : new Error(String(error)),
      );
      return false;
    }
  }

  /**
   * Feed microphone audio.
   *
   * Porcupine requires exactly `frameLength` samples per call, while the mic
   * delivers whatever the audio callback produced, so partial frames carry
   * across calls. Dropping the remainder instead would clip a fraction of every
   * buffer and quietly wreck detection accuracy.
   */
  process(pcm: Int16Array): void {
    const worker = this.worker;
    const frame = this.frame;
    if (!worker || !frame) return;

    let offset = 0;
    while (offset < pcm.length) {
      const take = Math.min(frame.length - this.frameFill, pcm.length - offset);
      frame.set(pcm.subarray(offset, offset + take), this.frameFill);
      this.frameFill += take;
      offset += take;
      if (this.frameFill < frame.length) continue;
      this.frameFill = 0;
      try {
        // Copy: the worker may hold the buffer past this call.
        void worker.process(Int16Array.from(frame));
      } catch (error) {
        this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
        return;
      }
    }
  }

  async stop(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    this.frame = null;
    this.frameFill = 0;
    if (!worker) return;
    try { await worker.release(); } catch { /* releasing a dead worker is fine */ }
    try { worker.terminate(); } catch { /* already gone */ }
  }
}
