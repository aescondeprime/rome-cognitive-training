/**
 * PASAT — Paced Auditory Serial Addition Task
 * A number appears every N seconds. Add the NEW number to the PREVIOUS one.
 * e.g. stream: 3, 7, 4, 2 → answers: 10, 11, 6
 * Player types the sum and hits Enter before the next number appears.
 * Level controls inter-stimulus interval (ISI): higher level = faster pace.
 * Adaptive: shorter ISI when accuracy is high.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { ArrowLeft, Settings2, Play, RotateCcw, Check } from "lucide-react";
import { Link } from "wouter";

// Level table: level number → ISI in ms (how long between each new number)
// Level 2 = 5s, Level 25 = 1.2s (brainscale-equivalent pacing)
function levelToISI(level: number): number {
  return Math.max(1200, 5000 - (level - 2) * 160);
}

interface Config {
  level: number;
  trials: number;
  threshAdvance: number;
  threshFallback: number;
}
const DEFAULT_CONFIG: Config = {
  level: 2, trials: 12, threshAdvance: 80, threshFallback: 50,
};

type Phase = "idle" | "running" | "result";
const accent = "hsl(345 60% 62%)";

export default function PASAT() {
  const [cfg, setCfg] = useState<Config>(DEFAULT_CONFIG);
  const [showSettings, setShowSettings] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");

  const [stream, setStream] = useState<number[]>([]);
  const [streamIdx, setStreamIdx] = useState(0);
  const [currentNum, setCurrentNum] = useState<number | null>(null);
  const [prevNum, setPrevNum] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [correct, setCorrect] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [feedback, setFeedback] = useState<"correct" | "wrong" | "missed" | null>(null);
  const [isMissed, setIsMissed] = useState(false);
  const [progress, setProgress] = useState(0); // 0–1 for the ISI countdown bar

  const inputRef = useRef<HTMLInputElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rafRef = useRef<number>(0);
  const startTimeRef = useRef(0);
  const pendingInputRef = useRef("");
  const streamRef = useRef<number[]>([]);
  const idxRef = useRef(0);
  const statsRef = useRef({ correct: 0, answered: 0 });
  const runningRef = useRef(false);

  const clearAll = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    cancelAnimationFrame(rafRef.current);
  };

  // Build number stream: N+1 numbers so we have N possible additions
  const buildStream = (trials: number): number[] =>
    Array.from({ length: trials + 1 }, () => 1 + Math.floor(Math.random() * 9));

  const endSession = useCallback(() => {
    runningRef.current = false;
    clearAll();
    const { correct: c, answered: a } = statsRef.current;
    const acc = a > 0 ? (c / a) * 100 : 0;
    const newLevel = acc >= cfg.threshAdvance && cfg.level < 25 ? cfg.level + 1
                   : acc < cfg.threshFallback && cfg.level > 2 ? cfg.level - 1
                   : cfg.level;
    setCfg(prev => ({ ...prev, level: newLevel }));
    setCorrect(c); setAnswered(a);
    setPhase("result");
  }, [cfg]);

  const advanceStep = useCallback(() => {
    if (!runningRef.current) return;
    const idx = idxRef.current;
    const s = streamRef.current;

    if (idx > cfg.trials) { endSession(); return; }

    // Score previous answer if we had a target
    if (idx > 1) {
      const expected = s[idx - 1] + s[idx - 2];
      const typed = parseInt(pendingInputRef.current.trim(), 10);
      if (!isNaN(typed)) {
        statsRef.current.answered++;
        if (typed === expected) {
          statsRef.current.correct++;
          setFeedback("correct");
        } else {
          setFeedback("wrong");
        }
      } else {
        setFeedback("missed");
        setIsMissed(true);
      }
      setTimeout(() => { setFeedback(null); setIsMissed(false); }, 400);
    }

    pendingInputRef.current = "";
    setInput("");
    setCurrentNum(s[idx]);
    setPrevNum(idx > 0 ? s[idx - 1] : null);
    setStreamIdx(idx);
    setProgress(0);
    startTimeRef.current = performance.now();
    idxRef.current = idx + 1;

    setCorrect(statsRef.current.correct);
    setAnswered(statsRef.current.answered);

    setTimeout(() => inputRef.current?.focus(), 20);
  }, [cfg.trials, endSession]);

  // Progress bar via rAF
  const animateBar = useCallback(() => {
    const isi = levelToISI(cfg.level);
    const elapsed = performance.now() - startTimeRef.current;
    setProgress(Math.min(1, elapsed / isi));
    if (runningRef.current) rafRef.current = requestAnimationFrame(animateBar);
  }, [cfg.level]);

  const startSession = useCallback(() => {
    clearAll();
    const s = buildStream(cfg.trials);
    streamRef.current = s;
    setStream(s);
    idxRef.current = 0;
    statsRef.current = { correct: 0, answered: 0 };
    pendingInputRef.current = "";
    setInput(""); setCorrect(0); setAnswered(0); setFeedback(null);
    setCurrentNum(null); setPrevNum(null);
    runningRef.current = true;
    setPhase("running");

    const isi = levelToISI(cfg.level);
    startTimeRef.current = performance.now();
    advanceStep();
    intervalRef.current = setInterval(advanceStep, isi);
    rafRef.current = requestAnimationFrame(animateBar);
  }, [cfg, advanceStep, animateBar]);

  const submit = useCallback(() => {
    // We just record the input; scoring happens at the next advanceStep
    pendingInputRef.current = input;
    setInput("");
    setTimeout(() => inputRef.current?.focus(), 10);
  }, [input]);

  useEffect(() => {
    if (phase !== "running") return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter") { e.preventDefault(); submit(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, submit]);

  useEffect(() => () => clearAll(), []);

  const isi = levelToISI(cfg.level);

  return (
    <div className="max-w-lg mx-auto py-4">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/athena"><button className="opacity-40 hover:opacity-80 transition-opacity"><ArrowLeft className="w-4 h-4" style={{ color: accent }} /></button></Link>
        <div className="flex-1">
          <h1 className="text-sm font-semibold tracking-widest uppercase" style={{ fontFamily: "'Cinzel', serif", color: accent }}>PASAT</h1>
          <p className="text-[10px]" style={{ color: "hsl(214 20% 40%)", fontFamily: "DM Mono, monospace" }}>
            Level {cfg.level} · {(isi / 1000).toFixed(1)}s pace · {cfg.trials} trials
          </p>
        </div>
        <button onClick={() => setShowSettings(s => !s)} className="opacity-40 hover:opacity-80 transition-opacity"><Settings2 className="w-4 h-4" style={{ color: accent }} /></button>
      </div>

      {/* Settings */}
      {showSettings && (
        <div className="mb-5 p-4 rounded-xl border space-y-3" style={{ background: "hsl(222 20% 5%)", borderColor: `${accent}25` }}>
          {([
            { label: "Level (2–25)", key: "level" as const, min: 2, max: 25, step: 1 },
            { label: "Trials", key: "trials" as const, min: 6, max: 30, step: 1 },
            { label: "Advance threshold %", key: "threshAdvance" as const, min: 60, max: 95, step: 5 },
            { label: "Fallback threshold %", key: "threshFallback" as const, min: 30, max: 65, step: 5 },
          ]).map(({ label, key, min, max, step }) => (
            <div key={key} className="flex items-center justify-between gap-4">
              <label className="text-[11px]" style={{ color: "hsl(214 20% 50%)", fontFamily: "DM Mono, monospace" }}>{label}</label>
              <div className="flex items-center gap-2">
                <input type="range" min={min} max={max} step={step} value={cfg[key]}
                  onChange={e => setCfg(c => ({ ...c, [key]: Number(e.target.value) }))}
                  className="w-24" style={{ accentColor: accent }} />
                <span className="text-[11px] w-8 text-right tabular-nums" style={{ color: accent }}>{cfg[key]}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {phase === "idle" && (
        <div className="mb-5 p-4 rounded-xl border text-[11px] leading-relaxed space-y-2" style={{ background: "hsl(222 20% 4%)", borderColor: "hsl(43 15% 12%)", color: "hsl(214 20% 50%)" }}>
          <p>Numbers appear one at a time. Add the <strong style={{ color: accent }}>current number</strong> to the <strong style={{ color: accent }}>previous one</strong> and enter the sum before the next number appears.</p>
          <p>e.g. stream <strong style={{ color: accent }}>3 → 7 → 4</strong> → you type <strong style={{ color: accent }}>10</strong>, then <strong style={{ color: accent }}>11</strong></p>
          <p>Higher levels reduce the time between numbers. Difficulty adapts automatically.</p>
        </div>
      )}

      {phase === "running" && (
        <div className="space-y-5">
          {/* ISI progress bar */}
          <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: "hsl(222 20% 10%)" }}>
            <div className="h-full rounded-full transition-none" style={{ width: `${(1 - progress) * 100}%`, background: accent, transition: "width 0.1s linear" }} />
          </div>

          {/* Number display */}
          <div className="text-center py-4">
            <p className="text-[10px] tracking-widest uppercase mb-3" style={{ color: "hsl(214 20% 36%)", fontFamily: "DM Mono, monospace" }}>
              {streamIdx > 0 ? `${streamIdx}/${cfg.trials}` : ""}
            </p>
            <div className="flex items-center justify-center gap-6">
              {prevNum !== null && (
                <span className="text-3xl font-bold opacity-40" style={{ fontFamily: "'Cinzel', serif", color: accent }}>{prevNum}</span>
              )}
              {prevNum !== null && <span className="text-xl opacity-30" style={{ color: accent }}>+</span>}
              <span
                className="text-7xl font-bold"
                style={{ fontFamily: "'Cinzel', serif", color: accent, filter: `drop-shadow(0 0 20px ${accent}80)`, transition: "all 0.15s ease" }}
              >
                {currentNum ?? "·"}
              </span>
            </div>
            {prevNum !== null && (
              <p className="text-[10px] mt-3" style={{ color: "hsl(214 20% 36%)", fontFamily: "DM Mono, monospace" }}>
                = ?
              </p>
            )}
          </div>

          {/* Feedback */}
          {feedback && (
            <div className="text-center">
              <span className="text-sm font-bold"
                style={{ color: feedback === "correct" ? "hsl(130 60% 55%)" : "hsl(0 60% 55%)", fontFamily: "DM Mono, monospace" }}>
                {feedback === "correct" ? "✓" : feedback === "missed" ? "—" : "✗"}
              </span>
            </div>
          )}

          {/* Input */}
          <div className="flex gap-2 max-w-xs mx-auto">
            <input
              ref={inputRef}
              type="number"
              value={input}
              onChange={e => { setInput(e.target.value); pendingInputRef.current = e.target.value; }}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
              placeholder="sum"
              disabled={streamIdx === 0}
              className="flex-1 text-center text-2xl font-bold rounded-xl px-4 py-3 outline-none"
              style={{ background: "hsl(222 20% 7%)", border: `1px solid ${accent}40`, color: accent, fontFamily: "'Cinzel', serif", opacity: streamIdx === 0 ? 0.3 : 1 }}
            />
            <button onClick={submit} disabled={streamIdx === 0}
              className="px-4 rounded-xl transition-all active:scale-95"
              style={{ background: `${accent}20`, border: `1px solid ${accent}40`, color: accent, opacity: streamIdx === 0 ? 0.3 : 1 }}>
              <Check className="w-5 h-5" />
            </button>
          </div>

          {/* Score */}
          <div className="flex justify-center gap-6">
            <div className="text-center">
              <p className="text-xl font-bold" style={{ color: accent, fontFamily: "'Cinzel', serif" }}>{correct}</p>
              <p className="text-[9px] tracking-widest uppercase" style={{ color: "hsl(214 20% 36%)", fontFamily: "DM Mono, monospace" }}>correct</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-bold" style={{ color: "hsl(214 20% 45%)", fontFamily: "'Cinzel', serif" }}>{answered}</p>
              <p className="text-[9px] tracking-widest uppercase" style={{ color: "hsl(214 20% 36%)", fontFamily: "DM Mono, monospace" }}>answered</p>
            </div>
          </div>
        </div>
      )}

      {phase === "result" && (
        <div className="mb-6 p-5 rounded-xl border text-center space-y-4" style={{ background: "hsl(222 20% 5%)", borderColor: `${accent}30` }}>
          <p className="text-[11px] tracking-widest uppercase" style={{ fontFamily: "'Cinzel', serif", color: "hsl(214 20% 45%)" }}>Session Complete</p>
          <p className="text-4xl font-bold" style={{ color: accent, fontFamily: "'Cinzel', serif" }}>{correct}/{answered}</p>
          <p className="text-[11px]" style={{ color: "hsl(214 20% 45%)", fontFamily: "DM Mono, monospace" }}>
            {answered > 0 ? `${Math.round((correct/answered)*100)}% accuracy` : "—"}
          </p>
          <p className="text-[11px]" style={{ color: "hsl(214 20% 45%)", fontFamily: "DM Mono, monospace" }}>
            Next level: <span style={{ color: accent }}>{cfg.level}</span> ({(levelToISI(cfg.level)/1000).toFixed(1)}s pace)
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
