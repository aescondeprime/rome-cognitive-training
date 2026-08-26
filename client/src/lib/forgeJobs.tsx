/**
 * Long Knowledge Forge work that outlives the page that started it.
 *
 * Reading a source is minutes of model time, and it used to be owned by the
 * Academia component: navigating to another node unmounted the page, the
 * cleanup aborted the controller, and the read died — silently, having thrown
 * away everything after the last partial save. That is the wrong owner. A read
 * belongs to the *library*, not to the screen you happened to start it from.
 *
 * So the queue lives here, mounted above the router, and the only thing the
 * page does is add to it. Progress surfaces in the utility rail above the
 * constellation, which is the one piece of chrome present on every node.
 *
 * **Jobs run one at a time, deliberately.** Two reads in parallel do not finish
 * sooner — they contend for the same model — and they double the memory the
 * runner holds. Serial is both faster and calmer.
 *
 * What this does *not* fix is the machine feeling slow while a large model
 * works. That contention is outside the app: Ollama saturating the GPU makes
 * every other process wait, and no amount of scheduling in the renderer changes
 * it. The levers that do are a smaller model, a smaller context window per call
 * (see `localLLM`), and releasing the model when the queue drains, which is
 * done below.
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { academiaStore, type AcademiaSource, type QuestionBank } from "@/lib/academiaStore";
import { readSource } from "@/lib/academiaGen";
import { awaitIdle, describeFailure, unloadModel, type LocalLLMConfig } from "@/lib/localLLM";
import { CHUNKING_VERSION, chunkSource } from "@/lib/textChunks";
import { emptyBank, hashOfChunk, poolConfig, POOL_SIZE } from "@/lib/recallBank";
import { createLlmGenerator } from "@/lib/recallLlm";
import { loadRecallConfig, type PassageAnchor } from "@/lib/recallRound";

export type ForgeJobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface ForgeJob {
  id: string;
  kind: "read" | "prepare";
  sourceId: string;
  label: string;
  status: ForgeJobStatus;
  done: number;
  total: number;
  message: string;
  error?: string;
}

interface ForgeJobsApi {
  jobs: ForgeJob[];
  active: ForgeJob | null;
  queued: number;
  /** Bumped whenever a job writes to the store, so pages can reload. */
  revision: number;
  enqueueRead: (input: { profileId: number; source: AcademiaSource; cfg: LocalLLMConfig }) => void;
  /** Write a pool of questions for every passage, so studying costs no model time. */
  enqueuePrepare: (input: { profileId: number; source: AcademiaSource; cfg: LocalLLMConfig }) => void;
  isPending: (sourceId: string) => boolean;
  cancel: (id: string) => void;
  cancelAll: () => void;
  dismiss: (id: string) => void;
}

const ForgeJobsContext = createContext<ForgeJobsApi | null>(null);

interface Pending {
  job: ForgeJob;
  profileId: number;
  source: AcademiaSource;
  cfg: LocalLLMConfig;
}

/**
 * Write questions for every passage of one source.
 *
 * The expensive half of Quantum Recall, moved out of study time entirely. Saved
 * passage by passage, so cancelling costs the one in flight; a passage that the
 * model cannot produce questions for is skipped rather than stopping the job,
 * because Recall State falls back to generating on the spot for anything the
 * bank is missing.
 */
async function prepareSource(
  pending: Pending,
  signal: AbortSignal,
  onProgress: (done: number, total: number, label: string) => void,
  onPartial: (bank: QuestionBank) => Promise<void>,
): Promise<QuestionBank> {
  const config = poolConfig(loadRecallConfig());
  const chunks = chunkSource(pending.source.id, pending.source.text, { targetChars: config.chunkTargetChars });

  const digest = (await academiaStore.digests(pending.profileId)).find(item => item.id === pending.source.id);
  const anchors = new Map<string, PassageAnchor>();
  for (const passage of digest?.passages ?? []) {
    anchors.set(passage.hash, { summary: passage.summary, points: passage.points, terms: passage.terms });
  }

  const existing = (await academiaStore.banks(pending.profileId)).find(item => item.id === pending.source.id);
  const bank = emptyBank(
    pending.source.id, pending.profileId, pending.cfg.model,
    CHUNKING_VERSION, config.chunkTargetChars, chunks.length,
  );
  // Reuse whatever a previous run of this job already wrote.
  if (existing && existing.model === bank.model && existing.chunkingVersion === CHUNKING_VERSION && existing.targetChars === bank.targetChars) {
    bank.pools = { ...existing.pools };
  }

  const generator = createLlmGenerator({ cfg: pending.cfg });

  for (let i = 0; i < chunks.length; i++) {
    signal.throwIfAborted();
    // Pause between passages while someone is studying. Nothing is cancelled;
    // the job picks up where it left off when the run ends.
    await awaitIdle(signal);
    const chunk = chunks[i];
    const hash = hashOfChunk(chunk);
    onProgress(i, chunks.length, `${pending.source.name} — questions for passage ${i + 1} of ${chunks.length}`);

    const already = bank.pools[hash];
    if (Array.isArray(already) && already.length >= POOL_SIZE) continue;

    try {
      const round = await generator.generate({
        chunk,
        siblings: chunks.filter(other => other.index !== chunk.index).slice(0, 6),
        anchor: anchors.get(hash),
        config,
        signal,
      });
      bank.pools[hash] = round.questions;
      bank.updatedAt = Date.now();
      await onPartial({ ...bank, pools: { ...bank.pools } });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      // A passage the model cannot question is left out. Recall State generates
      // on the spot for anything missing, so the run still works.
    }
  }

  bank.complete = true;
  bank.updatedAt = Date.now();
  onProgress(chunks.length, chunks.length, `${pending.source.name} prepared`);
  return bank;
}

let jobSeq = 0;

export function ForgeJobProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<ForgeJob[]>([]);
  const [revision, setRevision] = useState(0);

  const pendingRef = useRef<Pending[]>([]);
  const runningRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const cancelledRef = useRef(new Set<string>());
  /** The last config a job ran with, so the model can be released afterwards. */
  const lastCfgRef = useRef<LocalLLMConfig | null>(null);

  const patch = useCallback((id: string, changes: Partial<ForgeJob>) => {
    setJobs(old => old.map(job => (job.id === id ? { ...job, ...changes } : job)));
  }, []);

  const drain = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;

    try {
      while (pendingRef.current.length) {
        const next = pendingRef.current.shift()!;
        if (cancelledRef.current.has(next.job.id)) {
          patch(next.job.id, { status: "cancelled", message: "Cancelled" });
          continue;
        }

        const controller = new AbortController();
        controllerRef.current = controller;
        activeIdRef.current = next.job.id;
        lastCfgRef.current = next.cfg;
        patch(next.job.id, { status: "running", message: "Starting" });

        try {
          if (next.job.kind === "prepare") {
            const bank = await prepareSource(
              next,
              controller.signal,
              (done, total, label) => patch(next.job.id, { done, total, message: label }),
              async partial => { await academiaStore.saveBank(partial); setRevision(value => value + 1); },
            );
            await academiaStore.saveBank(bank);
            setRevision(value => value + 1);
            const written = Object.keys(bank.pools).length;
            patch(next.job.id, {
              status: "done", done: written, total: bank.chunkCount,
              message: `${written}/${bank.chunkCount} passages ready`,
            });
            continue;
          }

          const digest = await readSource({
            cfg: next.cfg,
            profileId: next.profileId,
            source: next.source,
            existing: (await academiaStore.digests(next.profileId)).find(d => d.id === next.source.id),
            signal: controller.signal,
            onProgress: progress => patch(next.job.id, {
              done: progress.done,
              total: progress.total,
              message: progress.label,
            }),
            // Partial digests are saved as the read proceeds, so a cancel or a
            // quit costs the passages in flight rather than the document.
            onPartial: async partial => {
              await academiaStore.saveDigest(partial);
              setRevision(value => value + 1);
            },
          });
          await academiaStore.saveDigest(digest);
          setRevision(value => value + 1);
          patch(next.job.id, {
            status: "done",
            done: digest.passages.length,
            total: digest.passages.length,
            message: `${digest.passages.length} passages`,
          });
        } catch (error) {
          const aborted = controller.signal.aborted;
          patch(next.job.id, {
            status: aborted ? "cancelled" : "failed",
            message: aborted ? "Cancelled" : "Failed",
            error: aborted ? undefined : describeFailure(error),
          });
        } finally {
          controllerRef.current = null;
          activeIdRef.current = null;
        }
      }
    } finally {
      runningRef.current = false;
      // Nothing else is queued, and the next read may be an hour away. Holding
      // several gigabytes resident until the keep-alive lapses is a large part
      // of why a machine that is doing nothing still feels slow.
      if (lastCfgRef.current) void unloadModel(lastCfgRef.current);
    }
  }, [patch]);

  // `drain` closes over fresh state each render; the ref keeps `enqueueRead`
  // stable without re-queuing anything.
  const drainRef = useRef(drain);
  drainRef.current = drain;

  const enqueue = useCallback((kind: ForgeJob["kind"], profileId: number, source: AcademiaSource, cfg: LocalLLMConfig) => {
    // The same work queued twice would produce the same result twice.
    const alreadyPending =
      pendingRef.current.some(item => item.source.id === source.id && item.job.kind === kind) ||
      jobs.some(job => job.sourceId === source.id && job.kind === kind && job.status === "running");
    if (alreadyPending) return;

    const job: ForgeJob = {
      id: `job-${++jobSeq}`,
      kind,
      sourceId: source.id,
      label: kind === "prepare" ? `${source.name} · questions` : source.name,
      status: "queued",
      done: 0,
      total: 0,
      message: "Queued",
    };
    setJobs(old => [
      ...old.filter(item => item.sourceId !== source.id || item.kind !== kind || item.status === "running"),
      job,
    ]);
    pendingRef.current.push({ job, profileId, source, cfg });
    void drainRef.current();
  }, [jobs]);

  const enqueueRead = useCallback<ForgeJobsApi["enqueueRead"]>(
    ({ profileId, source, cfg }) => enqueue("read", profileId, source, cfg), [enqueue]);

  const enqueuePrepare = useCallback<ForgeJobsApi["enqueuePrepare"]>(
    ({ profileId, source, cfg }) => enqueue("prepare", profileId, source, cfg), [enqueue]);

  const cancel = useCallback((id: string) => {
    cancelledRef.current.add(id);
    pendingRef.current = pendingRef.current.filter(item => item.job.id !== id);
    if (activeIdRef.current === id) controllerRef.current?.abort();
    else patch(id, { status: "cancelled", message: "Cancelled" });
  }, [patch]);

  const cancelAll = useCallback(() => {
    for (const item of pendingRef.current) cancelledRef.current.add(item.job.id);
    pendingRef.current = [];
    controllerRef.current?.abort();
    setJobs(old => old.map(job => (job.status === "queued" ? { ...job, status: "cancelled", message: "Cancelled" } : job)));
  }, []);

  const dismiss = useCallback((id: string) => {
    setJobs(old => old.filter(job => job.id !== id));
  }, []);

  const value = useMemo<ForgeJobsApi>(() => {
    const active = jobs.find(job => job.status === "running") ?? null;
    return {
      jobs,
      active,
      queued: jobs.filter(job => job.status === "queued").length,
      revision,
      enqueueRead,
      enqueuePrepare,
      isPending: sourceId => jobs.some(job => job.sourceId === sourceId && (job.status === "queued" || job.status === "running")),
      cancel,
      cancelAll,
      dismiss,
    };
  }, [jobs, revision, enqueueRead, enqueuePrepare, cancel, cancelAll, dismiss]);

  return <ForgeJobsContext.Provider value={value}>{children}</ForgeJobsContext.Provider>;
}

/**
 * Jobs, or a dormant stand-in.
 *
 * Returning a no-op API rather than throwing means a component can be rendered
 * outside the provider — in a test, or in a route mounted before it — without
 * having to know whether the provider is there.
 */
export function useForgeJobs(): ForgeJobsApi {
  const context = useContext(ForgeJobsContext);
  return context ?? IDLE;
}

const IDLE: ForgeJobsApi = {
  jobs: [], active: null, queued: 0, revision: 0,
  enqueueRead: () => {}, enqueuePrepare: () => {}, isPending: () => false,
  cancel: () => {}, cancelAll: () => {}, dismiss: () => {},
};
