/**
 * ROME's only path to a language model that is not Akira's.
 *
 * Knowledge Forge used to "generate" by string-templating extracted sentences,
 * which cost nothing and taught nothing. This is the replacement: a local model
 * over Ollama's HTTP API, running on the same machine, so a study session never
 * touches a metered endpoint.
 *
 * Everything goes through this file on purpose. Ollama was chosen because it
 * gets a working loop in days rather than weeks, not because it is the final
 * answer — an embedded `node-llama-cpp` or a supervised sidecar in the Electron
 * main process are both still on the table. Swapping to either is cheap exactly
 * as long as no component anywhere else in the tree calls `fetch` at a model.
 * Add a method here instead.
 *
 * Two things about the API that are load-bearing:
 *
 * - **`format` takes a JSON schema, and the sampler cannot leave it.** A 7B
 *   model asked politely for JSON will eventually return prose, a trailing
 *   comma, or a fourth option that duplicates the answer. Constrained decoding
 *   makes the shape a guarantee rather than a hope. The *content* is still the
 *   model's opinion, which is why `validate` exists.
 * - **Ollama's default CORS policy admits localhost origins**, and Electron
 *   loads `http://127.0.0.1:5000`, so no `OLLAMA_ORIGINS` change is normally
 *   needed. If a request is ever blocked rather than refused, that is the first
 *   thing to check.
 */

export interface LocalLLMConfig {
  /** Base URL, no trailing slash. */
  endpoint: string;
  /** Ollama model tag, e.g. "qwen2.5:7b-instruct". Empty until one is chosen. */
  model: string;
  temperature: number;
}

export const LLM_DEFAULTS: LocalLLMConfig = {
  endpoint: "http://127.0.0.1:11434",
  model: "",
  temperature: 0.4,
};

/**
 * Models worth suggesting, fastest first.
 *
 * Reading a source is the expensive half of this feature and it scales almost
 * linearly with parameter count, so a 3B that reads a paper in two minutes is a
 * better default than a 7B that takes seven — especially now that a source is
 * read once and every artifact composes from the stored digest.
 *
 * The list is a suggestion on the setup card, never a filter: whatever
 * `/api/tags` reports is selectable, and swapping models to compare is the
 * point of the model row.
 */
export const SUGGESTED_MODELS = [
  "qwen2.5:3b-instruct",
  "llama3.2:3b",
  "qwen2.5:7b-instruct",
];

const CFG_KEY = "rome.academia.llm";

export function loadLLMConfig(): LocalLLMConfig {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (!raw) return { ...LLM_DEFAULTS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...LLM_DEFAULTS };
    // Defaults first, so a config written before a field existed gains it
    // rather than rendering `undefined` into a control.
    return { ...LLM_DEFAULTS, ...(parsed as Partial<LocalLLMConfig>) };
  } catch {
    return { ...LLM_DEFAULTS };
  }
}

export function saveLLMConfig(cfg: LocalLLMConfig): void {
  try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch { /* private mode */ }
}

/* ── Status ──────────────────────────────────────────────────────────── */

export type LLMStatus =
  | { state: "checking" }
  /** Reachable, and at least one model is pulled. */
  | { state: "ready"; models: string[] }
  /** Reachable, but `ollama pull` has never been run. */
  | { state: "no-models" }
  /** Nothing answered on the endpoint. */
  | { state: "unreachable"; message: string };

const PROBE_TIMEOUT_MS = 4_000;
const CHAT_TIMEOUT_MS = 300_000;

/* ── One call at a time, application-wide ────────────────────────────── */

let modelGate: Promise<unknown> = Promise.resolve();
let interactive = 0;

/**
 * Serialise every model call in the app.
 *
 * There is one Ollama and one model. A background preparation job and a live
 * Quantum Recall run are two clients of it, and without a gate they interleave:
 * the run's request sits in Ollama's own queue behind minutes of the job's work
 * and times out, which is exactly the 300-second failure that prompted this.
 * Serialising here also means the queue is *ours*, so it can be ordered.
 */
function withModelGate<T>(run: () => Promise<T>): Promise<T> {
  const next = modelGate.then(run, run);
  modelGate = next.then(() => undefined, () => undefined);
  return next;
}

/**
 * Mark a stretch of work as something a person is waiting on.
 *
 * Background loops call `interactiveActive()` between items and yield while it
 * is true, so a run never queues behind a job — the job simply pauses between
 * passages until the run is over. Nothing is cancelled; the job resumes where
 * it left off.
 */
export function beginInteractive(): () => void {
  interactive++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    interactive = Math.max(0, interactive - 1);
  };
}

export function interactiveActive(): boolean {
  return interactive > 0;
}

/**
 * Pause a background loop while someone is waiting on the model.
 *
 * Polled rather than subscribed because the granularity that matters is one
 * passage, not one millisecond, and a background job that resumes a second late
 * is a background job behaving correctly.
 */
export function awaitIdle(signal?: AbortSignal, pollMs = 750): Promise<void> {
  if (!interactiveActive()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (signal?.aborted) return reject(new DOMException("cancelled", "AbortError"));
      if (!interactiveActive()) return resolve();
      setTimeout(tick, pollMs);
    };
    setTimeout(tick, pollMs);
  });
}

/**
 * One context window for the whole application. Do not vary this per call.
 *
 * Ollama runs a model at a modest default context regardless of what the model
 * supports and **truncates a longer prompt silently**, so a value has to be
 * stated. The trap is what happens when different calls state *different*
 * values: `num_ctx` is a load-time parameter, so the scheduler cannot serve a
 * request from a runner loaded at another size — it unloads the model and
 * reloads it. Alternating 2048 for a digest with 4096 for a question meant a
 * multi-gigabyte reload **between every call**, which is why an analysis call
 * that should take six seconds sat for five minutes and hit the timeout.
 *
 * That was self-inflicted: an earlier fix cut the window for small calls to
 * save KV cache memory, correctly reasoning about memory and not at all about
 * loading. A slightly oversized KV cache costs some memory. Reload thrash costs
 * everything.
 *
 * 4096 fits the largest routine call — a passage plus four neighbour excerpts
 * plus the answer — with the Studio's composition folded to match.
 */
const NUM_CTX = 4096;

/**
 * Kept so callers reading old code still compile, and deliberately equal to
 * `NUM_CTX`: there is no second context size any more.
 */
export const NUM_CTX_PASSAGE = NUM_CTX;

/**
 * Default cap on generated tokens.
 *
 * Generous for anything this app asks for, and far below the context limit a
 * runaway generation would otherwise fill. Callers that know their answer is
 * small pass a tighter number.
 */
const NUM_PREDICT = 1024;
/** How long Ollama holds the model in memory after a call. Default is 5m. */
const KEEP_ALIVE = "30m";

/**
 * Ask the endpoint what it has.
 *
 * Deliberately cheap and deliberately short-timeouted: this runs on every entry
 * to Academia, and a stalled probe must never be the reason the page feels
 * broken. "Not running" is a normal state with a normal answer, not an error.
 */
export async function probeLocalLLM(cfg: LocalLLMConfig): Promise<LLMStatus> {
  try {
    const response = await fetch(`${cfg.endpoint.replace(/\/$/, "")}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return { state: "unreachable", message: `Ollama answered ${response.status}` };
    const body = await response.json() as { models?: Array<{ name?: string }> };
    const models = (body.models ?? []).map(m => m.name).filter((n): n is string => !!n).sort();
    return models.length ? { state: "ready", models } : { state: "no-models" };
  } catch (error) {
    const message = error instanceof DOMException && error.name === "TimeoutError"
      ? "Ollama did not answer in time"
      : "No Ollama on this machine";
    return { state: "unreachable", message };
  }
}

/* ── Generation ──────────────────────────────────────────────────────── */

export type LLMFailure = "unreachable" | "model-missing" | "invalid-output" | "aborted";

export class LocalLLMError extends Error {
  // Assigned rather than declared as a constructor parameter property: node's
  // own type stripping runs the tests, and it does not implement those.
  kind: LLMFailure;

  constructor(kind: LLMFailure, message: string) {
    super(message);
    this.name = "LocalLLMError";
    this.kind = kind;
  }
}

/** A JSON Schema object, passed to Ollama's `format` for constrained decoding. */
export type JsonSchema = Record<string, unknown>;

/**
 * The same schema with the keywords a grammar converter may not implement.
 *
 * Ollama turns `format` into a grammar, and its converter supports a subset of
 * JSON Schema. Bounds and enums are exactly the sort of thing that is either
 * honoured, silently dropped, or rejected depending on the version installed —
 * and when they are rejected the failure looks like the model being bad at its
 * job. So the strict schema is tried first and this is the fallback: shape is
 * still enforced, the bounds move to the validator, and something usable comes
 * back on a runtime that could not take the strict one.
 */
export function simplifySchema(schema: JsonSchema): JsonSchema {
  const DROP = new Set(["minItems", "maxItems", "minimum", "maximum", "enum", "minLength", "maxLength", "pattern"]);
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (DROP.has(key)) continue;
      out[key] = walk(value);
    }
    return out;
  };
  return walk(schema) as JsonSchema;
}

/* ── The call log ────────────────────────────────────────────────────── */

export interface CallRecord {
  at: number;
  label: string;
  model: string;
  ms: number;
  outcome: "ok" | "retried" | "simplified" | "failed";
  attempts: number;
  /** What went wrong, and enough of what came back to tell why. */
  detail?: string;
  sample?: string;
}

const LOG_LIMIT = 40;
const callLog: CallRecord[] = [];
const logListeners = new Set<() => void>();

function record(entry: CallRecord): void {
  callLog.unshift(entry);
  if (callLog.length > LOG_LIMIT) callLog.length = LOG_LIMIT;
  logListeners.forEach(listener => listener());
}

/**
 * The last few model calls, newest first.
 *
 * In memory rather than persisted: this exists to answer "what is failing right
 * now", and a log that survived a restart would mostly answer questions about a
 * previous one.
 */
export function getCallLog(): CallRecord[] {
  return callLog.slice();
}

export function clearCallLog(): void {
  callLog.length = 0;
  logListeners.forEach(listener => listener());
}

export function onCallLog(listener: () => void): () => void {
  logListeners.add(listener);
  return () => { logListeners.delete(listener); };
}

export interface GenerateOptions<T> {
  /** Persona and rules. Kept out of `prompt` so the material stays the material. */
  system?: string;
  prompt: string;
  schema: JsonSchema;
  /**
   * Semantic check on the decoded object. `format` guarantees the shape; this is
   * where "four options, none of them duplicates" is enforced. Throw to reject.
   */
  validate?: (value: unknown) => T;
  temperature?: number;
  /**
   * Ignored, and kept only so existing call sites compile.
   *
   * `num_ctx` is a load-time parameter: varying it between calls makes Ollama
   * unload and reload the model each time. There is one window for the whole
   * app now — see `NUM_CTX`.
   */
  numCtx?: number;
  /**
   * Hard cap on tokens generated.
   *
   * Ollama's default is unlimited, which is fine for a model that knows when to
   * stop and catastrophic for one that does not: a small model that fails to
   * close a JSON array keeps emitting until it hits the context limit, which at
   * 4k tokens is minutes of GPU time producing nothing usable. The cap turns
   * that from a hang into a retry.
   */
  numPredict?: number;
  signal?: AbortSignal;
  /**
   * Rejections to absorb before giving up. One by default: a second attempt
   * usually fixes a bad sample, a third is just spending the round's clock.
   */
  retries?: number;
  /** What this call is for, so the diagnostics log reads as something. */
  label?: string;
}

/** Merge a caller's signal with our own timeout without leaking listeners. */
function linkedSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), timeoutMs);
  const forward = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) forward();
    else signal.addEventListener("abort", forward, { once: true });
  }
  return {
    signal: controller.signal,
    release: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", forward);
    },
  };
}

/**
 * One schema-constrained completion.
 *
 * Throws `LocalLLMError` and nothing else, so every caller has exactly four
 * cases to handle and the UI can say something true about which one happened.
 */
export async function generateJson<T>(cfg: LocalLLMConfig, options: GenerateOptions<T>): Promise<T> {
  if (!cfg.model) throw new LocalLLMError("model-missing", "No model selected");

  const label = options.label ?? "generate";
  const started = Date.now();
  const retries = Math.max(0, options.retries ?? 1);
  // The last attempt drops the schema keywords a grammar converter may not
  // implement. If the strict schema is what was breaking, this is where it
  // shows up — and the log says `simplified`, which is the whole diagnosis.
  const plan: Array<{ schema: JsonSchema; simplified: boolean }> = [
    ...Array.from({ length: retries + 1 }, () => ({ schema: options.schema, simplified: false })),
    { schema: simplifySchema(options.schema), simplified: true },
  ];

  let lastInvalid: Error | null = null;
  let lastSample = "";

  for (let attempt = 0; attempt < plan.length; attempt++) {
    const { schema, simplified } = plan[attempt];
    const messages: Array<{ role: string; content: string }> = [];
    if (options.system) messages.push({ role: "system", content: options.system });
    messages.push({ role: "user", content: options.prompt });
    // A rejected sample gets told what was wrong with it. Re-rolling the same
    // prompt at the same temperature mostly reproduces the same mistake.
    if (lastInvalid) {
      messages.push({
        role: "user",
        content: `Your previous answer was rejected: ${lastInvalid.message}. Answer again, correcting only that.`,
      });
    }
    if (simplified) {
      // The bounds are no longer in the grammar, so they have to be said.
      messages.push({
        role: "user",
        content: "Answer with compact JSON. Keep every list short — no more than four entries — and close every bracket.",
      });
    }

    const { signal, release } = linkedSignal(options.signal, CHAT_TIMEOUT_MS);
    let raw: string;
    try {
      // Through the gate: one model call at a time, application-wide.
      const response = await withModelGate(() => fetch(`${cfg.endpoint.replace(/\/$/, "")}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({
          model: cfg.model,
          messages,
          stream: false,
          format: schema,
          keep_alive: KEEP_ALIVE,
          options: {
            temperature: options.temperature ?? cfg.temperature,
            // Deliberately not `options.numCtx`. See NUM_CTX: varying this
            // between calls forces Ollama to unload and reload the model.
            num_ctx: NUM_CTX,
            // Each attempt gets a little more room. A first answer cut off at
            // the cap is usually a model being verbose, but not always — and an
            // honest answer that needs 10% more should not fail three times.
            num_predict: Math.round((options.numPredict ?? NUM_PREDICT) * (1 + attempt * 0.4)),
          },
        }),
      }));

      if (response.status === 404) {
        throw new LocalLLMError("model-missing", `Ollama has no model named ${cfg.model}`);
      }
      if (!response.ok) {
        // A 400 here is very often the schema, not the request — worth saying,
        // because the alternative reading is "the server is broken".
        const body = await response.text().catch(() => "");
        const hint = response.status === 400 ? " — Ollama rejected the request, most likely the schema" : "";
        throw new LocalLLMError("unreachable", `Ollama answered ${response.status}${hint}${body ? `: ${body.slice(0, 160)}` : ""}`);
      }
      const body = await response.json() as { message?: { content?: string }; done_reason?: string };
      raw = body.message?.content ?? "";
      lastSample = raw.slice(0, 220);
      // `length` means the cap stopped it mid-answer, which is a different
      // problem from a model that answered badly, and needs a different fix.
      if (body.done_reason === "length") {
        // `continue` skips the release below, and the abort timer it holds runs
        // for five minutes — a leaked timer per cut-off attempt, which keeps the
        // event loop alive long after the app has moved on.
        release();
        // Said plainly, because the retry message is what the model reads and
        // "it never closed the JSON" is a diagnosis rather than an instruction.
        lastInvalid = new Error("your answer was cut off because it was far too long — say the same thing in a quarter of the words, and close every bracket");
        continue;
      }
    } catch (error) {
      release();
      if (error instanceof LocalLLMError) {
        record({ at: started, label, model: cfg.model, ms: Date.now() - started, outcome: "failed", attempts: attempt + 1, detail: error.message });
        throw error;
      }
      if (options.signal?.aborted) throw new LocalLLMError("aborted", "Generation cancelled");
      const timedOut = error instanceof DOMException && error.name === "TimeoutError";
      const failure = new LocalLLMError("unreachable", timedOut ? "The model took too long to answer" : "Lost contact with Ollama");
      record({ at: started, label, model: cfg.model, ms: Date.now() - started, outcome: "failed", attempts: attempt + 1, detail: failure.message });
      throw failure;
    }
    release();

    try {
      const parsed = JSON.parse(raw) as unknown;
      const value = options.validate ? options.validate(parsed) : (parsed as T);
      record({
        at: started, label, model: cfg.model, ms: Date.now() - started,
        outcome: simplified ? "simplified" : attempt === 0 ? "ok" : "retried",
        attempts: attempt + 1,
      });
      return value;
    } catch (error) {
      lastInvalid = error instanceof Error ? error : new Error("unparseable");
    }
  }

  record({
    at: started, label, model: cfg.model, ms: Date.now() - started,
    outcome: "failed", attempts: plan.length,
    detail: lastInvalid?.message ?? "no usable output",
    sample: lastSample,
  });
  // The validator's own complaint is carried through rather than flattened into
  // a generic sentence: "a question had duplicate options" tells you the model
  // is the problem, "unexpected token" tells you the schema is.
  throw new LocalLLMError("invalid-output", lastInvalid?.message ?? "no usable output");
}

/**
 * Ask Ollama to let go of the model.
 *
 * `keep_alive: 0` unloads immediately. Worth doing when a long job finishes and
 * the next one may be an hour away: several gigabytes held resident is a large
 * part of why a machine that is doing nothing still feels slow, and reloading
 * costs seconds against minutes of reading.
 *
 * Best effort. A failure here means the model stays loaded, which is the state
 * things were in anyway.
 */
export async function unloadModel(cfg: LocalLLMConfig): Promise<void> {
  if (!cfg.model) return;
  try {
    await fetch(`${cfg.endpoint.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      body: JSON.stringify({ model: cfg.model, keep_alive: 0 }),
    });
  } catch { /* best effort */ }
}

/** Human sentence for a failure, for use in a panel rather than a console. */
export function describeFailure(error: unknown): string {
  if (!(error instanceof LocalLLMError)) return "Generation failed";
  switch (error.kind) {
    case "unreachable":    return `${error.message}. Check that Ollama is running.`;
    case "model-missing":  return `${error.message}. Choose a model in Studio settings.`;
    case "invalid-output": return `The model could not produce usable output — ${error.message}. A larger model usually fixes this.`;
    case "aborted":        return "Generation cancelled.";
  }
}
