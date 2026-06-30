/**
 * Mental Math
 * Progressive arithmetic — levels encode digit counts for each operand.
 * Level "2.2" = 2-digit op1, 2-digit op2. "3.2" = 3-digit + 2-digit, etc.
 * Operations: +, -, ×, ÷, or mixed
 * Adaptive: auto-advance level on high accuracy, drop on low
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { ArrowLeft, Settings2, Play, RotateCcw, Check, X } from "lucide-react";
import { Link } from "wouter";

type Op = "+" | "-" | "×" | "÷" | "mixed";

// Level table: [digits1, digits2]
const LEVELS: [number, number][] = [
  [1,1],[2,1],[2,2],[3,1],[3,2],[3,3],[4,2],[4,3],[4,4],
  [5,3],[5,4],[5,5],[6,4],[6,5],[6,6],
];
const LEVEL_LABELS = LEVELS.map(([a,b]) => `${a}.${b}`);

function randInt(digits: number): number {
  const lo = Math.pow(10, digits - 1);
  const hi = Math.pow(10, digits) - 1;
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function generateProblem(levelIdx: number, op: Op): { expr: string; answer: number } {
  const [d1, d2] = LEVELS[levelIdx];
  const actualOp = op === "mixed" ? (["+","-","×","÷"] as const)[Math.floor(Math.random()*4)] : op;
  let a = randInt(d1), b = randInt(d2), answer: number, expr: string;
  switch (actualOp) {
    case "+": answer = a + b; expr = `${a} + ${b}`; break;
    case "-": if (b > a) [a, b] = [b, a]; answer = a - b; expr = `${a} − ${b}`; break;
    case "×": a = randInt(Math.min(d1, 3)); b = randInt(Math.min(d2, 3)); answer = a * b; expr = `${a} × ${b}`; break;
    case "÷": {
      b = randInt(Math.min(d2, 2)) || 1;
      const q = randInt(Math.min(d1, 2)) || 1;
      a = b * q; answer = q; expr = `${a} ÷ ${b}`;
      break;
    }
    default: answer = a + b; expr = `${a} + ${b}`;
  }
  return { expr, answer };
}

interface Config {
  levelIdx: number;
  op: Op;
  trials: number;
  timeLimitMs: number;
  threshAdvance: number;
  threshFallback: number;
}
const DEFAULT_CONFIG: Config = { levelIdx: 1, op: "mixed", trials: 10, timeLimitMs: 60000, threshAdvance: 80, threshFallback: 50 };

type Phase = "idle" | "running" | "feedback" | "result";
const accent = "hsl(43 88% 60%)";

export default function MentalMath() {
  const [cfg, setCfg] = useState<Config>(DEFAULT_CONFIG);
  const [showSettings, setShowSettings] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");

  const [problem, setProblem] = useState<{ expr: string; answer: number } | null>(null);
  const [input, setInput] = useState("");
  const [trialNum, setTrialNum] = useState(0);
  const [lastCorrect, setLastCorrect] = useState<boolean | null>(null);
  const [lastAnswer, setLastAnswer] = useState<number | null>(null);
  const [correct, setCorrect] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nextProblem = useCallback((idx: number, levelIdx: number) => {
    setProblem(generateProblem(levelIdx, cfg.op));
    setInput("");
    setLastCorrect(null);
    setLastAnswer(null);
    setTrialNum(idx);
    setPhase("running");
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [cfg.op]);

  const endSession = useCallback((correctCount: number, total: number, levelIdx: number) => {
    const acc = (correctCount / total) * 100;
    const newIdx = acc >= cfg.threshAdvance && levelIdx < LEVELS.length - 1 ? levelIdx + 1
                 : acc < cfg.threshFallback && levelIdx > 0 ? levelIdx - 1
                 : levelIdx;
    setCfg(c => ({ ...c, levelIdx: newIdx }));
    setCorrect(correctCount);
    setPhase("result");
  }, [cfg.threshAdvance, cfg.threshFallback]);

  const submit = useCallback(() => {
    if (!problem || phase !== "running") return;
    const val = parseInt(input.trim(), 10);
    const ok = val === problem.answer;
    setLastCorrect(ok);
    setLastAnswer(problem.answer);
    setCorrect(c => c + (ok ? 1 : 0));
    setPhase("feedback");
    const next = trialNum + 1;
    timerRef.current = setTimeout(() => {
      if (next >= cfg.trials) {
        endSession(correct + (ok ? 1 : 0), cfg.trials, cfg.levelIdx);
      } else {
        nextProblem(next, cfg.levelIdx);
      }
    }, 900);
  }, [problem, phase, input, trialNum, cfg, correct, endSession, nextProblem]);

  const startSession = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setCorrect(0);
    nextProblem(0, cfg.levelIdx);
  }, [cfg.levelIdx, nextProblem]);

  useEffect(() => {
    if (phase !== "running") return;
    const t = setTimeout(() => submit(), cfg.timeLimitMs);
    return () => clearTimeout(t);
  }, [problem, phase, cfg.timeLimitMs, submit]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <div className="max-w-lg mx-auto py-4">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/athena"><button className="opacity-40 hover:opacity-80 transition-opacity"><ArrowLeft className="w-4 h-4" style={{ color: accent }} /></button></Link>
        <div className="flex-1">
          <h1 className="text-sm font-semibold tracking-widest uppercase" style={{ fontFamily: "'Cinzel', serif", color: accent }}>Mental Math</h1>
          <p className="text-[10px]" style={{ color: "hsl(214 20% 40%)", fontFamily: "DM Mono, monospace" }}>Level {LEVEL_LABELS[cfg.levelIdx]} · {cfg.op} · {cfg.trials} trials</p>
        </div>
        <button onClick={() => setShowSettings(s => !s)} className="opacity-40 hover:opacity-80 transition-opacity"><Settings2 className="w-4 h-4" style={{ color: accent }} /></button>
      </div>

      {/* Op selector */}
      {phase === "idle" && (
        <div className="flex gap-1.5 mb-4 flex-wrap">
          {(["+","-","×","÷","mixed"] as Op[]).map(o => (
            <button key={o} onClick={() => setCfg(c => ({ ...c, op: o }))}
              className="px-3 py-1.5 rounded-lg text-[11px] font-semibold tracking-wide uppercase transition-all"
              style={{ background: cfg.op === o ? `${accent}20` : "hsl(222 20% 5%)", border: `1px solid ${cfg.op === o ? accent : "hsl(43 15% 14%)"}`, color: cfg.op === o ? accent : "hsl(214 20% 45%)", fontFamily: "'Cinzel', serif" }}>
              {o}
            </button>
          ))}
        </div>
      )}

      {/* Settings */}
      {showSettings && (
        <div className="mb-5 p-4 rounded-xl border space-y-3" style={{ background: "hsl(222 20% 5%)", borderColor: `${accent}25` }}>
          <div className="flex items-center justify-between gap-4">
            <label className="text-[11px]" style={{ color: "hsl(214 20% 50%)", fontFamily: "DM Mono, monospace" }}>Difficulty Level</label>
            <select value={cfg.levelIdx} onChange={e => setCfg(c => ({ ...c, levelIdx: Number(e.target.value) }))}
              className="text-[11px] rounded px-2 py-1" style={{ background: "hsl(222 20% 9%)", border: `1px solid hsl(43 15% 18%)`, color: accent }}>
              {LEVEL_LABELS.map((l, i) => <option key={l} value={i}>{l}</option>)}
            </select>
          </div>
          {[
            { label: "Trials", key: "trials" as const, min: 5, max: 30, step: 1 },
            { label: "Time limit (s)", key: "timeLimitMs" as const, min: 10000, max: 120000, step: 5000, display: (v: number) => `${v/1000}s` },
            { label: "Advance threshold %", key: "threshAdvance" as const, min: 60, max: 95, step: 5 },
            { label: "Fallback threshold %", key: "threshFallback" as const, min: 30, max: 65, step: 5 },
          ].map(({ label, key, min, max, step, display }) => (
            <div key={key} className="flex items-center justify-between gap-4">
              <label className="text-[11px]" style={{ color: "hsl(214 20% 50%)", fontFamily: "DM Mono, monospace" }}>{label}</label>
              <div className="flex items-center gap-2">
                <input type="range" min={min} max={max} step={step} value={cfg[key]}
                  onChange={e => setCfg(c => ({ ...c, [key]: Number(e.target.value) }))}
                  className="w-24" style={{ accentColor: accent }} />
                <span className="text-[11px] w-12 text-right tabular-nums" style={{ color: accent }}>
                  {display ? display(cfg[key]) : cfg[key]}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Idle instructions */}
      {phase === "idle" && (
        <div className="mb-5 p-4 rounded-xl border text-[11px] leading-relaxed" style={{ background: "hsl(222 20% 4%)", borderColor: "hsl(43 15% 12%)", color: "hsl(214 20% 50%)" }}>
          <p>An arithmetic expression appears. Calculate the answer mentally and type it, then press <kbd className="px-1 rounded text-[10px]" style={{ background: "hsl(222 20% 9%)", border: "1px solid hsl(43 15% 18%)", color: accent }}>Enter</kbd>. Difficulty adapts to your accuracy.</p>
        </div>
      )}

      {/* Running / feedback */}
      {(phase === "running" || phase === "feedback") && problem && (
        <div className="text-center space-y-6 py-4">
          <p className="text-[10px] tracking-widest uppercase" style={{ color: "hsl(214 20% 36%)", fontFamily: "DM Mono, monospace" }}>
            {trialNum + 1} / {cfg.trials}
          </p>
          <p className="text-4xl font-bold" style={{ fontFamily: "'Cinzel', serif", color: accent, letterSpacing: "0.04em" }}>
            {problem.expr}
          </p>
          {phase === "feedback" ? (
            <div className="flex items-center justify-center gap-3">
              {lastCorrect
                ? <Check className="w-6 h-6" style={{ color: "hsl(130 60% 55%)" }} />
                : <><X className="w-6 h-6" style={{ color: "hsl(0 60% 55%)" }} /><span className="text-xl font-bold" style={{ color: accent }}>{lastAnswer}</span></>}
            </div>
          ) : (
            <div className="flex gap-2 max-w-xs mx-auto">
              <input
                ref={inputRef}
                type="number"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") submit(); }}
                placeholder="answer"
                className="flex-1 text-center text-2xl font-bold rounded-xl px-4 py-3 outline-none"
                style={{ background: "hsl(222 20% 7%)", border: `1px solid ${accent}40`, color: accent, fontFamily: "'Cinzel', serif" }}
              />
              <button onClick={submit} className="px-4 rounded-xl transition-all active:scale-95"
                style={{ background: `${accent}20`, border: `1px solid ${accent}40`, color: accent }}>
                <Check className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Result */}
      {phase === "result" && (
        <div className="mb-6 p-5 rounded-xl border text-center space-y-4" style={{ background: "hsl(222 20% 5%)", borderColor: `${accent}30` }}>
          <p className="text-[11px] tracking-widest uppercase" style={{ fontFamily: "'Cinzel', serif", color: "hsl(214 20% 45%)" }}>Session Complete</p>
          <p className="text-4xl font-bold" style={{ color: accent, fontFamily: "'Cinzel', serif" }}>{correct}/{cfg.trials}</p>
          <p className="text-[11px]" style={{ color: "hsl(214 20% 45%)", fontFamily: "DM Mono, monospace" }}>
            Next level: <span style={{ color: accent }}>{LEVEL_LABELS[cfg.levelIdx]}</span>
          </p>
        </div>
      )}

      {(phase === "idle" || phase === "result") && (
        <button onClick={startSession}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[12px] font-semibold tracking-widest uppercase transition-all"
          style={{ background: `${accent}15`, border: `1px solid ${accent}40`, color: accent, fontFamily: "'Cinzel', serif" }}>
          {phase === "result" ? <RotateCcw className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          {phase === "result" ? "Run Again" : "Begin Trial"}
        </button>
      )}
    </div>
  );
}
