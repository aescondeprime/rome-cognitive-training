/**
 * Memory Span
 * A sequence of digits or letters flashes one at a time.
 * Player types or taps them back in order (Forward), reversed (Reverse), or sorted (Sorted).
 * Adaptive span length.
 */
import { useState, useCallback, useRef, useEffect } from "react";
import { ArrowLeft, Settings2, Play, RotateCcw, Delete } from "lucide-react";
import { Link } from "wouter";

type SpanType = "Digit" | "DigitReverse" | "DigitSorted" | "Letter" | "LetterReverse" | "LetterSorted";

const DIGIT_POOL = "123456789".split("");
const LETTER_POOL = "BCDFGHJKLMNPQRSTVWXZ".split("");

function genSequence(level: number, type: SpanType): string[] {
  const pool = type.startsWith("Letter") ? LETTER_POOL : DIGIT_POOL;
  const seq: string[] = [];
  for (let i = 0; i < level; i++) {
    let c: string;
    do { c = pool[Math.floor(Math.random() * pool.length)]; } while (c === seq[seq.length - 1]);
    seq.push(c);
  }
  return seq;
}

function expectedAnswer(seq: string[], type: SpanType): string[] {
  if (type.includes("Reverse")) return [...seq].reverse();
  if (type.includes("Sorted")) return [...seq].sort();
  return seq;
}

interface Config {
  level: number;
  rounds: number;
  litMs: number;
  type: SpanType;
  threshAdvance: number;
  threshFallback: number;
}
const DEFAULT_CONFIG: Config = {
  level: 5, rounds: 4, litMs: 1000, type: "Digit",
  threshAdvance: 80, threshFallback: 50,
};

type Phase = "idle" | "showing" | "input" | "feedback" | "result";
const accent = "hsl(35 90% 62%)";

const TYPES: SpanType[] = ["Digit","DigitReverse","DigitSorted","Letter","LetterReverse","LetterSorted"];

export default function MemorySpan() {
  const [cfg, setCfg] = useState<Config>(DEFAULT_CONFIG);
  const [showSettings, setShowSettings] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");

  const [sequence, setSequence] = useState<string[]>([]);
  const [shownIdx, setShownIdx] = useState<number>(-1);
  const [playerInput, setPlayerInput] = useState<string[]>([]);
  const [round, setRound] = useState(0);
  const [roundResults, setRoundResults] = useState<boolean[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = () => { if (timerRef.current) clearTimeout(timerRef.current); };

  const showSequence = useCallback((seq: string[]) => {
    setPhase("showing");
    setShownIdx(-1);
    const gap = cfg.litMs + 200;
    seq.forEach((_, i) => {
      timerRef.current = setTimeout(() => {
        setShownIdx(i);
        timerRef.current = setTimeout(() => {
          setShownIdx(-1);
          if (i === seq.length - 1) {
            setTimeout(() => { setPlayerInput([]); setPhase("input"); }, 350);
          }
        }, cfg.litMs);
      }, i * gap);
    });
  }, [cfg.litMs]);

  const startRound = useCallback((roundIdx: number, level: number) => {
    const seq = genSequence(level, cfg.type);
    setSequence(seq);
    setRound(roundIdx);
    setTimeout(() => showSequence(seq), 400);
  }, [cfg.type, showSequence]);

  const startSession = useCallback(() => {
    clearTimers();
    setRoundResults([]);
    startRound(0, cfg.level);
  }, [cfg.level, startRound]);

  const handleInput = useCallback((item: string) => {
    if (phase !== "input") return;
    const newInput = [...playerInput, item];
    setPlayerInput(newInput);
    if (newInput.length === sequence.length) {
      const expected = expectedAnswer(sequence, cfg.type);
      const correct = newInput.every((c, i) => c === expected[i]);
      const newResults = [...roundResults, correct];
      setRoundResults(newResults);
      setPhase("feedback");
      timerRef.current = setTimeout(() => {
        const nextRound = round + 1;
        if (nextRound >= cfg.rounds) {
          const hits = newResults.filter(Boolean).length;
          const acc = (hits / cfg.rounds) * 100;
          const newLevel = acc >= cfg.threshAdvance && cfg.level < 30 ? cfg.level + 1
                         : acc < cfg.threshFallback && cfg.level > 1 ? cfg.level - 1
                         : cfg.level;
          setCfg(c => ({ ...c, level: newLevel }));
          setPhase("result");
        } else {
          startRound(nextRound, cfg.level);
        }
      }, 900);
    }
  }, [phase, playerInput, sequence, cfg, roundResults, round, startRound]);

  const handleBackspace = () => {
    if (phase !== "input") return;
    setPlayerInput(p => p.slice(0, -1));
  };

  const pool = cfg.type.startsWith("Letter") ? LETTER_POOL : DIGIT_POOL;
  const currentItem = shownIdx >= 0 ? sequence[shownIdx] : null;
  const lastCorrect = roundResults[roundResults.length - 1];
  const expectedSeq = phase === "feedback" ? expectedAnswer(sequence, cfg.type) : [];

  return (
    <div className="max-w-lg mx-auto py-4">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/athena"><button className="opacity-40 hover:opacity-80 transition-opacity"><ArrowLeft className="w-4 h-4" style={{ color: accent }} /></button></Link>
        <div className="flex-1">
          <h1 className="text-sm font-semibold tracking-widest uppercase" style={{ fontFamily: "'Cinzel', serif", color: accent }}>Memory Span</h1>
          <p className="text-[10px]" style={{ color: "hsl(214 20% 40%)", fontFamily: "DM Mono, monospace" }}>Span {cfg.level} · {cfg.type} · {cfg.rounds} rounds</p>
        </div>
        <button onClick={() => setShowSettings(s => !s)} className="opacity-40 hover:opacity-80 transition-opacity"><Settings2 className="w-4 h-4" style={{ color: accent }} /></button>
      </div>

      {/* Type selector */}
      {phase === "idle" && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {TYPES.map(t => (
            <button key={t} onClick={() => setCfg(c => ({ ...c, type: t }))}
              className="px-2.5 py-1.5 rounded-lg text-[10px] font-semibold tracking-wide uppercase transition-all"
              style={{ background: cfg.type === t ? `${accent}20` : "hsl(222 20% 5%)", border: `1px solid ${cfg.type === t ? accent : "hsl(43 15% 14%)"}`, color: cfg.type === t ? accent : "hsl(214 20% 45%)", fontFamily: "'Cinzel', serif" }}>
              {t}
            </button>
          ))}
        </div>
      )}

      {/* Settings */}
      {showSettings && (
        <div className="mb-5 p-4 rounded-xl border space-y-3" style={{ background: "hsl(222 20% 5%)", borderColor: `${accent}25` }}>
          {([
            { label: "Span Length (Level)", key: "level" as const, min: 1, max: 30, step: 1 },
            { label: "Rounds", key: "rounds" as const, min: 2, max: 10, step: 1 },
            { label: "Display time (ms)", key: "litMs" as const, min: 400, max: 3000, step: 100 },
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
        <div className="mb-5 p-4 rounded-xl border text-[11px] leading-relaxed" style={{ background: "hsl(222 20% 4%)", borderColor: "hsl(43 15% 12%)", color: "hsl(214 20% 50%)" }}>
          <p>A sequence flashes one item at a time. Recall it <strong style={{ color: accent }}>
            {cfg.type.includes("Reverse") ? "in reverse" : cfg.type.includes("Sorted") ? "sorted alphabetically/numerically" : "in the same order"}
          </strong>. Span grows as you improve.</p>
        </div>
      )}

      {/* Showing phase — big centered item */}
      {phase === "showing" && (
        <div className="text-center py-10">
          <div className="text-8xl font-bold transition-all duration-150"
            style={{ fontFamily: "'Cinzel', serif", color: currentItem ? accent : "transparent",
              filter: currentItem ? `drop-shadow(0 0 24px ${accent})` : "none", minHeight: 120 }}>
            {currentItem ?? "·"}
          </div>
          <p className="text-[10px] mt-4 tracking-widest uppercase" style={{ color: "hsl(214 20% 36%)", fontFamily: "DM Mono, monospace" }}>
            {shownIdx + 1} / {sequence.length}
          </p>
        </div>
      )}

      {/* Input phase — tap-pad */}
      {(phase === "input" || phase === "feedback") && (
        <div className="space-y-4">
          {/* Answer preview */}
          <div className="flex gap-1.5 flex-wrap justify-center min-h-8">
            {Array.from({ length: sequence.length }).map((_, i) => {
              const val = playerInput[i];
              const expected = expectedSeq[i];
              const isCorrect = phase === "feedback" && val !== undefined ? val === expected : null;
              return (
                <span key={i} className="w-9 h-9 rounded-lg flex items-center justify-center text-base font-bold transition-all"
                  style={{
                    background: phase === "feedback"
                      ? isCorrect ? "hsl(130 40% 15%)" : "hsl(0 40% 15%)"
                      : val ? `${accent}20` : "hsl(222 20% 8%)",
                    border: `1px solid ${phase === "feedback" ? (isCorrect ? "hsl(130 60% 40%)" : "hsl(0 60% 40%)") : val ? accent : "hsl(43 15% 16%)"}`,
                    color: phase === "feedback" ? (isCorrect ? "hsl(130 60% 60%)" : "hsl(0 60% 60%)") : val ? accent : "hsl(214 20% 30%)",
                    fontFamily: "'Cinzel', serif",
                  }}>
                  {phase === "feedback" ? (val ?? "—") : (val ?? "")}
                </span>
              );
            })}
          </div>

          {phase === "feedback" && (
            <p className="text-center text-[10px]" style={{ color: "hsl(214 20% 40%)", fontFamily: "DM Mono, monospace" }}>
              Expected: {expectedSeq.join(" ")}
            </p>
          )}

          {/* Tap pad */}
          {phase === "input" && (
            <div className="flex flex-wrap gap-2 justify-center">
              {pool.map(item => (
                <button key={item} onClick={() => handleInput(item)}
                  className="w-11 h-11 rounded-lg text-sm font-bold transition-all active:scale-90"
                  style={{ background: "hsl(222 20% 8%)", border: `1px solid hsl(43 15% 16%)`, color: "hsl(46 45% 70%)", fontFamily: "'Cinzel', serif" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = accent; (e.currentTarget as HTMLButtonElement).style.color = accent; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "hsl(43 15% 16%)"; (e.currentTarget as HTMLButtonElement).style.color = "hsl(46 45% 70%)"; }}>
                  {item}
                </button>
              ))}
              <button onClick={handleBackspace}
                className="w-11 h-11 rounded-lg flex items-center justify-center transition-all active:scale-90"
                style={{ background: "hsl(222 20% 8%)", border: "1px solid hsl(43 15% 16%)", color: "hsl(214 20% 45%)" }}>
                <Delete className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Round dots */}
      {(phase === "showing" || phase === "input" || phase === "feedback") && (
        <div className="flex gap-1.5 justify-center mt-5">
          {Array.from({ length: cfg.rounds }).map((_, i) => (
            <div key={i} className="w-2 h-2 rounded-full transition-all" style={{
              background: i < roundResults.length
                ? roundResults[i] ? "hsl(130 60% 50%)" : "hsl(0 60% 50%)"
                : i === round ? accent : "hsl(222 20% 12%)",
            }} />
          ))}
        </div>
      )}

      {/* Result */}
      {phase === "result" && (
        <div className="mb-6 p-5 rounded-xl border text-center space-y-4" style={{ background: "hsl(222 20% 5%)", borderColor: `${accent}30` }}>
          <p className="text-[11px] tracking-widest uppercase" style={{ fontFamily: "'Cinzel', serif", color: "hsl(214 20% 45%)" }}>Session Complete</p>
          <p className="text-4xl font-bold" style={{ color: accent, fontFamily: "'Cinzel', serif" }}>
            {roundResults.filter(Boolean).length}/{cfg.rounds}
          </p>
          <p className="text-[11px]" style={{ color: "hsl(214 20% 45%)", fontFamily: "DM Mono, monospace" }}>
            Next span: <span style={{ color: accent }}>{cfg.level}</span>
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
