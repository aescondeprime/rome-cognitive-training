/**
 * Recall State — the view over a Quantum Recall run.
 *
 * The run itself lives in `recallSession`, mounted above the router, and this
 * file draws it. That split is deliberate and was learned the hard way: when the
 * page owned the session, a React effect's cleanup cancelled the generation
 * queue every time the ledger changed — which is every time a round is
 * recorded — so pressing NEXT ROUND sat on "building" with nothing in flight.
 *
 * What remains here is presentation and one clock. The clock is still a single
 * `requestAnimationFrame` loop that both draws the countdown and decides when
 * the step is over, as PASAT arrived at — but it now exists only while this page
 * is mounted, which is exactly what "the timer should not start until I am back"
 * means. `attach()` and `detach()` are the whole mechanism.
 *
 * The material is the note the Forge has open, and nothing else. There is no
 * corpus to choose, so there is no corpus tab; there is no source digest, so
 * there is no comparison step. What a run produces now is coverage and, at each
 * review, cards — which live in the Flashcard Archive on its own page.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ArrowLeft, Ban, Check, ChevronRight, Layers, ListChecks, Loader2, RotateCcw,
  Settings2, SkipForward, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { RecallQuestionType } from "@/lib/academiaStore";
import {
  alreadyArchived, cardFromQuestion, createFlashcard, fetchFlashcards, FLASHCARDS_KEY, type Flashcard,
} from "@/lib/flashcards";
import { noteCorpusId, useRecallSession } from "@/lib/recallSession";
import { useForgeJobs } from "@/lib/forgeJobs";
import {
  RECALL_DEFAULTS, type Graded, type Question, type RecallConfig, type Round, type Verdict,
} from "@/lib/recallRound";
import type { Coverage } from "@/lib/recallLedger";

interface RoundRecord { round: Round; graded: Graded[] }

const CYAN = "hsl(190 72% 60%)";
const VIOLET = "hsl(270 62% 70%)";
const GOLD = "hsl(43 88% 62%)";
const GREEN = "hsl(150 50% 58%)";
const ROSE = "hsl(350 62% 64%)";

export default function RecallState() {
  const session = useRecallSession();
  const [showSettings, setShowSettings] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [fraction, setFraction] = useState(1);
  const [entry, setEntry] = useState("");
  const [choice, setChoice] = useState<number | null>(null);
  const rafRef = useRef(0);

  /* ── Attachment is what starts and stops the clock ───────────────── */

  useEffect(() => {
    session.attach();
    if (session.phase === "idle") session.load();
    return () => session.detach();
    // Deliberately once: attaching is about this page existing, not about what
    // it currently shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── The clock ───────────────────────────────────────────────────── */

  const expireRef = useRef(session.expire);
  expireRef.current = session.expire;

  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    const deadline = session.deadlineAt;
    if (deadline === null) { setRemaining(0); setFraction(1); return; }
    const span = Math.max(1, session.stepSeconds * 1000);
    const loop = () => {
      const left = deadline - performance.now();
      setRemaining(Math.max(0, left));
      setFraction(Math.max(0, Math.min(1, left / span)));
      if (left <= 0) { expireRef.current(); return; }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [session.deadlineAt, session.stepSeconds]);

  /* ── Per-question input state ────────────────────────────────────── */

  useEffect(() => { setEntry(""); setChoice(null); }, [session.questionIndex, session.round]);

  const currentQuestion: Question | null =
    session.round && session.phase === "answering" ? session.round.questions[session.questionIndex] : null;

  const submit = useCallback(() => {
    if (!currentQuestion) return;
    session.submit(currentQuestion.type === "choice" ? choice : entry.trim());
  }, [choice, currentQuestion, entry, session]);

  /* ── Keyboard ────────────────────────────────────────────────────── */

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") { session.endSession(); return; }
      const target = event.target as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");

      if (session.phase === "reading" && (event.key === " " || event.key === "Enter")) {
        event.preventDefault(); session.skipReading(); return;
      }
      if (session.phase === "review" && !typing && (event.key === " " || event.key === "Enter")) {
        event.preventDefault(); session.nextRound(); return;
      }
      if (session.phase === "answering") {
        if (!typing && /^[1-4]$/.test(event.key)) { event.preventDefault(); setChoice(Number(event.key) - 1); return; }
        if (event.key === "Enter" && (!typing || target?.tagName === "INPUT" || event.metaKey || event.ctrlKey)) {
          event.preventDefault(); submit();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session, submit]);

  const seconds = Math.ceil(remaining / 1000);
  const timerColor = session.phase === "reading" ? CYAN : fraction < 0.25 ? ROSE : VIOLET;
  const running = ["reading", "waiting", "answering", "grading", "review"].includes(session.phase);

  return (
    <div className="relative flex h-[calc(100vh-132px)] min-h-[650px] flex-col overflow-hidden rounded-sm border border-[hsl(220_18%_13%)] bg-[hsl(222_20%_5%)]">
      <div className="pointer-events-none absolute inset-0 opacity-40" style={{ backgroundImage: "linear-gradient(hsl(270 45% 18% / .12) 1px, transparent 1px), linear-gradient(90deg, hsl(270 45% 18% / .12) 1px, transparent 1px)", backgroundSize: "32px 32px" }} />

      <div className="relative z-10 flex h-12 shrink-0 items-center gap-3 border-b border-[hsl(220_18%_13%)] px-4">
        <Link href="/academia"><button title="Back to the Forge — the run keeps going" className="text-muted-foreground/40 hover:text-foreground"><ArrowLeft size={15} /></button></Link>
        <div>
          <h2 className="font-display text-xs tracking-[.16em] text-[hsl(270_62%_74%)]">QUANTUM RECALL</h2>
          <p className="text-[7px] font-mono tracking-[.18em] text-muted-foreground/35">RECALL STATE · {session.corpusLabel}</p>
        </div>
        <div className="ml-auto flex items-center gap-4">
          <EngineChip engine={session.engine} modelReady={session.modelReady} model={session.model}
            locked={running} onToggle={() => session.setEngine(session.engine === "model" ? "mock" : "model")} />
          <CoverageMeter coverage={session.coverage} rounds={session.history.length} />
          <Link href="/academia/flashcards"><button title="Flashcard Archive" className="text-muted-foreground/40 hover:text-foreground"><Layers size={15} /></button></Link>
          <button onClick={() => setShowSettings(s => !s)} title="Optimizer" className="text-muted-foreground/40 hover:text-foreground"><Settings2 size={15} /></button>
          {running && <button onClick={session.endSession} title="End the run (Esc)" className="flex items-center gap-1 rounded-sm border border-[hsl(350_40%_30%)] px-2 py-1 text-[8px] font-mono tracking-widest text-[hsl(350_60%_70%)]"><Ban size={10} /> END</button>}
          {(running || session.phase === "summary") && <button onClick={session.restart} title="Stop this and start a fresh run" className="flex items-center gap-1 rounded-sm border border-[hsl(220_18%_22%)] px-2 py-1 text-[8px] font-mono tracking-widest text-muted-foreground/55 hover:text-foreground"><RotateCcw size={10} /> NEW RUN</button>}
        </div>
      </div>

      {showSettings && <Optimizer config={session.config} live={running} onChange={session.setConfig} onClose={() => setShowSettings(false)} />}

      {/* The Forge has moved on while this run is mid-flight. Said, not acted
          on: the ledger being written belongs to the note the run started on. */}
      {session.noteDrift && <div className="relative z-10 flex shrink-0 items-center gap-3 border-b border-[hsl(43_40%_24%)] bg-[hsl(43_30%_8%/.6)] px-4 py-2">
        <p className="text-[9px] font-mono tracking-[.14em] text-[hsl(43_70%_66%)]">
          THE FORGE IS NOW ON “{session.noteDrift.toUpperCase()}” — THIS RUN IS STILL ON “{session.corpusLabel.toUpperCase()}”
        </p>
        <button onClick={session.followNote} className="ml-auto rounded-sm border border-[hsl(43_45%_32%)] px-2.5 py-1 text-[8px] font-mono tracking-widest text-[hsl(43_75%_68%)]">SWITCH TO IT</button>
      </div>}

      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center overflow-y-auto p-6">

        {session.phase === "loading" && <Centered><Loader2 size={18} className="animate-spin text-cyan-400/60" /><p className="mt-3 text-[9px] font-mono tracking-widest text-muted-foreground/40">GATHERING MATERIAL</p></Centered>}

        {session.phase === "error" && <Centered>
          <p className="max-w-md text-center text-[11px] leading-5 text-rose-300/70">{session.error}</p>
          <Link href="/academia"><button className="mt-4 rounded-sm border border-[hsl(190_42%_26%)] px-3 py-1.5 text-[8px] font-mono tracking-widest text-cyan-300">BACK TO THE FORGE</button></Link>
        </Centered>}

        {session.phase === "ready" && <Ready session={session} />}

        {session.phase === "grading" && <Centered><Loader2 size={18} className="animate-spin text-violet-400/60" /><p className="mt-3 text-[9px] font-mono tracking-widest text-muted-foreground/40">MARKING</p></Centered>}

        {(session.phase === "reading" || session.phase === "waiting") && session.passage && <div className="flex w-full max-w-2xl flex-col gap-5">
          {session.phase === "reading"
            ? <Timer seconds={seconds} fraction={fraction} color={timerColor} label={`PASSAGE ${session.passage.index + 1} · READ`} />
            : <div className="flex items-center gap-2 rounded-sm border border-[hsl(43_40%_26%)] bg-[hsl(43_30%_8%/.6)] p-2.5">
                <Loader2 size={12} className="animate-spin text-[hsl(43_70%_64%)]" />
                <p className="text-[9px] font-mono tracking-[.16em] text-[hsl(43_70%_66%)]">TIME UP — STILL WRITING THE QUESTIONS. THE PASSAGE STAYS UNTIL THEY ARE READY.</p>
              </div>}
          <p className="rounded-sm border border-[hsl(190_28%_18%)] bg-[hsl(222_20%_4%/.75)] p-6 text-[14px] leading-8 text-foreground/85">{session.passage.text}</p>
          {session.phase === "reading" && session.config.earlyRead && <button onClick={session.skipReading} className="mx-auto flex items-center gap-1.5 text-[8px] font-mono tracking-widest text-muted-foreground/40 hover:text-foreground"><SkipForward size={11} /> I HAVE IT — SPACE</button>}
          {session.phase === "reading" && !session.round && <p className="mx-auto text-[8px] font-mono tracking-widest text-muted-foreground/25">QUESTIONS BEING WRITTEN WHILE YOU READ</p>}
        </div>}

        {session.phase === "answering" && currentQuestion && session.round && <div className="flex w-full max-w-2xl flex-col gap-5">
          <Timer seconds={seconds} fraction={fraction} color={timerColor} label={`QUESTION ${session.questionIndex + 1} OF ${session.round.questions.length} · ${typeLabel(currentQuestion.type)}`} />
          <p className="text-[15px] leading-7 text-foreground/85">{currentQuestion.stem}</p>

          {currentQuestion.type === "choice" && <div className="flex flex-col gap-2">
            {(currentQuestion.options ?? []).map((option, i) => <button key={i} onClick={() => setChoice(i)}
              className={cn("flex items-start gap-3 rounded-sm border p-3 text-left text-[12px] leading-6 transition-colors",
                choice === i ? "border-[hsl(270_55%_50%)] bg-[hsl(270_40%_12%)] text-foreground/90" : "border-[hsl(220_18%_15%)] text-foreground/60 hover:border-[hsl(220_20%_24%)]")}>
              <span className="mt-0.5 font-mono text-[9px] text-muted-foreground/45">{i + 1}</span>{option}
            </button>)}
          </div>}

          {currentQuestion.type === "blank" && <input autoFocus value={entry} onChange={e => setEntry(e.target.value)}
            placeholder="Type the missing term…"
            className="rounded-sm border border-[hsl(220_18%_16%)] bg-[hsl(222_20%_4%)] px-3 py-2.5 text-[13px] text-foreground/85 outline-none focus:border-[hsl(270_45%_40%)]" />}

          {currentQuestion.type === "open" && <textarea autoFocus value={entry} onChange={e => setEntry(e.target.value)} rows={6}
            placeholder="Answer in your own words. Cmd+Enter to submit."
            className="resize-none rounded-sm border border-[hsl(220_18%_16%)] bg-[hsl(222_20%_4%)] p-3 text-[13px] leading-6 text-foreground/85 outline-none focus:border-[hsl(270_45%_40%)]" />}

          <button onClick={submit} disabled={currentQuestion.type === "choice" ? choice === null : !entry.trim()}
            className="self-end rounded-sm border border-[hsl(270_50%_40%)] bg-[hsl(270_40%_12%)] px-5 py-2 text-[9px] font-mono tracking-[.18em] text-[hsl(270_70%_80%)] disabled:opacity-25">SUBMIT</button>
        </div>}

        {session.phase === "review" && session.round && <div className="flex w-full max-w-2xl flex-col gap-4">
          <p className="text-[9px] font-mono tracking-[.18em] text-muted-foreground/40">
            PASSAGE {session.round.chunkIndex + 1} · {session.graded.filter(g => g.verdict === "correct").length}/{session.graded.length} CORRECT
            {session.buffered > 0 && <span style={{ color: GREEN }}> · {session.buffered} READY</span>}
          </p>
          {session.failures.length > 0 && <p className="text-[8px] font-mono leading-4 text-[hsl(43_60%_60%)]/60">
            {session.failures.length} question{session.failures.length === 1 ? "" : "s"} the model could not write — {session.failures[session.failures.length - 1]}
          </p>}
          {session.graded.map((item, i) => <ReviewCard key={item.question.id} item={item} round={session.round!} onOverride={() => session.override(i)} />)}
          <Excerpt round={session.round} />
          <button onClick={session.nextRound} className="self-end flex items-center gap-1.5 rounded-sm border border-[hsl(270_50%_40%)] bg-[hsl(270_40%_12%)] px-5 py-2 text-[9px] font-mono tracking-[.18em] text-[hsl(270_70%_80%)]">NEXT ROUND <ChevronRight size={12} /></button>
        </div>}

        {session.phase === "summary" && <Summary history={session.history} coverage={session.coverage} onAgain={session.begin} />}
      </div>
    </div>
  );
}

/* ── The ready screen ────────────────────────────────────────────────── */

/**
 * What the run is about, before it starts.
 *
 * The first round is already being written by the time this is on screen, so
 * BEGIN is instant and the wait lands where you are reading anyway. PREPARE is
 * offered here rather than in the Forge because preparation is a property of a
 * run's material, and the note is the only material there is.
 */
function Ready({ session }: { session: ReturnType<typeof useRecallSession> }) {
  const { data: profile } = useQuery<{ id: number }>({ queryKey: ["/api/active-profile"] });
  const forge = useForgeJobs();
  const corpusId = session.note ? noteCorpusId(session.note.id) : "";
  const preparing = forge.isPending(corpusId);
  const unprepared = session.chunks.length - session.banked;

  return <Centered>
    <p className="text-[9px] font-mono tracking-[.2em] text-muted-foreground/35">THIS NOTE</p>
    <p className="mt-1 max-w-lg truncate text-center font-display text-base tracking-[.1em] text-foreground/80">{session.corpusLabel}</p>
    <p className="mt-4 font-display text-lg tracking-[.14em] text-[hsl(270_62%_74%)]">{session.chunks.length} PASSAGES ARMED</p>
    <p className="mt-2 max-w-md text-center text-[10px] leading-5 text-muted-foreground/50">
      Each round shows one passage, takes it away, then asks {session.config.questionsPerRound} question{session.config.questionsPerRound === 1 ? "" : "s"} about it.
      Rounds keep coming until you end the run, and they eventually cover every passage.
    </p>
    <p className="mt-4 text-[8px] font-mono tracking-[.18em]" style={{ color: session.buffered > 0 ? GREEN : "hsl(220 12% 40%)" }}>
      {session.buffered > 0 ? `${session.buffered} ROUND${session.buffered === 1 ? "" : "S"} READY` : "WRITING THE FIRST ROUND…"}
    </p>
    <button onClick={session.begin} disabled={!session.chunks.length}
      className="mt-4 rounded-sm border border-[hsl(270_50%_40%)] bg-[hsl(270_40%_12%)] px-6 py-2.5 text-[10px] font-mono tracking-[.2em] text-[hsl(270_70%_80%)] hover:border-[hsl(270_60%_55%)] disabled:opacity-25">BEGIN</button>
    <p className="mt-3 text-[8px] font-mono tracking-[.16em] text-muted-foreground/30">{session.banked}/{session.chunks.length} PREPARED</p>

    {unprepared > 0 && <button
      onClick={() => {
        if (!profile?.id || !session.note) return;
        forge.enqueuePrepare({
          profileId: profile.id,
          corpus: { id: corpusId, name: session.note.title || "Untitled Note", text: session.note.content },
          cfg: session.llmConfig,
        });
      }}
      disabled={!session.modelReady || preparing}
      title={session.modelReady ? "Write the questions now, so studying costs no model time" : "Needs a local model"}
      className="mt-3 flex items-center gap-1.5 rounded-sm border border-[hsl(270_42%_28%)] bg-[hsl(270_34%_10%)] px-4 py-1.5 text-[8px] font-mono tracking-widest text-[hsl(270_62%_74%)] hover:border-[hsl(270_55%_45%)] disabled:opacity-25">
      {preparing ? <Loader2 size={10} className="animate-spin" /> : <ListChecks size={10} />} PREPARE {unprepared} PASSAGE{unprepared === 1 ? "" : "S"}
    </button>}

    <p className="mt-3 max-w-md text-center text-[8px] leading-4 text-muted-foreground/30">
      An unprepared run writes its questions while you study, which is what makes the machine feel slow. You can leave — the run and its writing continue, and the reading clock waits until you are back.
    </p>
  </Centered>;
}

/* ── Pieces ──────────────────────────────────────────────────────────── */

/**
 * Which engine writes the questions.
 *
 * The mock is kept rather than deleted: it answers instantly and its questions
 * are deliberately poor, which makes it the right tool for judging pacing and
 * the wrong one for judging anything else. Locked mid-run, because swapping the
 * generator underneath a primed round would mix two kinds of question in one
 * sitting without saying so.
 */
function EngineChip({ engine, modelReady, model, locked, onToggle }: { engine: "model" | "mock"; modelReady: boolean; model: string; locked: boolean; onToggle: () => void }) {
  const live = engine === "model" && modelReady;
  return <button onClick={onToggle} disabled={locked || !modelReady}
    title={modelReady ? (locked ? "Locked while a run is in progress" : "Switch between the model and the pacing mock") : "No local model is answering"}
    className={cn("rounded-sm border px-2 py-1 text-left transition-colors disabled:cursor-default",
      live ? "border-[hsl(190_40%_26%)]" : "border-[hsl(43_40%_28%)]", locked && "opacity-50")}>
    <p className={cn("text-[8px] font-mono tracking-[.16em]", live ? "text-[hsl(190_60%_64%)]" : "text-[hsl(43_70%_64%)]")}>
      {live ? "MODEL" : "MOCK"}
    </p>
    <p className="max-w-32 truncate text-[7px] font-mono text-muted-foreground/30">{live ? model : "templates, for pacing"}</p>
  </button>;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center">{children}</div>;
}

function typeLabel(type: RecallQuestionType): string {
  return type === "choice" ? "MULTIPLE CHOICE" : type === "blank" ? "FILL IN THE BLANK" : "OPEN";
}

/**
 * The countdown.
 *
 * One bar, drawn from the same rAF loop that decides when the step ends, so it
 * cannot drift out of step with what it is measuring.
 */
function Timer({ seconds, fraction, color, label }: { seconds: number; fraction: number; color: string; label: string }) {
  return <div className="flex flex-col gap-2">
    <div className="flex items-baseline justify-between">
      <span className="text-[8px] font-mono tracking-[.2em] text-muted-foreground/40">{label}</span>
      <span className="font-display text-lg tabular-nums" style={{ color }}>{seconds}s</span>
    </div>
    <div className="h-1 w-full overflow-hidden rounded-full bg-[hsl(222_20%_10%)]">
      <div className="h-full" style={{ width: `${fraction * 100}%`, background: color }} />
    </div>
  </div>;
}

function CoverageMeter({ coverage, rounds }: { coverage: Coverage; rounds: number }) {
  return <div className="flex items-center gap-3">
    <div className="text-right">
      <p className="text-[8px] font-mono tracking-[.16em] text-muted-foreground/40">COVERAGE {coverage.seen}/{coverage.total} · MASTERED {coverage.consolidated}</p>
      <div className="mt-1 h-1 w-40 overflow-hidden rounded-full bg-[hsl(222_20%_10%)]">
        {/* Coverage is presented-once; mastery rides inside it as the brighter band. */}
        <div className="h-full" style={{ width: `${coverage.fraction * 100}%`, background: "hsl(190 55% 45%)" }}>
          <div className="h-full" style={{ width: `${coverage.fraction ? (coverage.masteryFraction / coverage.fraction) * 100 : 0}%`, background: GREEN }} />
        </div>
      </div>
    </div>
    <span className="font-display text-sm tabular-nums text-muted-foreground/50">{rounds}</span>
  </div>;
}

const VERDICT_TONE: Record<Verdict, { label: string; color: string }> = {
  correct: { label: "CORRECT", color: GREEN },
  partial: { label: "PARTIAL", color: GOLD },
  wrong: { label: "WRONG", color: ROSE },
  missed: { label: "MISSED", color: "hsl(220 12% 45%)" },
};

/**
 * Keeping a question you have just been marked on.
 *
 * The moment after the verdict is the right one to offer this: the answer has
 * its evidence attached and you have just found out whether you knew it. A
 * question already on a card says so rather than offering a duplicate — an
 * archive that quietly accumulated the same question from three sittings would
 * make the drills that read it worse, not better.
 */
function ArchiveButton({ item, round }: { item: Graded; round: Round }) {
  const client = useQueryClient();
  const { data: cards = [] } = useQuery<Flashcard[]>({ queryKey: FLASHCARDS_KEY, queryFn: fetchFlashcards });
  const archived = alreadyArchived(cards, item.question);

  const add = useMutation({
    mutationFn: () => createFlashcard(cardFromQuestion(item.question, round)),
    onSuccess: () => client.invalidateQueries({ queryKey: FLASHCARDS_KEY }),
  });

  if (archived) return <span className="flex items-center gap-1 text-[8px] font-mono tracking-[.14em] text-[hsl(35_60%_60%)]/70"><Layers size={10} /> IN ARCHIVE</span>;

  return <button onClick={() => add.mutate()} disabled={add.isPending}
    title="Keep this as a flashcard"
    className="flex items-center gap-1 text-[8px] font-mono tracking-[.14em] text-muted-foreground/40 hover:text-[hsl(35_80%_65%)] disabled:opacity-40">
    {add.isPending ? <Loader2 size={10} className="animate-spin" /> : <Layers size={10} />} ARCHIVE
  </button>;
}

function ReviewCard({ item, round, onOverride }: { item: Graded; round: Round; onOverride: () => void }) {
  const tone = VERDICT_TONE[item.verdict];
  const given = item.question.type === "choice"
    ? (item.answer.value === null ? "—" : item.question.options?.[Number(item.answer.value)] ?? "—")
    : String(item.answer.value ?? "").trim() || "—";

  return <div className="rounded-sm border border-[hsl(220_18%_14%)] bg-[hsl(222_18%_6%/.8)] p-3">
    <div className="flex items-center gap-2">
      <span className="text-[8px] font-mono tracking-[.16em]" style={{ color: tone.color }}>{tone.label}</span>
      <span className="text-[8px] font-mono tracking-[.16em] text-muted-foreground/30">{typeLabel(item.question.type)}</span>
      {item.overridden && <span className="text-[8px] font-mono tracking-[.16em] text-[hsl(190_60%_60%)]">OVERRULED</span>}
      <div className="ml-auto flex items-center gap-3">
        {item.question.type === "open" && item.verdict !== "correct" && !item.overridden &&
          <button onClick={onOverride} title="Count this as correct" className="flex items-center gap-1 text-[8px] font-mono tracking-[.14em] text-muted-foreground/40 hover:text-foreground"><Check size={10} /> I WAS RIGHT</button>}
        <ArchiveButton item={item} round={round} />
      </div>
    </div>
    <p className="mt-2 text-[12px] leading-6 text-foreground/80">{item.question.stem}</p>
    <p className="mt-2 text-[10px] leading-5 text-muted-foreground/55"><span className="text-muted-foreground/35">You:</span> {given}</p>
    <p className="mt-1 text-[10px] leading-5 text-foreground/65"><span className="text-muted-foreground/35">Answer:</span> {item.question.answer}</p>
    {item.note && <p className="mt-1 text-[9px] leading-4 text-muted-foreground/40">{item.note}</p>}
    {item.question.proof && <p className="mt-2 border-l-2 pl-2.5 text-[10px] leading-5 text-foreground/55" style={{ borderColor: item.question.proof.verified ? CYAN : GOLD }}>
      {item.question.proof.verified ? item.question.proof.text : "The passage is shown below; no exact line could be cited."}
    </p>}
  </div>;
}

/** The passage, back on screen, with the round's proof spans marked in it. */
function Excerpt({ round }: { round: Round }) {
  const spans = round.questions
    .map(q => q.proof)
    .filter((p): p is NonNullable<typeof p> => !!p && p.verified);

  const marked = new Set(spans.map(span => span.text));
  const parts = marked.size
    ? round.excerpt.split(new RegExp(`(${Array.from(marked).map(escapeRegExp).join("|")})`, "g"))
    : [round.excerpt];

  return <div className="rounded-sm border border-[hsl(190_28%_16%)] bg-[hsl(222_20%_4%/.7)] p-4 text-[11px] leading-6 text-foreground/50">
    <p className="mb-2 text-[8px] font-mono tracking-[.18em] text-muted-foreground/30">THE PASSAGE</p>
    <p>{parts.map((part, i) => marked.has(part)
      ? <mark key={i} className="rounded-sm px-0.5 text-foreground/85" style={{ background: "hsl(190 60% 40% / .18)" }}>{part}</mark>
      : <span key={i}>{part}</span>)}</p>
  </div>;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function Summary({ history, coverage, onAgain }: { history: RoundRecord[]; coverage: Coverage; onAgain: () => void }) {
  const all = history.flatMap(record => record.graded);
  const byType = (type: RecallQuestionType) => {
    const items = all.filter(item => item.question.type === type);
    const correct = items.filter(item => item.verdict === "correct").length;
    return { asked: items.length, correct };
  };
  const overrides = all.filter(item => item.overridden).length;

  return <Centered>
    <p className="font-display text-lg tracking-[.14em] text-[hsl(270_62%_74%)]">RUN COMPLETE</p>
    <p className="mt-2 text-[10px] font-mono tracking-widest text-muted-foreground/45">
      {history.length} ROUNDS · {all.filter(i => i.verdict === "correct").length}/{all.length} CORRECT · {coverage.seen}/{coverage.total} PASSAGES COVERED
    </p>
    <div className="mt-5 flex gap-8">
      {(["choice", "blank", "open"] as RecallQuestionType[]).map(type => {
        const tally = byType(type);
        return <div key={type} className="text-center">
          <p className="font-display text-xl tabular-nums text-foreground/75">{tally.asked ? Math.round((tally.correct / tally.asked) * 100) : 0}%</p>
          <p className="mt-1 text-[8px] font-mono tracking-[.16em] text-muted-foreground/35">{typeLabel(type)}</p>
          <p className="text-[8px] font-mono text-muted-foreground/25">{tally.correct}/{tally.asked}</p>
        </div>;
      })}
    </div>
    {overrides > 0 && <p className="mt-4 text-[9px] font-mono tracking-widest text-[hsl(190_60%_60%)]">{overrides} OVERRULED — how often you disagree is the number that says whether to trust the grader</p>}
    <p className="mt-5 max-w-md text-center text-[9px] leading-5 text-muted-foreground/35">
      Coverage is kept; the sitting is not. Starting again picks up where the note left off.
    </p>
    <div className="mt-5 flex gap-3">
      <button onClick={onAgain} className="rounded-sm border border-[hsl(270_50%_40%)] bg-[hsl(270_40%_12%)] px-5 py-2 text-[9px] font-mono tracking-[.18em] text-[hsl(270_70%_80%)]">RUN AGAIN</button>
      <Link href="/academia/flashcards"><button className="flex items-center gap-1.5 rounded-sm border border-[hsl(35_45%_30%)] px-5 py-2 text-[9px] font-mono tracking-[.18em] text-[hsl(35_75%_68%)]"><Layers size={12} /> FLASHCARD ARCHIVE</button></Link>
      <Link href="/academia"><button className="rounded-sm border border-[hsl(220_18%_20%)] px-5 py-2 text-[9px] font-mono tracking-[.18em] text-muted-foreground/60 hover:text-foreground">BACK TO THE FORGE</button></Link>
    </div>
  </Centered>;
}

/* ── The optimizer ───────────────────────────────────────────────────── */

interface Dial { key: keyof RecallConfig; label: string; min: number; max: number; step?: number; format?: (v: number) => string }

/**
 * The same vocabulary as `GameShell`'s settings drawer, without the component.
 *
 * `GameShell` also owns a title row, a start button and an instruction card,
 * and blurs its own controls to hand keys back to the drill router — none of
 * which belongs on a study surface.
 */
const DIALS: Dial[] = [
  { key: "questionsPerRound", label: "Questions per round", min: 1, max: 8 },
  { key: "chunkTargetChars", label: "Excerpt size", min: 300, max: 2000, step: 50, format: v => `${v} chars` },
  { key: "readSecondsPer100Words", label: "Reading time", min: 5, max: 60, format: v => `${v}s / 100 words` },
  { key: "answerSeconds", label: "Answer time", min: 10, max: 120, step: 5, format: v => `${v}s base` },
  { key: "openMultiplier", label: "Open-ended multiplier", min: 1, max: 5, step: 0.1, format: v => `${v.toFixed(1)}x` },
  { key: "blankMultiplier", label: "Fill-in multiplier", min: 1, max: 3, step: 0.1, format: v => `${v.toFixed(1)}x` },
  { key: "reviewRatio", label: "Review vs new", min: 0, max: 1, step: 0.05, format: v => `${Math.round(v * 100)}% review` },
  { key: "bufferDepth", label: "Rounds written ahead", min: 1, max: 4, format: v => `${v} in hand` },
  { key: "mixChoice", label: "Weight · multiple choice", min: 0, max: 5, step: 0.5 },
  { key: "mixBlank", label: "Weight · fill in the blank", min: 0, max: 5, step: 0.5 },
  { key: "mixOpen", label: "Weight · open ended", min: 0, max: 5, step: 0.5 },
];

function Optimizer({ config, live, onChange, onClose }: { config: RecallConfig; live: boolean; onChange: (config: RecallConfig) => void; onClose: () => void }) {
  return <div className="relative z-10 max-h-[40%] shrink-0 overflow-y-auto border-b border-[hsl(270_30%_20%)] bg-[hsl(222_20%_5%)] p-4">
    <div className="mb-3 flex items-center">
      <span className="text-[9px] font-mono tracking-[.2em] text-[hsl(270_60%_72%)]">OPTIMIZER</span>
      <button onClick={() => onChange({ ...RECALL_DEFAULTS })} className="ml-4 text-[8px] font-mono tracking-widest text-muted-foreground/35 hover:text-foreground">RESET</button>
      <button onClick={onClose} className="ml-auto text-muted-foreground/40 hover:text-foreground"><X size={13} /></button>
    </div>
    <div className="grid gap-2.5 md:grid-cols-2">
      {DIALS.map(dial => {
        const value = Number(config[dial.key]);
        // Excerpt size decides what a passage *is*, so moving it mid-run would
        // re-chunk the note underneath the round in flight and orphan it.
        const frozen = live && dial.key === "chunkTargetChars";
        return <div key={String(dial.key)} className={cn("flex items-center gap-3", frozen && "opacity-35")}>
          <label className="min-w-0 flex-1 truncate text-[9px] font-mono text-muted-foreground/55" title={frozen ? "Locked while a run is in progress" : undefined}>{dial.label}</label>
          <input type="range" min={dial.min} max={dial.max} step={dial.step ?? 1} value={value} disabled={frozen}
            onChange={e => onChange({ ...config, [dial.key]: Number(e.target.value) })}
            onPointerUp={e => e.currentTarget.blur()}
            style={{ width: 110, accentColor: VIOLET }} />
          <span className="w-24 text-right text-[9px] font-mono tabular-nums text-[hsl(270_60%_74%)]">{dial.format ? dial.format(value) : value}</span>
        </div>;
      })}
      <div className="flex items-center gap-3">
        <label className="min-w-0 flex-1 truncate text-[9px] font-mono text-muted-foreground/55">Finish reading early</label>
        <button onClick={() => onChange({ ...config, earlyRead: !config.earlyRead })}
          className={cn("rounded-sm border px-2 py-1 text-[8px] font-mono tracking-widest", config.earlyRead ? "border-[hsl(270_50%_45%)] text-[hsl(270_65%_78%)]" : "border-[hsl(220_18%_18%)] text-muted-foreground/40")}>
          {config.earlyRead ? "ALLOWED" : "OFF"}
        </button>
      </div>
    </div>
    <p className="mt-3 text-[8px] leading-4 text-muted-foreground/25">
      Excerpt size changes what a passage is, so coverage measured at another size is set aside rather than mixed in — and the dial is locked while a run is in progress. Each note keeps its own coverage. Rounds written ahead are drawn against the ledger as it stood when they were written, so a deeper buffer schedules a little further into the past.
    </p>
  </div>;
}
