/**
 * PASAT — Paced Serial Addition
 *
 * A number appears every so often. Add it to the number that came N positions
 * earlier and enter the sum before the next one lands.
 *
 * Three things were wrong with the first version and all three are fixed here:
 *
 * - **The countdown did not run.** Pacing was a `setInterval` while the bar was
 *   a separate `requestAnimationFrame` loop reading a timestamp the interval
 *   never reset in step with itself, so the two disagreed and the bar sat still.
 *   There is now one rAF loop: it draws the countdown *and* decides when the
 *   trial is over, so what you see is by construction what you are being timed
 *   against.
 *
 * - **Enter did nothing useful.** The answer box was an `<input type="number">`
 *   with both a window-level and an element-level Enter handler; the keystroke
 *   was handled twice and the browser's own number-field behaviour got a say as
 *   well. Answers are typed through ROME's key router into a plain display now
 *   — no native input, one Enter handler, and the same routing that lets you run
 *   this next to Mental Math without the two of them stealing each other's
 *   digits.
 *
 * - **Difficulty was pace only.** The level used to shorten the interval and
 *   nothing else. Now the interval is a setting you choose, and difficulty is
 *   *how far back* you reach for the addend — N = 1 is the classic task, N = 3
 *   means adding the number three places back, which is the same escalation
 *   Dual N-Back uses.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import GameShell, { type Setting } from "@/components/games/GameShell";
import {
  MONO, SERIF, alpha, useGameConfig, useGameKeys, useScaled,
  type GameProps,
} from "@/lib/gameKit";
import { recordDrillResultInBackground } from "@/lib/trainingRecorder";

const accent = "hsl(345 60% 62%)";

interface Config {
  n: number;
  isiMs: number;
  trials: number;
  threshAdvance: number;
  threshFallback: number;
}

const DEFAULTS: Config = { n: 1, isiMs: 3000, trials: 15, threshAdvance: 80, threshFallback: 50 };

type Phase = "idle" | "running" | "result";

export default function PASAT({ embedded, autoStart, onSessionComplete }: GameProps) {
  const [cfg, setCfg] = useGameConfig<Config>("pasat", DEFAULTS);
  const px = useScaled();

  const [phase, setPhase] = useState<Phase>("idle");
  const [current, setCurrent] = useState<number | null>(null);
  const [addend, setAddend] = useState<number | null>(null);
  const [index, setIndex] = useState(0);
  const [entry, setEntry] = useState("");
  const [locked, setLocked] = useState(false);
  const [progress, setProgress] = useState(0);
  const [feedback, setFeedback] = useState<"correct" | "wrong" | "missed" | null>(null);
  const [score, setScore] = useState({ correct: 0, answered: 0, scorable: 0 });

  const stream = useRef<number[]>([]);
  const idx = useRef(0);
  const entryRef = useRef("");
  const lockedRef = useRef(false);
  const stats = useRef({ correct: 0, answered: 0, scorable: 0 });
  const stepStart = useRef(0);
  const raf = useRef(0);
  const running = useRef(false);
  const startedAt = useRef(0);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

  const stop = () => { running.current = false; cancelAnimationFrame(raf.current); };
  useEffect(() => () => stop(), []);

  const endSession = useCallback(() => {
    stop();
    const s = { ...stats.current };
    const acc = s.scorable > 0 ? (s.correct / s.scorable) * 100 : 0;
    const n = cfgRef.current.n;
    const newN = acc >= cfgRef.current.threshAdvance && n < 6 ? n + 1
      : acc < cfgRef.current.threshFallback && n > 1 ? n - 1
      : n;
    setScore(s);
    setCfg(c => ({ ...c, n: newN }));
    setPhase("result");
    setCurrent(null);
    recordDrillResultInBackground({
      domain: "focus", activityId: "pasat",
      correct: s.correct, total: Math.max(1, s.scorable),
      level: n, maxLevel: 6, startedAt: startedAt.current,
    });
    onSessionComplete?.({ correct: s.correct, total: Math.max(1, s.scorable), level: newN });
  }, [setCfg, onSessionComplete]);

  /** Grade whatever is in the box, then move to the next number. */
  const advance = useCallback(() => {
    const { n, trials } = cfgRef.current;
    const i = idx.current;

    // Grade the trial that just ended — only trials with an addend count.
    if (i >= n) {
      const expected = stream.current[i] + stream.current[i - n];
      const typed = parseInt(entryRef.current.trim(), 10);
      stats.current.scorable++;
      if (Number.isNaN(typed)) {
        setFeedback("missed");
      } else {
        stats.current.answered++;
        if (typed === expected) { stats.current.correct++; setFeedback("correct"); }
        else setFeedback("wrong");
      }
      setScore({ ...stats.current });
    }

    const next = i + 1;
    if (next >= trials + n) { endSession(); return; }

    idx.current = next;
    entryRef.current = "";
    lockedRef.current = false;
    setEntry("");
    setLocked(false);
    setIndex(next);
    setCurrent(stream.current[next]);
    setAddend(next >= n ? stream.current[next - n] : null);
    setProgress(0);
    stepStart.current = performance.now();
  }, [endSession]);

  const loop = useCallback(() => {
    if (!running.current) return;
    const isi = cfgRef.current.isiMs;
    const elapsed = performance.now() - stepStart.current;
    setProgress(Math.min(1, elapsed / isi));
    if (elapsed >= isi) advance();
    if (running.current) raf.current = requestAnimationFrame(loop);
  }, [advance]);

  const startSession = useCallback(() => {
    stop();
    startedAt.current = Date.now();
    const total = cfg.trials + cfg.n;
    stream.current = Array.from({ length: total }, () => 1 + Math.floor(Math.random() * 9));
    stats.current = { correct: 0, answered: 0, scorable: 0 };
    idx.current = 0;
    entryRef.current = "";
    lockedRef.current = false;
    setScore({ correct: 0, answered: 0, scorable: 0 });
    setEntry("");
    setLocked(false);
    setFeedback(null);
    setIndex(0);
    setCurrent(stream.current[0]);
    setAddend(null);
    setProgress(0);
    setPhase("running");
    running.current = true;
    stepStart.current = performance.now();
    raf.current = requestAnimationFrame(loop);
  }, [cfg.trials, cfg.n, loop]);

  const startRef = useRef(startSession);
  startRef.current = startSession;
  useEffect(() => { if (autoStart) startRef.current(); }, [autoStart]);

  const typeDigit = useCallback((k: string) => {
    if (lockedRef.current || idx.current < cfgRef.current.n) return;
    if (entryRef.current.length >= 3) return;
    entryRef.current += k;
    setEntry(entryRef.current);
  }, []);

  const backspace = useCallback(() => {
    if (lockedRef.current) return;
    entryRef.current = entryRef.current.slice(0, -1);
    setEntry(entryRef.current);
  }, []);

  /**
   * Enter locks the answer in. It does not advance — the pace is the point of
   * the task — but it does tell you straight away whether you were right.
   */
  const commit = useCallback(() => {
    if (lockedRef.current || !entryRef.current || idx.current < cfgRef.current.n) return;
    lockedRef.current = true;
    setLocked(true);
    const expected = stream.current[idx.current] + stream.current[idx.current - cfgRef.current.n];
    setFeedback(parseInt(entryRef.current, 10) === expected ? "correct" : "wrong");
  }, []);

  useGameKeys("0123456789".split(""), typeDigit, phase === "running");
  useGameKeys(["Backspace"], backspace, phase === "running");
  useGameKeys(["Enter"], commit, phase === "running");

  const settings: Setting[] = [
    { kind: "range", key: "n", label: "Add to N back", min: 1, max: 6 },
    { kind: "range", key: "isiMs", label: "Time per number", min: 600, max: 6000, step: 100, format: v => `${(v / 1000).toFixed(1)}s` },
    { kind: "range", key: "trials", label: "Trials", min: 5, max: 60 },
    { kind: "range", key: "threshAdvance", label: "Advance at %", min: 60, max: 95, step: 5 },
    { kind: "range", key: "threshFallback", label: "Fall back below %", min: 30, max: 65, step: 5 },
  ];

  const scorableIdx = Math.max(0, index - cfg.n + 1);
  const barColor = feedback === "correct" ? "hsl(130 60% 55%)" : feedback === "wrong" ? "hsl(0 60% 55%)" : accent;

  return (
    <GameShell
      title="PASAT" accent={accent} embedded={embedded}
      subtitle={`N = ${cfg.n} · ${(cfg.isiMs / 1000).toFixed(1)}s per number · ${cfg.trials} trials`}
      phase={phase} onStart={startSession} settings={settings} cfg={cfg} setCfg={setCfg}
      instructions={
        <div style={{ display: "grid", gap: px(6) }}>
          <p>Add each number to the one <strong style={{ color: accent }}>{cfg.n} place{cfg.n === 1 ? "" : "s"} back</strong> and type the sum before the next arrives.</p>
          <p>With N = {cfg.n}, the stream <strong style={{ color: accent }}>3 → 7 → 4 → 2</strong> wants{" "}
            <strong style={{ color: accent }}>
              {cfg.n === 1 ? "10, 11, 6" : cfg.n === 2 ? "7, 9" : cfg.n === 3 ? "5" : "…"}
            </strong>.
          </p>
          <p>Digits type, Enter locks the answer in, Backspace corrects. The pace is a setting; N is what adapts.</p>
        </div>
      }
    >
      {phase === "running" && (
        <div className="flex flex-col items-center w-full" style={{ gap: px(18), maxWidth: px(430) }}>
          <div className="w-full rounded-full overflow-hidden" style={{ height: px(4), background: "hsl(222 20% 10%)" }}>
            <div style={{ height: "100%", width: `${(1 - progress) * 100}%`, background: barColor, transition: "background 0.2s" }} />
          </div>

          <p style={{ color: "hsl(214 20% 36%)", fontFamily: MONO, fontSize: px(10), letterSpacing: "0.15em" }}>
            {index >= cfg.n ? `${scorableIdx} / ${cfg.trials}` : `priming ${index + 1}/${cfg.n}`}
          </p>

          <div style={{
            fontFamily: SERIF, fontWeight: 700, fontSize: px(96), lineHeight: 1, color: accent,
            filter: `drop-shadow(0 0 ${px(22)}px ${alpha(accent, 0.5)})`,
          }}>
            {current ?? "·"}
          </div>

          <p style={{ color: "hsl(214 20% 34%)", fontFamily: MONO, fontSize: px(10) }}>
            {addend !== null ? `+ the number ${cfg.n} back` : `hold — ${cfg.n - index} more before answering`}
          </p>

          <div className="flex items-center justify-center rounded-xl w-full"
            style={{
              height: px(58), fontFamily: SERIF, fontWeight: 700, fontSize: px(30),
              letterSpacing: "0.1em",
              background: "hsl(222 20% 7%)",
              border: `1px solid ${locked ? barColor : alpha(accent, 0.4)}`,
              color: locked ? barColor : accent,
              opacity: index >= cfg.n ? 1 : 0.3,
              transition: "border-color 0.2s, color 0.2s",
            }}>
            {entry || (index >= cfg.n ? "—" : "")}
          </div>

          <div className="flex justify-center w-full" style={{ gap: px(28) }}>
            <div className="text-center">
              <p style={{ color: accent, fontFamily: SERIF, fontSize: px(20), fontWeight: 700 }}>{score.correct}</p>
              <p style={{ color: "hsl(214 20% 36%)", fontFamily: MONO, fontSize: px(9), letterSpacing: "0.15em", textTransform: "uppercase" }}>correct</p>
            </div>
            <div className="text-center">
              <p style={{ color: "hsl(214 20% 48%)", fontFamily: SERIF, fontSize: px(20), fontWeight: 700 }}>{score.answered}</p>
              <p style={{ color: "hsl(214 20% 36%)", fontFamily: MONO, fontSize: px(9), letterSpacing: "0.15em", textTransform: "uppercase" }}>answered</p>
            </div>
            <div className="text-center">
              <p style={{ color: "hsl(214 20% 48%)", fontFamily: SERIF, fontSize: px(20), fontWeight: 700 }}>{score.scorable}</p>
              <p style={{ color: "hsl(214 20% 36%)", fontFamily: MONO, fontSize: px(9), letterSpacing: "0.15em", textTransform: "uppercase" }}>asked</p>
            </div>
          </div>
        </div>
      )}

      {phase === "result" && (
        <div className="rounded-xl border text-center w-full"
          style={{ background: "hsl(222 20% 5%)", borderColor: alpha(accent, 0.3), padding: px(18), maxWidth: px(400) }}>
          <p style={{ fontFamily: SERIF, color: "hsl(214 20% 45%)", fontSize: px(11), letterSpacing: "0.15em", textTransform: "uppercase" }}>Session Complete</p>
          <p style={{ color: accent, fontFamily: SERIF, fontSize: px(38), fontWeight: 700, marginTop: px(10) }}>
            {score.correct}/{score.scorable}
          </p>
          <p style={{ color: "hsl(214 20% 45%)", fontFamily: MONO, fontSize: px(11), marginTop: px(8) }}>
            {score.scorable ? `${Math.round((score.correct / score.scorable) * 100)}% · ` : ""}
            {score.scorable - score.answered} missed · next N <span style={{ color: accent }}>{cfg.n}</span>
          </p>
        </div>
      )}
    </GameShell>
  );
}
