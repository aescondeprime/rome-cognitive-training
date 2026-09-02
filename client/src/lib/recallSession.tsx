/**
 * A Quantum Recall run, owned above the router.
 *
 * It used to live inside the page, and three problems followed from that, all
 * of which are really the same problem:
 *
 * 1. **Rounds were cancelled after every round.** The queue was built in a
 *    `useEffect` whose cleanup cancelled it, and its dependencies included the
 *    ledger — which changes the moment a round is recorded. So finishing a round
 *    cancelled the queue that was writing the next one, `next()` threw, the
 *    error was swallowed as a cancellation, and the run sat on "building" with
 *    no model call in flight. Leaving and re-entering rebuilt it, which is why
 *    it always worked the "first" time.
 * 2. **Leaving lost the run.** Generation takes minutes on a local model, and
 *    the only thing to do while waiting was watch it.
 * 3. **The reading clock ran whether or not anyone was reading.**
 *
 * So the session is a provider now. React renders it; it does not live or die
 * by rendering. The page attaches and detaches, and that is the *only* thing
 * that starts and stops the clock — walk away mid-passage and the timer waits
 * for you.
 *
 * The other shape change: a round's passage is known before its questions are.
 * `RoundQueue.next()` returns the chunk synchronously and the questions on a
 * promise, so reading starts at once and generation runs against the reading
 * clock rather than in front of it. If the clock runs out first the passage
 * stays up and says so, rather than showing an empty question.
 *
 * **The corpus is the note, and only the note.** Sources are documents to read
 * and annotate now, not material for a model, so there is nothing to choose
 * between and no corpus tab. The note is read from the shared pointer in
 * `activeNote` rather than handed over once on entry, which is what makes the
 * run follow the Forge instead of naming a note you have since left. A run
 * already in progress keeps the note it started on — swapping material under a
 * live ledger would make coverage mean two things — and reports the drift.
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  academiaStore, type AcademiaNote, type LedgerEntry, type QuestionBank, type SourceLedger,
} from "@/lib/academiaStore";
import { getActiveNoteId, onActiveNoteChange } from "@/lib/activeNote";
import { CHUNKING_VERSION, chunkSource, type Chunk } from "@/lib/textChunks";
import { coverageOf, emptyLedger, pickNextChunk, pruneLedger, recordRound, type Coverage } from "@/lib/recallLedger";
import {
  gradeObjective, loadRecallConfig, RoundQueue, saveRecallConfig, secondsToAnswer, secondsToRead,
  type Answer, type Graded, type PendingRound, type RecallConfig, type Round, type Verdict,
} from "@/lib/recallRound";
import { createMockGenerator } from "@/lib/recallGenerator";
import { createLlmGenerator } from "@/lib/recallLlm";
import { createBankedGenerator } from "@/lib/recallBank";
import { beginInteractive, loadLLMConfig, probeLocalLLM, type LocalLLMConfig } from "@/lib/localLLM";

/** Imitated model latency for the mock, so the pipeline is under real load. */
const MOCK_LATENCY_MS = 2_600;

export type RecallPhase =
  | "idle"        // nothing running
  | "loading"     // gathering material
  | "ready"       // material in hand, first round being written
  | "reading"     // passage on screen, clock running while attached
  | "waiting"     // clock done, questions not
  | "answering"
  | "grading"
  | "review"
  | "summary"
  | "error";

/** A note is chunked under its own id, so it gets its own ledger. */
export function noteCorpusId(noteId: string): string {
  return `note:${noteId}`;
}

interface RoundRecord { round: Round; graded: Graded[] }

export interface RecallSessionApi {
  phase: RecallPhase;
  active: boolean;
  error: string | null;
  failures: string[];

  config: RecallConfig;
  setConfig: (config: RecallConfig) => void;

  /** The note the run is over. Null until the material has loaded. */
  note: AcademiaNote | null;
  chunks: Chunk[];
  corpusLabel: string;
  coverage: Coverage;
  banked: number;
  /**
   * The Forge has moved to another note while a run is in progress.
   *
   * Named rather than acted on: ending someone's run because they opened a
   * different note in another tab would be worse than saying so.
   */
  noteDrift: string | null;
  /** Take the drift: end this run and start over on the note now open. */
  followNote: () => void;

  engine: "model" | "mock";
  setEngine: (engine: "model" | "mock") => void;
  modelReady: boolean;
  model: string;
  llmConfig: LocalLLMConfig;

  /** The passage on screen, known before its questions. */
  passage: Chunk | null;
  round: Round | null;
  questionIndex: number;
  graded: Graded[];
  history: RoundRecord[];
  buffered: number;

  /** Absolute `performance.now()` the current step ends at, or null while paused. */
  deadlineAt: number | null;
  stepSeconds: number;

  load: () => void;
  begin: () => void;
  skipReading: () => void;
  submit: (value: string | number | null) => void;
  expire: () => void;
  nextRound: () => void;
  endSession: () => void;
  override: (index: number) => void;
  reset: () => void;
  /** End whatever is running and go straight back to a startable state. */
  restart: () => void;

  /** The page calls these on mount and unmount. Nothing else starts the clock. */
  attach: () => void;
  detach: () => void;
  attached: boolean;
}

const RecallContext = createContext<RecallSessionApi | null>(null);

export function RecallSessionProvider({ children }: { children: ReactNode }) {
  const { data: profile } = useQuery<{ id: number }>({ queryKey: ["/api/active-profile"] });
  const profileId = profile?.id;

  const [phase, setPhase] = useState<RecallPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState<string[]>([]);
  const [config, setConfigState] = useState<RecallConfig>(() => loadRecallConfig());

  const [note, setNote] = useState<AcademiaNote | null>(null);
  const [openNote, setOpenNote] = useState<AcademiaNote | null>(null);
  const [ledgers, setLedgers] = useState<Record<string, SourceLedger>>({});
  const [banks, setBanks] = useState<QuestionBank[]>([]);

  const [llmCfg, setLlmCfg] = useState<LocalLLMConfig>(() => loadLLMConfig());
  const [modelReady, setModelReady] = useState(false);
  const [engine, setEngineState] = useState<"model" | "mock">("model");

  const [passage, setPassage] = useState<Chunk | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [graded, setGraded] = useState<Graded[]>([]);
  const [history, setHistory] = useState<RoundRecord[]>([]);
  const [buffered, setBuffered] = useState(0);
  const [attached, setAttached] = useState(false);

  const [deadlineAt, setDeadlineAt] = useState<number | null>(null);
  const [stepSeconds, setStepSeconds] = useState(0);
  const remainingRef = useRef<number | null>(null);

  const queueRef = useRef<RoundQueue | null>(null);
  const pendingRef = useRef<PendingRound | null>(null);
  const answersRef = useRef<Answer[]>([]);
  const generatorRef = useRef(createMockGenerator({ latencyMs: MOCK_LATENCY_MS }));
  const interactiveRef = useRef<(() => void) | null>(null);
  const questionStartRef = useRef(0);
  const ledgerRef = useRef<SourceLedger | null>(null);
  const phaseRef = useRef<RecallPhase>("idle");
  phaseRef.current = phase;

  /* ── Material ────────────────────────────────────────────────────── */

  const chunks = useMemo(
    () => note?.content.trim() ? chunkSource(noteCorpusId(note.id), note.content, { targetChars: config.chunkTargetChars }) : [],
    [note, config.chunkTargetChars],
  );
  const corpusId = note ? noteCorpusId(note.id) : "";
  const corpusLabel = note?.title || "Untitled Note";

  const pooled = useMemo<SourceLedger>(() => {
    const stored = corpusId ? ledgers[corpusId] : undefined;
    // A ledger measured at a different excerpt size was measuring different
    // passages, so it is ignored rather than mixed in.
    const entries: Record<string, LedgerEntry> =
      stored && stored.targetChars === config.chunkTargetChars && stored.chunkingVersion === CHUNKING_VERSION
        ? stored.entries
        : {};
    return { id: "pooled", profileId: profileId ?? 0, chunkingVersion: CHUNKING_VERSION, targetChars: config.chunkTargetChars, entries, updatedAt: 0 };
  }, [ledgers, corpusId, profileId, config.chunkTargetChars]);
  ledgerRef.current = pooled;

  const coverage = useMemo(() => coverageOf(chunks, pooled), [chunks, pooled]);

  const bankMap = useMemo(() => new Map(banks.map(bank => [bank.id, bank])), [banks]);
  const banked = useMemo(() => {
    let total = 0;
    for (const chunk of chunks) {
      const bank = bankMap.get(chunk.sourceId);
      const pool = bank?.pools[chunk.id.slice(chunk.id.lastIndexOf(":") + 1)];
      if (Array.isArray(pool) && pool.length >= config.questionsPerRound) total++;
    }
    return total;
  }, [chunks, bankMap, config.questionsPerRound]);

  const running = phase === "reading" || phase === "waiting" || phase === "answering" || phase === "grading" || phase === "review";
  const noteDrift = running && openNote && openNote.id !== note?.id ? openNote.title : null;

  const load = useCallback(() => {
    if (!profileId) return;
    setPhase("loading");
    setError(null);
    void (async () => {
      try {
        const [allNotes, allLedgers, allBanks] = await Promise.all([
          academiaStore.notes(profileId), academiaStore.ledgers(profileId), academiaStore.banks(profileId),
        ]);

        const activeId = getActiveNoteId();
        const chosen = allNotes.find(item => item.id === activeId) ?? null;
        if (!chosen?.content.trim()) {
          setError("Nothing to drill. Open a note in the Knowledge Forge and write something in it, then enter Recall State.");
          setPhase("error");
          return;
        }

        const byId: Record<string, SourceLedger> = {};
        for (const ledger of allLedgers) byId[ledger.id] = ledger;

        const cfg = loadLLMConfig();
        setLlmCfg(cfg);
        const status = await probeLocalLLM(cfg);
        const ready = status.state === "ready" && !!cfg.model;

        setNote(chosen);
        setOpenNote(chosen);
        setLedgers(byId);
        setBanks(allBanks);
        setModelReady(ready);
        setEngineState(ready ? "model" : "mock");
        setPhase("ready");
      } catch {
        setError("Could not load the note.");
        setPhase("error");
      }
    })();
  }, [profileId]);

  const loadRef = useRef(load);
  loadRef.current = load;

  /**
   * Follow the Forge's selection.
   *
   * Between runs the note simply changes under the ready screen, which is what
   * "purely the current note" means. During a run the new note is remembered as
   * drift and nothing else happens, because the ledger being written belongs to
   * the note the run started on.
   */
  useEffect(() => {
    const pick = async () => {
      if (!profileId) return;
      const activeId = getActiveNoteId();
      const notes = await academiaStore.notes(profileId);
      const chosen = notes.find(item => item.id === activeId) ?? null;
      setOpenNote(chosen);
      const live = phaseRef.current;
      if (live === "reading" || live === "waiting" || live === "answering" || live === "grading" || live === "review") return;
      if (live === "idle") return;
      if (chosen?.id !== note?.id) loadRef.current();
    };
    return onActiveNoteChange(() => { void pick(); });
  }, [note?.id, profileId]);

  /* ── The queue ───────────────────────────────────────────────────── */

  const buildQueue = useCallback(() => {
    queueRef.current?.cancel();
    setBuffered(0);

    const live = engine === "model" && modelReady
      ? createLlmGenerator({
          cfg: llmCfg,
          onQuestionFailure: (type, reason) =>
            setFailures(old => [...old.slice(-4), `${type}: ${reason}`]),
        })
      : createMockGenerator({ latencyMs: MOCK_LATENCY_MS });

    // Banked questions first; the model only for passages that have none.
    generatorRef.current = createBankedGenerator({
      banks: bankMap, model: llmCfg.model, chunkingVersion: CHUNKING_VERSION, fallback: live,
    });

    const queue = new RoundQueue({
      generator: generatorRef.current,
      config,
      depth: config.bufferDepth,
      // Reads the ledger through a ref, so recording a round never invalidates
      // the queue. This is the bug that cancelled generation after every round.
      pick: lastHash => pickNextChunk(chunks, ledgerRef.current ?? pooled, { reviewRatio: config.reviewRatio, lastHash }),
      siblings: chunk => chunks.filter(other => other.sourceId === chunk.sourceId && other.index !== chunk.index).slice(0, 6),
      onBuffered: setBuffered,
    });
    queueRef.current = queue;
    return queue;
  }, [bankMap, chunks, config, engine, llmCfg, modelReady, pooled]);

  /** Write ahead as soon as there is material, wherever the user happens to be. */
  useEffect(() => {
    if (phase !== "ready" || !chunks.length) return;
    buildQueue().prime();
    // No cleanup that cancels: the queue outlives this render, and cancelling
    // it here is precisely what used to break the run.
  }, [phase, chunks.length, buildQueue]);

  /* ── The clock, which only runs while someone is looking ─────────── */

  const startStep = useCallback((seconds: number) => {
    setStepSeconds(seconds);
    remainingRef.current = seconds * 1000;
    setDeadlineAt(attached ? performance.now() + seconds * 1000 : null);
  }, [attached]);

  const attach = useCallback(() => {
    setAttached(true);
    if (remainingRef.current !== null) setDeadlineAt(performance.now() + remainingRef.current);
  }, []);

  const detach = useCallback(() => {
    setAttached(false);
    setDeadlineAt(current => {
      if (current !== null) remainingRef.current = Math.max(0, current - performance.now());
      return null;
    });
  }, []);

  /* ── Round flow ──────────────────────────────────────────────────── */

  const attachQuestions = useCallback((pending: PendingRound) => {
    pending.round.then(
      next => {
        if (pendingRef.current !== pending) return;
        setRound(next);
        // The clock may already have run out while this was being written.
        if (phaseRef.current === "waiting") {
          setQuestionIndex(0);
          answersRef.current = [];
          setPhase("answering");
          questionStartRef.current = performance.now();
          startStep(secondsToAnswer(next.questions[0].type, config));
        }
      },
      failure => {
        if (pendingRef.current !== pending) return;
        if (failure instanceof DOMException && failure.name === "AbortError") return;
        setFailures(old => [...old.slice(-4), failure instanceof Error ? failure.message : "round failed"]);
        // One passage that cannot produce questions is not the end of the run.
        drawRef.current();
      },
    );
  }, [config, startStep]);

  const draw = useCallback(() => {
    const queue = queueRef.current ?? buildQueue();
    const pending = queue.next();
    if (!pending) {
      setError("There is nothing left to draw a round from.");
      setPhase("error");
      return;
    }
    pendingRef.current = pending;
    setPassage(pending.chunk);
    setRound(null);
    setGraded([]);
    answersRef.current = [];
    setPhase("reading");
    startStep(secondsToRead(pending.chunk.text, config));
    attachQuestions(pending);
  }, [attachQuestions, buildQueue, config, startStep]);

  const drawRef = useRef(draw);
  drawRef.current = draw;

  const begin = useCallback(() => {
    if (!chunks.length) return;
    setHistory([]);
    setFailures([]);
    setError(null);
    interactiveRef.current?.();
    interactiveRef.current = beginInteractive();
    if (!queueRef.current?.isPrimed) buildQueue().prime();
    draw();
  }, [buildQueue, chunks.length, draw]);

  const askQuestion = useCallback((current: Round, index: number) => {
    setQuestionIndex(index);
    questionStartRef.current = performance.now();
    setPhase("answering");
    startStep(secondsToAnswer(current.questions[index].type, config));
  }, [config, startStep]);

  const commitRound = useCallback(async (current: Round, results: Graded[]) => {
    if (!profileId) return;
    const chunk = chunks.find(item => item.id === current.chunkId);
    if (!chunk) return;
    const stored = ledgers[current.sourceId];
    const usable = stored && stored.targetChars === config.chunkTargetChars && stored.chunkingVersion === CHUNKING_VERSION
      ? pruneLedger(stored, chunks.filter(candidate => candidate.sourceId === current.sourceId))
      : emptyLedger(current.sourceId, profileId, config.chunkTargetChars, CHUNKING_VERSION);

    const updated = recordRound(usable, chunk, results.map(item => ({
      type: item.question.type, correct: item.verdict === "correct",
    })));
    await academiaStore.saveLedger(updated);

    const next = { ...ledgers, [current.sourceId]: updated };
    // The queue reads the ledger through this ref rather than through a
    // dependency, so recording a round informs the scheduler without
    // invalidating anything.
    ledgerRef.current = { ...pooled, entries: next[current.sourceId]?.entries ?? {} };
    setLedgers(next);
  }, [chunks, config.chunkTargetChars, ledgers, pooled, profileId]);

  const finishRound = useCallback(async (current: Round) => {
    setPhase("grading");
    setDeadlineAt(null);
    remainingRef.current = null;
    const answers = answersRef.current;
    const results: Graded[] = [];

    for (let i = 0; i < current.questions.length; i++) {
      const question = current.questions[i];
      const answer = answers[i] ?? { value: null, elapsedMs: 0, expired: true };
      if (question.type === "open" && !answer.expired && String(answer.value ?? "").trim()) {
        try {
          const judged = await generatorRef.current.gradeOpen({ question, answer: String(answer.value) });
          results.push({ question, answer, verdict: judged.verdict, note: judged.note });
          continue;
        } catch {
          results.push({ question, answer, verdict: "partial", note: "The grader could not be reached." });
          continue;
        }
      }
      results.push({ question, answer, verdict: gradeObjective(question, answer) });
    }

    setGraded(results);
    setHistory(old => [...old, { round: current, graded: results }]);
    setPhase("review");
    void commitRound(current, results);
  }, [commitRound]);

  const advance = useCallback((current: Round, index: number) => {
    if (index + 1 < current.questions.length) askQuestion(current, index + 1);
    else void finishRound(current);
  }, [askQuestion, finishRound]);

  const submit = useCallback((value: string | number | null) => {
    if (!round || phaseRef.current !== "answering") return;
    if (value === null || value === "") return;
    answersRef.current.push({ value, elapsedMs: performance.now() - questionStartRef.current, expired: false });
    advance(round, questionIndex);
  }, [advance, questionIndex, round]);

  /** The clock ran out. Meaning depends on which step it was. */
  const expire = useCallback(() => {
    const current = phaseRef.current;
    if (current === "reading") {
      if (round) { setQuestionIndex(0); answersRef.current = []; askQuestion(round, 0); }
      // Questions are not written yet: hold the passage rather than show a gap.
      else { setPhase("waiting"); setDeadlineAt(null); remainingRef.current = null; }
      return;
    }
    if (current === "answering" && round) {
      const question = round.questions[questionIndex];
      answersRef.current.push({ value: null, elapsedMs: secondsToAnswer(question.type, config) * 1000, expired: true });
      advance(round, questionIndex);
    }
  }, [advance, askQuestion, config, questionIndex, round]);

  const skipReading = useCallback(() => {
    if (phaseRef.current !== "reading" || !config.earlyRead) return;
    if (round) { setQuestionIndex(0); answersRef.current = []; askQuestion(round, 0); }
    else { setPhase("waiting"); setDeadlineAt(null); remainingRef.current = null; }
  }, [askQuestion, config.earlyRead, round]);

  const nextRound = useCallback(() => { draw(); }, [draw]);

  /** Stop the queue and release the interactive claim. Shared by every exit. */
  const stopWork = useCallback(() => {
    setDeadlineAt(null);
    remainingRef.current = null;
    queueRef.current?.cancel();
    queueRef.current = null;
    pendingRef.current = null;
    interactiveRef.current?.();
    interactiveRef.current = null;
  }, []);

  const endSession = useCallback(() => {
    stopWork();
    setPhase("summary");
  }, [stopWork]);

  const override = useCallback((index: number) => {
    setGraded(old => old.map((item, i) => i === index ? { ...item, verdict: "correct" as Verdict, overridden: true } : item));
  }, []);

  const reset = useCallback(() => {
    stopWork();
    setPhase("idle");
    setPassage(null);
    setRound(null);
    setHistory([]);
    setGraded([]);
  }, [stopWork]);

  /**
   * Stop everything and come back ready to start again.
   *
   * `reset` alone leaves the session idle, and only a fresh mount reloads the
   * material — which meant "end this and start another" required leaving the
   * page and coming back. This is that, without the round trip.
   */
  const restart = useCallback(() => {
    stopWork();
    setHistory([]);
    setPassage(null);
    setRound(null);
    setPhase("ready");
  }, [stopWork]);

  /** Take the drift: the run ends and the note now open becomes the material. */
  const followNote = useCallback(() => {
    stopWork();
    setHistory([]);
    setPassage(null);
    setRound(null);
    load();
  }, [load, stopWork]);

  const setConfig = useCallback((next: RecallConfig) => { setConfigState(next); saveRecallConfig(next); }, []);
  const setEngine = useCallback((next: "model" | "mock") => { setEngineState(next); queueRef.current?.cancel(); queueRef.current = null; }, []);

  const value = useMemo<RecallSessionApi>(() => ({
    phase, active: phase !== "idle" && phase !== "error", error, failures,
    config, setConfig,
    note, chunks, corpusLabel, coverage, banked, noteDrift, followNote,
    engine, setEngine, modelReady, model: llmCfg.model, llmConfig: llmCfg,
    passage, round, questionIndex, graded, history, buffered,
    deadlineAt, stepSeconds,
    load, begin, skipReading, submit, expire, nextRound, endSession, override, reset, restart,
    attach, detach, attached,
  }), [
    phase, error, failures, config, setConfig, note, chunks, corpusLabel, coverage, banked,
    noteDrift, followNote, engine, setEngine, modelReady, llmCfg,
    passage, round, questionIndex, graded, history, buffered, deadlineAt, stepSeconds,
    load, begin, skipReading, submit, expire, nextRound, endSession, override, reset, restart,
    attach, detach, attached,
  ]);

  return <RecallContext.Provider value={value}>{children}</RecallContext.Provider>;
}

export function useRecallSession(): RecallSessionApi {
  const context = useContext(RecallContext);
  if (!context) throw new Error("useRecallSession outside RecallSessionProvider");
  return context;
}

/** Whether a run exists at all, for chrome that must not assume the provider. */
export function useRecallSessionOptional(): RecallSessionApi | null {
  return useContext(RecallContext);
}
