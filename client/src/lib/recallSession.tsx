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
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  academiaStore, type AcademiaNote, type AcademiaSource, type ClaimAlignment,
  type LedgerEntry, type QuestionBank, type RecallArchive, type SourceDigest, type SourceLedger,
} from "@/lib/academiaStore";
import { compareArchive, composeGapNote, gatherClaims, type CompareProgress } from "@/lib/recallCompare";
import { CHUNKING_VERSION, chunkSource, type Chunk } from "@/lib/textChunks";
import { coverageOf, emptyLedger, pickNextChunk, pruneLedger, recordRound, type Coverage } from "@/lib/recallLedger";
import {
  gradeObjective, loadRecallConfig, RoundQueue, saveRecallConfig, secondsToAnswer, secondsToRead,
  type Answer, type Graded, type PassageAnchor, type PendingRound, type Question,
  type RecallConfig, type Round, type Verdict,
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
  | "archive"     // writing down what you can recall, untimed, sources hidden
  | "comparing"   // holding each claim up against what you wrote
  | "compare"     // the result, with the gaps to confirm
  | "manual"      // no read to compare against: the material beside what you wrote
  | "error";

export type Corpus = "sources" | "note";

export interface RecallHandoff { sourceIds: string[]; noteId?: string }

/** A note is chunked under its own id, so it gets its own ledger. */
export function noteCorpusId(noteId: string): string {
  return `note:${noteId}`;
}

export const RECALL_SESSION_KEY = "rome.academia.recall.session";

interface RoundRecord { round: Round; graded: Graded[] }

export interface RecallSessionApi {
  phase: RecallPhase;
  active: boolean;
  error: string | null;
  failures: string[];

  config: RecallConfig;
  setConfig: (config: RecallConfig) => void;

  corpus: Corpus;
  setCorpus: (corpus: Corpus) => void;
  sources: AcademiaSource[];
  note: AcademiaNote | null;
  chunks: Chunk[];
  corpusLabel: string;
  coverage: Coverage;
  anchored: number;
  banked: number;

  engine: "model" | "mock";
  setEngine: (engine: "model" | "mock") => void;
  modelReady: boolean;
  model: string;

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

  /* The Archive, and what came of it. */
  archiveText: string;
  setArchiveText: (text: string) => void;
  alignments: ClaimAlignment[];
  compareProgress: CompareProgress | null;
  claimCount: number;
  gapNoteId: string | null;
  openArchive: () => void;
  runCompare: () => void;
  toggleGap: (claim: string) => void;
  makeGapNote: () => void;
  /** Mark a passage, or a phrase from one, as something you missed. */
  addManualGap: (claim: string, chunk: Chunk) => void;
  removeGap: (claim: string) => void;
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

  const [sources, setSources] = useState<AcademiaSource[]>([]);
  const [note, setNote] = useState<AcademiaNote | null>(null);
  const [corpus, setCorpusState] = useState<Corpus>("sources");
  const [ledgers, setLedgers] = useState<Record<string, SourceLedger>>({});
  const [digests, setDigests] = useState<SourceDigest[]>([]);
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
  const [archiveText, setArchiveTextState] = useState("");
  const [alignments, setAlignments] = useState<ClaimAlignment[]>([]);
  const [compareProgress, setCompareProgress] = useState<CompareProgress | null>(null);
  const [gapNoteId, setGapNoteId] = useState<string | null>(null);
  const archiveIdRef = useRef<string>("");
  const compareAbortRef = useRef<AbortController | null>(null);
  const saveArchiveRef = useRef<number | null>(null);

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

  const sourceChunks = useMemo(
    () => sources.flatMap(source => chunkSource(source.id, source.text, { targetChars: config.chunkTargetChars })),
    [sources, config.chunkTargetChars],
  );
  const noteChunks = useMemo(
    () => note?.content.trim() ? chunkSource(noteCorpusId(note.id), note.content, { targetChars: config.chunkTargetChars }) : [],
    [note, config.chunkTargetChars],
  );
  const chunks = corpus === "sources" ? sourceChunks : noteChunks;
  const corpusIds = useMemo(
    () => corpus === "sources" ? sources.map(source => source.id) : note ? [noteCorpusId(note.id)] : [],
    [corpus, sources, note],
  );
  const corpusLabel = corpus === "sources"
    ? sources.map(source => source.name).join(" · ") || "—"
    : note?.title || "Untitled Note";

  const pooled = useMemo<SourceLedger>(() => {
    const entries: Record<string, LedgerEntry> = {};
    for (const id of corpusIds) {
      const ledger = ledgers[id];
      // A ledger measured at a different excerpt size was measuring different
      // passages, so it is ignored rather than mixed in.
      if (!ledger || ledger.targetChars !== config.chunkTargetChars || ledger.chunkingVersion !== CHUNKING_VERSION) continue;
      Object.assign(entries, ledger.entries);
    }
    return { id: "pooled", profileId: profileId ?? 0, chunkingVersion: CHUNKING_VERSION, targetChars: config.chunkTargetChars, entries, updatedAt: 0 };
  }, [ledgers, corpusIds, profileId, config.chunkTargetChars]);
  ledgerRef.current = pooled;

  const coverage = useMemo(() => coverageOf(chunks, pooled), [chunks, pooled]);

  const anchors = useMemo(() => {
    const map = new Map<string, PassageAnchor>();
    for (const digest of digests) {
      if (!corpusIds.includes(digest.id)) continue;
      for (const item of digest.passages) map.set(item.hash, { summary: item.summary, points: item.points, terms: item.terms });
    }
    return map;
  }, [digests, corpusIds]);

  const bankMap = useMemo(() => new Map(banks.map(bank => [bank.id, bank])), [banks]);
  const anchored = useMemo(
    () => chunks.filter(chunk => anchors.has(chunk.id.slice(chunk.id.lastIndexOf(":") + 1))).length,
    [chunks, anchors],
  );
  const banked = useMemo(() => {
    let total = 0;
    for (const chunk of chunks) {
      const bank = bankMap.get(chunk.sourceId);
      const pool = bank?.pools[chunk.id.slice(chunk.id.lastIndexOf(":") + 1)];
      if (Array.isArray(pool) && pool.length >= config.questionsPerRound) total++;
    }
    return total;
  }, [chunks, bankMap, config.questionsPerRound]);

  const load = useCallback(() => {
    if (!profileId) return;
    setPhase("loading");
    setError(null);
    void (async () => {
      try {
        const raw = localStorage.getItem(RECALL_SESSION_KEY);
        const handoff: RecallHandoff = raw ? JSON.parse(raw) : { sourceIds: [] };
        const [allSources, allNotes, allLedgers, allDigests, allBanks] = await Promise.all([
          academiaStore.sources(profileId), academiaStore.notes(profileId),
          academiaStore.ledgers(profileId), academiaStore.digests(profileId), academiaStore.banks(profileId),
        ]);

        const armed = handoff.sourceIds.length ? allSources.filter(source => handoff.sourceIds.includes(source.id)) : [];
        const chosen = handoff.noteId ? allNotes.find(item => item.id === handoff.noteId) ?? null : null;
        const usableNote = chosen?.content.trim() ? chosen : null;
        if (!armed.length && !usableNote) {
          setError("Nothing to draw from. Arm a source or open a note in the Knowledge Forge, then enter Recall State.");
          setPhase("error");
          return;
        }

        const byId: Record<string, SourceLedger> = {};
        for (const ledger of allLedgers) byId[ledger.id] = ledger;

        const cfg = loadLLMConfig();
        setLlmCfg(cfg);
        const status = await probeLocalLLM(cfg);
        const ready = status.state === "ready" && !!cfg.model;

        setSources(armed);
        setNote(usableNote);
        setCorpusState(armed.length ? "sources" : "note");
        setLedgers(byId);
        setDigests(allDigests);
        setBanks(allBanks);
        setModelReady(ready);
        setEngineState(ready ? "model" : "mock");
        setPhase("ready");
      } catch {
        setError("Could not load the material.");
        setPhase("error");
      }
    })();
  }, [profileId]);

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
      anchor: chunk => anchors.get(chunk.id.slice(chunk.id.lastIndexOf(":") + 1)),
      onBuffered: setBuffered,
    });
    queueRef.current = queue;
    return queue;
  }, [anchors, bankMap, chunks, config, engine, llmCfg, modelReady, pooled]);

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
    const entries: Record<string, LedgerEntry> = {};
    for (const id of corpusIds) if (next[id]) Object.assign(entries, next[id].entries);
    // The queue reads the ledger through this ref rather than through a
    // dependency, so recording a round informs the scheduler without
    // invalidating anything.
    ledgerRef.current = { ...pooled, entries };
    setLedgers(next);
  }, [chunks, config.chunkTargetChars, corpusIds, ledgers, pooled, profileId]);

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

  const endSession = useCallback(() => {
    setDeadlineAt(null);
    remainingRef.current = null;
    // A comparison in flight is stopped too — ending means ending.
    compareAbortRef.current?.abort();
    setCompareProgress(null);
    queueRef.current?.cancel();
    queueRef.current = null;
    pendingRef.current = null;
    interactiveRef.current?.();
    interactiveRef.current = null;
    setPhase("summary");
  }, []);

  const override = useCallback((index: number) => {
    setGraded(old => old.map((item, i) => i === index ? { ...item, verdict: "correct" as Verdict, overridden: true } : item));
  }, []);

  /* ── The Archive ─────────────────────────────────────────────────── */

  const claims = useMemo(() => gatherClaims(digests, corpusIds), [digests, corpusIds]);

  const persistArchive = useCallback(async (text: string, nextAlignments: ClaimAlignment[], compared: boolean) => {
    if (!profileId || !archiveIdRef.current) return;
    const now = Date.now();
    const record: RecallArchive = {
      id: archiveIdRef.current, profileId, corpusIds, label: corpusLabel,
      text, alignments: nextAlignments, compared, createdAt: now, updatedAt: now,
    };
    await academiaStore.saveArchive(record);
  }, [corpusIds, corpusLabel, profileId]);

  /**
   * Debounced, because this is a textarea someone is typing into and a write
   * per keystroke would be absurd — but it is saved, because leaving mid-write
   * should cost nothing here as it costs nothing anywhere else in this feature.
   */
  const setArchiveText = useCallback((text: string) => {
    setArchiveTextState(text);
    if (saveArchiveRef.current) clearTimeout(saveArchiveRef.current);
    saveArchiveRef.current = window.setTimeout(() => void persistArchive(text, [], false), 500);
  }, [persistArchive]);

  const openArchive = useCallback(() => {
    setDeadlineAt(null);
    remainingRef.current = null;
    queueRef.current?.cancel();
    queueRef.current = null;
    pendingRef.current = null;
    interactiveRef.current?.();
    interactiveRef.current = null;
    if (!archiveIdRef.current) archiveIdRef.current = crypto.randomUUID();
    setAlignments([]);
    setGapNoteId(null);
    setPhase("archive");
  }, []);

  const runCompare = useCallback(() => {
    if (!archiveText.trim()) return;
    // Nothing read means nothing to align against — but that is a reason to do
    // the comparison by hand, not a dead end. The material goes up beside what
    // you wrote and you mark the gaps yourself.
    if (!claims.length) { setPhase("manual"); return; }
    compareAbortRef.current?.abort();
    const controller = new AbortController();
    compareAbortRef.current = controller;
    setPhase("comparing");

    void (async () => {
      try {
        const result = await compareArchive({
          cfg: llmCfg, claims, archive: archiveText,
          signal: controller.signal,
          onProgress: setCompareProgress,
          onPartial: async partial => {
            setAlignments(partial);
            await persistArchive(archiveText, partial, false);
          },
        });
        setAlignments(result);
        await persistArchive(archiveText, result, true);
        setCompareProgress(null);
        setPhase("compare");
      } catch (failure) {
        if (controller.signal.aborted) return;
        setError(failure instanceof Error ? failure.message : "The comparison could not be completed.");
        setPhase("error");
      }
    })();
  }, [archiveText, claims, llmCfg, persistArchive]);

  /**
   * A gap you found yourself.
   *
   * Confirmed on arrival, unlike a proposed one: you are the one who decided it
   * was missing, so there is nothing to confirm. It carries its passage
   * reference the same way, which is what lets the derived note point back at
   * the text.
   */
  const addManualGap = useCallback((claim: string, chunk: Chunk) => {
    const text = claim.trim();
    if (!text) return;
    setAlignments(old => {
      if (old.some(item => item.claim === text)) return old;
      const next: ClaimAlignment[] = [...old, {
        claim: text,
        sourceId: chunk.sourceId,
        chunkIndex: chunk.index,
        chunkHash: chunk.id.slice(chunk.id.lastIndexOf(":") + 1),
        verdict: "missed",
        confirmed: true,
      }];
      void persistArchive(archiveText, next, false);
      return next;
    });
  }, [archiveText, persistArchive]);

  const removeGap = useCallback((claim: string) => {
    setAlignments(old => {
      const next = old.filter(item => item.claim !== claim);
      void persistArchive(archiveText, next, false);
      return next;
    });
  }, [archiveText, persistArchive]);

  /** The model proposes a gap; keeping it is yours. */
  const toggleGap = useCallback((claim: string) => {
    setAlignments(old => old.map(item => item.claim === claim ? { ...item, confirmed: !item.confirmed } : item));
  }, []);

  const makeGapNote = useCallback(() => {
    if (!profileId) return;
    const gaps = alignments.filter(item => item.confirmed);
    if (!gaps.length) return;
    setCompareProgress({ done: 0, total: 1, label: "Writing the note" });

    void (async () => {
      try {
        const note = await composeGapNote(llmCfg, corpusLabel, gaps);
        const now = Date.now();
        const record: AcademiaNote = {
          id: crypto.randomUUID(), profileId, title: note.title, content: note.content,
          derivedFrom: { archiveId: archiveIdRef.current, sourceIds: corpusIds },
          createdAt: now, updatedAt: now,
        };
        await academiaStore.saveNote(record);
        setGapNoteId(record.id);
      } catch (failure) {
        setFailures(old => [...old.slice(-4), failure instanceof Error ? failure.message : "the note could not be written"]);
      } finally {
        setCompareProgress(null);
      }
    })();
  }, [alignments, corpusIds, corpusLabel, llmCfg, profileId]);

  const reset = useCallback(() => {
    queueRef.current?.cancel();
    queueRef.current = null;
    pendingRef.current = null;
    interactiveRef.current?.();
    interactiveRef.current = null;
    setPhase("idle");
    setPassage(null);
    setRound(null);
    setHistory([]);
    setGraded([]);
    setDeadlineAt(null);
    remainingRef.current = null;
    compareAbortRef.current?.abort();
    archiveIdRef.current = "";
    setArchiveTextState("");
    setAlignments([]);
    setGapNoteId(null);
  }, []);

  /**
   * Stop everything and come back ready to start again.
   *
   * `reset` alone leaves the session idle, and only a fresh mount reloads the
   * material — which meant "end this and start another" required leaving the
   * page and coming back. This is that, without the round trip.
   */
  const restart = useCallback(() => {
    compareAbortRef.current?.abort();
    queueRef.current?.cancel();
    queueRef.current = null;
    pendingRef.current = null;
    interactiveRef.current?.();
    interactiveRef.current = null;
    setDeadlineAt(null);
    remainingRef.current = null;
    archiveIdRef.current = "";
    setArchiveTextState("");
    setAlignments([]);
    setGapNoteId(null);
    setCompareProgress(null);
    setHistory([]);
    setPassage(null);
    setRound(null);
    setPhase("ready");
  }, []);

  const setConfig = useCallback((next: RecallConfig) => { setConfigState(next); saveRecallConfig(next); }, []);
  const setCorpus = useCallback((next: Corpus) => { setCorpusState(next); queueRef.current?.cancel(); queueRef.current = null; }, []);
  const setEngine = useCallback((next: "model" | "mock") => { setEngineState(next); queueRef.current?.cancel(); queueRef.current = null; }, []);

  const value = useMemo<RecallSessionApi>(() => ({
    phase, active: phase !== "idle" && phase !== "error", error, failures,
    config, setConfig,
    corpus, setCorpus, sources, note, chunks, corpusLabel, coverage, anchored, banked,
    engine, setEngine, modelReady, model: llmCfg.model,
    passage, round, questionIndex, graded, history, buffered,
    deadlineAt, stepSeconds,
    load, begin, skipReading, submit, expire, nextRound, endSession, override, reset,
    attach, detach, attached,
    archiveText, setArchiveText, alignments, compareProgress, claimCount: claims.length,
    gapNoteId, openArchive, runCompare, toggleGap, makeGapNote, addManualGap, removeGap, restart,
  }), [
    phase, error, failures, config, setConfig, corpus, setCorpus, sources, note, chunks,
    corpusLabel, coverage, anchored, banked, engine, setEngine, modelReady, llmCfg.model,
    passage, round, questionIndex, graded, history, buffered, deadlineAt, stepSeconds,
    load, begin, skipReading, submit, expire, nextRound, endSession, override, reset,
    attach, detach, attached,
    archiveText, setArchiveText, alignments, compareProgress, claims.length,
    gapNoteId, openArchive, runCompare, toggleGap, makeGapNote, addManualGap, removeGap, restart,
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
