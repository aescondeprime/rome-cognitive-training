/**
 * Mental Math
 *
 * Progressive arithmetic: levels encode the digit count of each operand, so
 * "3.2" is a three-digit number against a two-digit one.
 *
 * Rewritten onto the shared game kit — the substance is unchanged, but answers
 * now go through ROME's key router instead of a native `<input>`. That is what
 * lets Mental Math and PASAT sit side by side in the Arena: digits land in
 * whichever of them you last clicked, rather than in whichever one the browser
 * happens to have focused.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import GameShell, { type Setting } from "@/components/games/GameShell";
import {
  MONO, SERIF, alpha, useGameConfig, useGameKeys, useScaled,
  type GameProps,
} from "@/lib/gameKit";
import { recordDrillResultInBackground } from "@/lib/trainingRecorder";

type Op = "+" | "-" | "×" | "÷" | "mixed";

const LEVELS: [number, number][] = [
  [1,1],[2,1],[2,2],[3,1],[3,2],[3,3],[4,2],[4,3],[4,4],
  [5,3],[5,4],[5,5],[6,4],[6,5],[6,6],
];
const LEVEL_LABELS = LEVELS.map(([a, b]) => `${a}.${b}`);
const accent = "hsl(var(--accent-h) 88% 60%)";

function randDigits(digits: number): number {
  const lo = Math.pow(10, digits - 1);
  const hi = Math.pow(10, digits) - 1;
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function generateProblem(levelIdx: number, op: Op): { expr: string; answer: number } {
  const [d1, d2] = LEVELS[levelIdx];
  const actual = op === "mixed" ? (["+", "-", "×", "÷"] as const)[Math.floor(Math.random() * 4)] : op;
  let a = randDigits(d1);
  let b = randDigits(d2);
  switch (actual) {
    case "-":
      if (b > a) [a, b] = [b, a];
      return { expr: `${a} − ${b}`, answer: a - b };
    case "×":
      a = randDigits(Math.min(d1, 3));
      b = randDigits(Math.min(d2, 3));
      return { expr: `${a} × ${b}`, answer: a * b };
    case "÷": {
      b = randDigits(Math.min(d2, 2)) || 1;
      const q = randDigits(Math.min(d1, 2)) || 1;
      return { expr: `${b * q} ÷ ${b}`, answer: q };
    }
    default:
      return { expr: `${a} + ${b}`, answer: a + b };
  }
}

interface Config {
  levelIdx: number;
  op: Op;
  trials: number;
  timeLimitMs: number;
  threshAdvance: number;
  threshFallback: number;
}

const DEFAULTS: Config = { levelIdx: 1, op: "mixed", trials: 10, timeLimitMs: 30000, threshAdvance: 80, threshFallback: 50 };

type Phase = "idle" | "running" | "feedback" | "result";

export default function MentalMath({ embedded, autoStart, onSessionComplete }: GameProps) {
  const [cfg, setCfg] = useGameConfig<Config>("mental-math", DEFAULTS);
  const px = useScaled();

  const [phase, setPhase] = useState<Phase>("idle");
  const [problem, setProblem] = useState<{ expr: string; answer: number } | null>(null);
  const [entry, setEntry] = useState("");
  const [trial, setTrial] = useState(0);
  const [lastCorrect, setLastCorrect] = useState<boolean | null>(null);
  const [correct, setCorrect] = useState(0);
  const [progress, setProgress] = useState(0);

  const entryRef = useRef("");
  const correctRef = useRef(0);
  const trialRef = useRef(0);
  const problemRef = useRef<{ expr: string; answer: number } | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const raf = useRef(0);
  const stepStart = useRef(0);
  const gen = useRef(0);
  const startedAt = useRef(0);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

  const clearAll = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    cancelAnimationFrame(raf.current);
  };
  useEffect(() => () => { gen.current += 1; clearAll(); }, []);

  const endSession = useCallback((finalCorrect: number) => {
    clearAll();
    const total = cfgRef.current.trials;
    const acc = (finalCorrect / total) * 100;
    const idx = cfgRef.current.levelIdx;
    const newIdx = acc >= cfgRef.current.threshAdvance && idx < LEVELS.length - 1 ? idx + 1
      : acc < cfgRef.current.threshFallback && idx > 0 ? idx - 1
      : idx;
    setCorrect(finalCorrect);
    setCfg(c => ({ ...c, levelIdx: newIdx }));
    setPhase("result");
    recordDrillResultInBackground({
      domain: "problem_solving", activityId: "mental-math",
      correct: finalCorrect, total, level: idx + 1, maxLevel: LEVELS.length,
      startedAt: startedAt.current,
    });
    onSessionComplete?.({ correct: finalCorrect, total, level: newIdx + 1 });
  }, [setCfg, onSessionComplete]);

  const nextProblem = useCallback((idx: number, myGen: number) => {
    if (myGen !== gen.current) return;
    const p = generateProblem(cfgRef.current.levelIdx, cfgRef.current.op);
    problemRef.current = p;
    trialRef.current = idx;
    entryRef.current = "";
    setProblem(p);
    setEntry("");
    setTrial(idx);
    setLastCorrect(null);
    setPhase("running");
    setProgress(0);
    stepStart.current = performance.now();
  }, []);

  const submit = useCallback(() => {
    const myGen = gen.current;
    const p = problemRef.current;
    if (!p) return;
    const ok = parseInt(entryRef.current.trim(), 10) === p.answer;
    if (ok) correctRef.current += 1;
    setLastCorrect(ok);
    setCorrect(correctRef.current);
    setPhase("feedback");
    timers.current.push(setTimeout(() => {
      if (myGen !== gen.current) return;
      const next = trialRef.current + 1;
      if (next >= cfgRef.current.trials) endSession(correctRef.current);
      else nextProblem(next, myGen);
    }, 850));
  }, [endSession, nextProblem]);

  const submitRef = useRef(submit);
  submitRef.current = submit;

  // One rAF loop draws the deadline bar and fires the timeout, so the bar
  // reaching zero and the answer being taken away are the same event.
  useEffect(() => {
    if (phase !== "running") return;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const elapsed = performance.now() - stepStart.current;
      const limit = cfgRef.current.timeLimitMs;
      setProgress(Math.min(1, elapsed / limit));
      if (elapsed >= limit) { submitRef.current(); return; }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { alive = false; cancelAnimationFrame(raf.current); };
  }, [phase, trial]);

  const startSession = useCallback(() => {
    gen.current += 1;
    clearAll();
    startedAt.current = Date.now();
    correctRef.current = 0;
    setCorrect(0);
    nextProblem(0, gen.current);
  }, [nextProblem]);

  const startRef = useRef(startSession);
  startRef.current = startSession;
  useEffect(() => { if (autoStart) startRef.current(); }, [autoStart]);

  const typeDigit = useCallback((k: string) => {
    if (entryRef.current.length >= 9) return;
    if (k === "-" && entryRef.current.length) return;
    entryRef.current += k;
    setEntry(entryRef.current);
  }, []);
  const backspace = useCallback(() => {
    entryRef.current = entryRef.current.slice(0, -1);
    setEntry(entryRef.current);
  }, []);

  useGameKeys([..."0123456789".split(""), "-"], typeDigit, phase === "running");
  useGameKeys(["Backspace"], backspace, phase === "running");
  useGameKeys(["Enter"], () => submitRef.current(), phase === "running");

  const settings: Setting[] = [
    { kind: "select", key: "levelIdx", label: "Difficulty", options: LEVEL_LABELS.map((l, i) => ({ value: i, label: l })) },
    { kind: "select", key: "op", label: "Operation", options: (["+", "-", "×", "÷", "mixed"] as Op[]).map(o => ({ value: o, label: o })) },
    { kind: "range", key: "trials", label: "Trials", min: 5, max: 40 },
    { kind: "range", key: "timeLimitMs", label: "Time per problem", min: 3000, max: 120000, step: 1000, format: v => `${v / 1000}s` },
    { kind: "range", key: "threshAdvance", label: "Advance at %", min: 60, max: 95, step: 5 },
    { kind: "range", key: "threshFallback", label: "Fall back below %", min: 30, max: 65, step: 5 },
  ];

  return (
    <GameShell
      title="Mental Math" accent={accent} embedded={embedded}
      subtitle={`Level ${LEVEL_LABELS[cfg.levelIdx]} · ${cfg.op} · ${cfg.trials} trials`}
      phase={phase === "idle" ? "idle" : phase === "result" ? "result" : "running"}
      onStart={startSession} settings={settings} cfg={cfg} setCfg={setCfg}
      variants={
        <div className="flex flex-wrap" style={{ gap: px(6) }}>
          {(["+", "-", "×", "÷", "mixed"] as Op[]).map(o => (
            <button key={o} onClick={() => setCfg(c => ({ ...c, op: o }))}
              className="rounded-lg font-semibold tracking-wide uppercase transition-all"
              style={{
                padding: `${px(6)}px ${px(12)}px`, fontSize: px(11), fontFamily: SERIF,
                background: cfg.op === o ? alpha(accent, 0.2) : "hsl(222 20% 5%)",
                border: `1px solid ${cfg.op === o ? accent : "hsl(var(--accent-h) 15% 14%)"}`,
                color: cfg.op === o ? accent : "hsl(214 20% 45%)",
              }}>{o}</button>
          ))}
        </div>
      }
      instructions={
        <p>Work the expression out in your head and type the answer, then press{" "}
          <kbd style={{ padding: `${px(2)}px ${px(6)}px`, borderRadius: px(4), background: "hsl(222 20% 9%)", border: "1px solid hsl(var(--accent-h) 15% 18%)", color: accent }}>Enter</kbd>.
          Difficulty follows your accuracy.</p>
      }
    >
      {(phase === "running" || phase === "feedback") && problem && (
        <div className="flex flex-col items-center w-full" style={{ gap: px(20), maxWidth: px(430) }}>
          <div className="w-full rounded-full overflow-hidden" style={{ height: px(3), background: "hsl(222 20% 10%)" }}>
            <div style={{ height: "100%", width: `${(1 - progress) * 100}%`, background: accent }} />
          </div>
          <p style={{ color: "hsl(214 20% 36%)", fontFamily: MONO, fontSize: px(10), letterSpacing: "0.15em" }}>
            {trial + 1} / {cfg.trials} · {correct} correct
          </p>
          <p style={{ fontFamily: SERIF, color: accent, fontSize: px(44), fontWeight: 700, letterSpacing: "0.04em", textAlign: "center" }}>
            {problem.expr}
          </p>
          {phase === "feedback" ? (
            <div className="flex items-center justify-center" style={{ gap: px(12), height: px(58) }}>
              {lastCorrect
                ? <Check style={{ width: px(28), height: px(28), color: "hsl(130 60% 55%)" }} />
                : <>
                    <X style={{ width: px(28), height: px(28), color: "hsl(0 60% 55%)" }} />
                    <span style={{ fontFamily: SERIF, fontSize: px(24), fontWeight: 700, color: accent }}>{problem.answer}</span>
                  </>}
            </div>
          ) : (
            <div className="flex items-center justify-center rounded-xl w-full"
              style={{
                height: px(58), fontFamily: SERIF, fontWeight: 700, fontSize: px(30), letterSpacing: "0.1em",
                background: "hsl(222 20% 7%)", border: `1px solid ${alpha(accent, 0.4)}`, color: accent,
              }}>
              {entry || "—"}
            </div>
          )}
        </div>
      )}

      {phase === "result" && (
        <div className="rounded-xl border text-center w-full"
          style={{ background: "hsl(222 20% 5%)", borderColor: alpha(accent, 0.3), padding: px(18), maxWidth: px(400) }}>
          <p style={{ fontFamily: SERIF, color: "hsl(214 20% 45%)", fontSize: px(11), letterSpacing: "0.15em", textTransform: "uppercase" }}>Session Complete</p>
          <p style={{ color: accent, fontFamily: SERIF, fontSize: px(38), fontWeight: 700, marginTop: px(10) }}>{correct}/{cfg.trials}</p>
          <p style={{ color: "hsl(214 20% 45%)", fontFamily: MONO, fontSize: px(11), marginTop: px(8) }}>
            Next level: <span style={{ color: accent }}>{LEVEL_LABELS[cfg.levelIdx]}</span>
          </p>
        </div>
      )}
    </GameShell>
  );
}
