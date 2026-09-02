/**
 * Long Knowledge Forge work that outlives the page that started it.
 *
 * Writing a note's questions is minutes of model time, and work like that used
 * to be owned by the Academia component: navigating to another node unmounted
 * the page, the cleanup aborted the controller, and the job died — silently,
 * having thrown away everything after the last partial save. That is the wrong
 * owner. Preparation belongs to the *library*, not to the screen you happened
 * to start it from.
 *
 * So the queue lives here, mounted above the router, and the only thing the
 * page does is add to it. Progress surfaces in the utility rail above the
 * constellation, which is the one piece of chrome present on every node.
 *
 * **Jobs run one at a time, deliberately.** Two jobs in parallel do not finish
 * sooner — they contend for the same model — and they double the memory the
 * runner holds. Serial is both faster and calmer.
 *
 * Reads used to live here too, digesting a PDF passage by passage so the
 * Studio could compose from it. Sources are no longer read by a model at all,
 * so the only job left is preparation, and its subject is a note.
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { academiaStore, type QuestionBank } from "@/lib/academiaStore";
import { awaitIdle, describeFailure, unloadModel, type LocalLLMConfig } from "@/lib/localLLM";
import { CHUNKING_VERSION, chunkSource } from "@/lib/textChunks";
import { emptyBank, hashOfChunk, poolConfig, POOL_SIZE } from "@/lib/recallBank";
import { createLlmGenerator } from "@/lib/recallLlm";
import { loadRecallConfig } from "@/lib/recallRound";

export type ForgeJobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface ForgeJob {
  id: string;
  kind: "prepare";
  /** The corpus the job is about — `note:<id>` today. */
  corpusId: string;
  label: string;
  status: ForgeJobStatus;
  done: number;
  total: number;
  message: string;
  error?: string;
}

/** What a job needs to know about its material, without knowing where it came from. */
export interface ForgeCorpus {
  id: string;
  name: string;
  text: string;
}

interface ForgeJobsApi {
  jobs: ForgeJob[];
  active: ForgeJob | null;
  queued: number;
  /** Bumped whenever a job writes to the store, so pages can reload. */
  revision: number;
  /** Write a pool of questions for every passage, so studying costs no model time. */
  enqueuePrepare: (input: { profileId: number; corpus: ForgeCorpus; cfg: LocalLLMConfig }) => void;
  isPending: (corpusId: string) => boolean;
  cancel: (id: string) => void;
  cancelAll: () => void;
  dismiss: (id: string) => void;
}

const ForgeJobsContext = createContext<ForgeJobsApi | null>(null);

interface Pending {
  job: ForgeJob;
  profileId: number;
  corpus: ForgeCorpus;
  cfg: LocalLLMConfig;
}

/**
 * Write questions for every passage of one corpus.
 *
 * The expensive half of Quantum Recall, moved out of study time entirely. Saved
 * passage by passage, so cancelling costs the one in flight; a passage that the
 * model cannot produce questions for is skipped rather than stopping the job,
 * because Recall State falls back to generating on the spot for anything the
 * bank is missing.
 */
async function prepareCorpus(
  pending: Pending,
  signal: AbortSignal,
  onProgress: (done: number, total: number, label: string) => void,
  onPartial: (bank: QuestionBank) => Promise<void>,
): Promise<QuestionBank> {
  const config = poolConfig(loadRecallConfig());
  const chunks = chunkSource(pending.corpus.id, pending.corpus.text, { targetChars: config.chunkTargetChars });

  const existing = (await academiaStore.banks(pending.profileId)).find(item => item.id === pending.corpus.id);
  const bank = emptyBank(
    pending.corpus.id, pending.profileId, pending.cfg.model,
    CHUNKING_VERSION, config.chunkTargetChars, chunks.length,
  );
  // Reuse whatever a previous run of this job already wrote. Pools are keyed by
  // content hash, so an edited note keeps the questions for every passage whose
  // text did not change.
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
    onProgress(i, chunks.length, `${pending.corpus.name} — questions for passage ${i + 1} of ${chunks.length}`);

    const already = bank.pools[hash];
    if (Array.isArray(already) && already.length >= POOL_SIZE) continue;

    try {
      const round = await generator.generate({
        chunk,
        siblings: chunks.filter(other => other.index !== chunk.index).slice(0, 6),
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
  onProgress(chunks.length, chunks.length, `${pending.corpus.name} prepared`);
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
          const bank = await prepareCorpus(
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
      // Nothing else is queued, and the next job may be an hour away. Holding
      // several gigabytes resident until the keep-alive lapses is a large part
      // of why a machine that is doing nothing still feels slow.
      if (lastCfgRef.current) void unloadModel(lastCfgRef.current);
    }
  }, [patch]);

  // `drain` closes over fresh state each render; the ref keeps `enqueuePrepare`
  // stable without re-queuing anything.
  const drainRef = useRef(drain);
  drainRef.current = drain;

  const enqueuePrepare = useCallback<ForgeJobsApi["enqueuePrepare"]>(({ profileId, corpus, cfg }) => {
    // The same work queued twice would produce the same result twice.
    const alreadyPending =
      pendingRef.current.some(item => item.corpus.id === corpus.id) ||
      jobs.some(job => job.corpusId === corpus.id && job.status === "running");
    if (alreadyPending) return;

    const job: ForgeJob = {
      id: `job-${++jobSeq}`,
      kind: "prepare",
      corpusId: corpus.id,
      label: `${corpus.name} · questions`,
      status: "queued",
      done: 0,
      total: 0,
      message: "Queued",
    };
    setJobs(old => [
      ...old.filter(item => item.corpusId !== corpus.id || item.status === "running"),
      job,
    ]);
    pendingRef.current.push({ job, profileId, corpus, cfg });
    void drainRef.current();
  }, [jobs]);

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
      enqueuePrepare,
      isPending: corpusId => jobs.some(job => job.corpusId === corpusId && (job.status === "queued" || job.status === "running")),
      cancel,
      cancelAll,
      dismiss,
    };
  }, [jobs, revision, enqueuePrepare, cancel, cancelAll, dismiss]);

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
  enqueuePrepare: () => {}, isPending: () => false,
  cancel: () => {}, cancelAll: () => {}, dismiss: () => {},
};
