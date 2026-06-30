/**
 * Dual N-Back
 * Audio channel: letters A–H spoken via Web Speech API
 * Visual channel: blue square flashing in one of 9 grid positions
 * Player presses A (audio match) or L (position match)
 * Adaptive: auto-advance N when accuracy ≥ 80%, drop when < 50%
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { ArrowLeft, Settings2, Play, RotateCcw } from "lucide-react";
import { Link } from "wouter";

const LETTERS = ["C", "H", "K", "L", "Q", "R", "S", "T"];
const GRID_SIZE = 9; // 3×3

function speak(letter: string, volume: number) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(letter);
  u.rate = 0.9; u.pitch = 1; u.volume = volume / 100;
  window.speechSynthesis.speak(u);
}

interface Config {
  n: number;
  trials: number;
  trialMs: number;
  threshAdvance: number;
  threshFallback: number;
  volume: number;
}

const DEFAULT_CONFIG: Config = {
  n: 1,
  trials: 21,
  trialMs: 3000,
  threshAdvance: 80,
  threshFallback: 50,
  volume: 60,
};

type Phase = "idle" | "running" | "result";
interface Result { nLevel: number; audioHits: number; posHits: number; audioMisses: number; posMisses: number; total: number; }

export default function DualNBack() {
  const [cfg, setCfg] = useState<Config>(DEFAULT_CONFIG);
  const [showSettings, setShowSettings] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<Result | null>(null);

  // Running state
  const [step, setStep] = useState(0);
  const [activePos, setActivePos] = useState<number | null>(null);
  const [activeLetter, setActiveLetter] = useState<string | null>(null);
  const [audioMatch, setAudioMatch] = useState(false);
  const [posMatch, setPosMatch] = useState(false);
  const [feedback, setFeedback] = useState<{ audio: "hit" | "miss" | null; pos: "hit" | "miss" | null }>({ audio: null, pos: null });

  const seqPos    = useRef<number[]>([]);
  const seqLetter = useRef<string[]>([]);
  const pressedAudio = useRef(false);
  const pressedPos   = useRef(false);
  const statsRef = useRef({ audioHits: 0, posHits: 0, audioMisses: 0, posMisses: 0 });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepRef  = useRef(0);
  const runningRef = useRef(false);

  const clearTimer = () => { if (timerRef.current) clearTimeout(timerRef.current); };

  const endSession = useCallback((n: number) => {
    runningRef.current = false;
    clearTimer();
    const s = statsRef.current;
    const total = Math.max(1, cfg.trials - n);
    const audioAcc = total > 0 ? ((s.audioHits / (s.audioHits + s.audioMisses || 1)) * 100) : 0;
    const newN = audioAcc >= cfg.threshAdvance ? n + 1
               : audioAcc < cfg.threshFallback && n > 1 ? n - 1 : n;
    setResult({ nLevel: newN, ...s, total });
    setCfg(c => ({ ...c, n: newN }));
    setPhase("result");
    setActivePos(null); setActiveLetter(null);
  }, [cfg]);

  const runStep = useCallback((i: number, n: number, trials: number) => {
    if (!runningRef.current) return;
    if (i >= trials) { endSession(n); return; }

    // Score previous step
    if (i > 0 && i > n) {
      const prevAudioMatch = seqLetter.current[i - 1] === seqLetter.current[i - 1 - n];
      const prevPosMatch   = seqPos.current[i - 1]    === seqPos.current[i - 1 - n];
      if (prevAudioMatch) {
        if (pressedAudio.current) statsRef.current.audioHits++;
        else statsRef.current.audioMisses++;
      }
      if (prevPosMatch) {
        if (pressedPos.current) statsRef.current.posHits++;
        else statsRef.current.posMisses++;
      }
      setFeedback({
        audio: prevAudioMatch ? (pressedAudio.current ? "hit" : "miss") : null,
        pos:   prevPosMatch   ? (pressedPos.current   ? "hit" : "miss") : null,
      });
      setTimeout(() => setFeedback({ audio: null, pos: null }), 400);
    }

    pressedAudio.current = false;
    pressedPos.current   = false;

    const pos = Math.floor(Math.random() * GRID_SIZE);
    const letter = LETTERS[Math.floor(Math.random() * LETTERS.length)];
    seqPos.current.push(pos);
    seqLetter.current.push(letter);

    setStep(i);
    setActivePos(pos);
    setActiveLetter(letter);
    speak(letter, cfg.volume);

    if (i >= n) {
      setAudioMatch(seqLetter.current[i] === seqLetter.current[i - n]);
      setPosMatch(seqPos.current[i] === seqPos.current[i - n]);
    } else {
      setAudioMatch(false); setPosMatch(false);
    }

    stepRef.current = i;
    timerRef.current = setTimeout(() => runStep(i + 1, n, trials), cfg.trialMs);
  }, [cfg, endSession]);

  const startSession = useCallback(() => {
    clearTimer();
    seqPos.current = []; seqLetter.current = [];
    pressedAudio.current = false; pressedPos.current = false;
    statsRef.current = { audioHits: 0, posHits: 0, audioMisses: 0, posMisses: 0 };
    setResult(null); setPhase("running"); setStep(0);
    setActivePos(null); setActiveLetter(null);
    runningRef.current = true;
    runStep(0, cfg.n, cfg.trials);
  }, [cfg, runStep]);

  // Keyboard handler
  useEffect(() => {
    if (phase !== "running") return;
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "a") { pressedAudio.current = true; }
      if (e.key.toLowerCase() === "l") { pressedPos.current = true; }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase]);

  useEffect(() => () => { clearTimer(); runningRef.current = false; }, []);

  const accentColor = "hsl(210 80% 62%)";

  return (
    <div className="max-w-lg mx-auto py-4">
      {/* Back + title */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/athena">
          <button className="opacity-40 hover:opacity-80 transition-opacity">
            <ArrowLeft className="w-4 h-4" style={{ color: accentColor }} />
          </button>
        </Link>
        <div className="flex-1">
          <h1 className="text-sm font-semibold tracking-widest uppercase" style={{ fontFamily: "'Cinzel', serif", color: accentColor }}>
            Dual N-Back
          </h1>
          <p className="text-[10px]" style={{ color: "hsl(214 20% 40%)", fontFamily: "DM Mono, monospace" }}>
            N = {cfg.n} · {cfg.trials} trials · {(cfg.trialMs / 1000).toFixed(1)}s each
          </p>
        </div>
        <button onClick={() => setShowSettings(s => !s)} className="opacity-40 hover:opacity-80 transition-opacity">
          <Settings2 className="w-4 h-4" style={{ color: accentColor }} />
        </button>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="mb-6 p-4 rounded-xl border space-y-3" style={{ background: "hsl(222 20% 5%)", borderColor: `${accentColor}25` }}>
          {[
            { label: "N-Back Level", key: "n" as keyof Config, min: 1, max: 10, step: 1 },
            { label: "Trials", key: "trials" as keyof Config, min: 10, max: 60, step: 1 },
            { label: "Trial Time (ms)", key: "trialMs" as keyof Config, min: 1500, max: 5000, step: 500 },
            { label: "Advance Threshold %", key: "threshAdvance" as keyof Config, min: 60, max: 95, step: 5 },
            { label: "Fallback Threshold %", key: "threshFallback" as keyof Config, min: 30, max: 70, step: 5 },
            { label: "Volume", key: "volume" as keyof Config, min: 0, max: 100, step: 10 },
          ].map(({ label, key, min, max, step: s }) => (
            <div key={key} className="flex items-center justify-between gap-4">
              <label className="text-[11px]" style={{ color: "hsl(214 20% 50%)", fontFamily: "DM Mono, monospace" }}>{label}</label>
              <div className="flex items-center gap-2">
                <input type="range" min={min} max={max} step={s} value={cfg[key]}
                  onChange={e => setCfg(c => ({ ...c, [key]: Number(e.target.value) }))}
                  className="w-28 accent-blue-400" />
                <span className="text-[11px] w-10 text-right tabular-nums" style={{ color: accentColor }}>{cfg[key]}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Instructions */}
      {phase === "idle" && (
        <div className="mb-6 p-4 rounded-xl border text-[11px] space-y-1.5 leading-relaxed" style={{ background: "hsl(222 20% 4%)", borderColor: "hsl(43 15% 12%)", color: "hsl(214 20% 50%)" }}>
          <p>A sequence of signals plays one at a time. Match each signal to what appeared <strong style={{ color: accentColor }}>N steps back</strong>.</p>
          <p><kbd className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: "hsl(222 20% 9%)", border: "1px solid hsl(43 15% 18%)", color: accentColor }}>A</kbd> — audio letter match &nbsp;&nbsp; <kbd className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: "hsl(222 20% 9%)", border: "1px solid hsl(43 15% 18%)", color: accentColor }}>L</kbd> — position match</p>
          <p>Auto-advances to N+1 when accuracy ≥ {cfg.threshAdvance}%, drops to N-1 when &lt; {cfg.threshFallback}%.</p>
        </div>
      )}

      {/* 3×3 Grid */}
      {(phase === "running") && (
        <div className="mb-6">
          <div
            className="grid gap-2 mx-auto"
            style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", width: 240, height: 240 }}
          >
            {Array.from({ length: 9 }).map((_, i) => {
              const isActive = activePos === i;
              return (
                <div
                  key={i}
                  className="rounded-lg transition-all duration-150"
                  style={{
                    background: isActive ? accentColor : "hsl(222 20% 8%)",
                    border: `1px solid ${isActive ? accentColor : "hsl(43 15% 14%)"}`,
                    boxShadow: isActive ? `0 0 24px ${accentColor}80, 0 0 8px ${accentColor}` : "none",
                  }}
                />
              );
            })}
          </div>

          {/* Letter display */}
          <div className="text-center mt-4">
            <span className="text-5xl font-bold" style={{ fontFamily: "'Cinzel', serif", color: activeLetter ? accentColor : "transparent", filter: activeLetter ? `drop-shadow(0 0 16px ${accentColor})` : "none", transition: "all 0.15s ease" }}>
              {activeLetter ?? "—"}
            </span>
          </div>

          {/* Progress + feedback */}
          <div className="flex items-center justify-between mt-4 px-1">
            <span className="text-[10px]" style={{ color: "hsl(214 20% 36%)", fontFamily: "DM Mono, monospace" }}>
              {step + 1} / {cfg.trials}
            </span>
            <div className="flex gap-4">
              <span className="text-[10px]" style={{ color: feedback.audio === "hit" ? "hsl(130 60% 55%)" : feedback.audio === "miss" ? "hsl(0 60% 55%)" : "hsl(214 20% 30%)", fontFamily: "DM Mono, monospace", transition: "color 0.2s" }}>
                AUDIO {feedback.audio === "hit" ? "✓" : feedback.audio === "miss" ? "✗" : "·"}
              </span>
              <span className="text-[10px]" style={{ color: feedback.pos === "hit" ? "hsl(130 60% 55%)" : feedback.pos === "miss" ? "hsl(0 60% 55%)" : "hsl(214 20% 30%)", fontFamily: "DM Mono, monospace", transition: "color 0.2s" }}>
                POS {feedback.pos === "hit" ? "✓" : feedback.pos === "miss" ? "✗" : "·"}
              </span>
            </div>
          </div>

          {/* Mobile tap buttons */}
          <div className="flex gap-3 mt-5">
            <button
              onPointerDown={() => { pressedAudio.current = true; }}
              className="flex-1 py-3 rounded-xl text-[11px] font-semibold tracking-widest uppercase transition-all active:scale-95"
              style={{ background: `${accentColor}15`, border: `1px solid ${accentColor}35`, color: accentColor, fontFamily: "'Cinzel', serif" }}
            >
              Audio (A)
            </button>
            <button
              onPointerDown={() => { pressedPos.current = true; }}
              className="flex-1 py-3 rounded-xl text-[11px] font-semibold tracking-widest uppercase transition-all active:scale-95"
              style={{ background: `${accentColor}15`, border: `1px solid ${accentColor}35`, color: accentColor, fontFamily: "'Cinzel', serif" }}
            >
              Position (L)
            </button>
          </div>
        </div>
      )}

      {/* Result */}
      {phase === "result" && result && (
        <div className="mb-6 p-5 rounded-xl border text-center space-y-4" style={{ background: "hsl(222 20% 5%)", borderColor: `${accentColor}30` }}>
          <p className="text-[11px] tracking-widest uppercase" style={{ fontFamily: "'Cinzel', serif", color: "hsl(214 20% 45%)" }}>Session Complete</p>
          <div className="flex justify-center gap-8">
            <div>
              <p className="text-3xl font-bold" style={{ color: accentColor, fontFamily: "'Cinzel', serif" }}>{result.audioHits + result.posHits}</p>
              <p className="text-[10px] mt-0.5" style={{ color: "hsl(214 20% 40%)", fontFamily: "DM Mono, monospace" }}>correct responses</p>
            </div>
            <div>
              <p className="text-3xl font-bold" style={{ color: accentColor, fontFamily: "'Cinzel', serif" }}>{result.nLevel}</p>
              <p className="text-[10px] mt-0.5" style={{ color: "hsl(214 20% 40%)", fontFamily: "DM Mono, monospace" }}>next N level</p>
            </div>
          </div>
          {result.nLevel !== cfg.n && (
            <p className="text-[11px]" style={{ color: result.nLevel > cfg.n ? "hsl(130 60% 55%)" : "hsl(35 90% 62%)", fontFamily: "DM Mono, monospace" }}>
              {result.nLevel > cfg.n ? `↑ Advancing to N-${result.nLevel}` : `↓ Stepping back to N-${result.nLevel}`}
            </p>
          )}
        </div>
      )}

      {/* Start / Restart */}
      {phase !== "running" && (
        <button
          onClick={startSession}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[12px] font-semibold tracking-widest uppercase transition-all active:scale-98"
          style={{ background: `${accentColor}15`, border: `1px solid ${accentColor}40`, color: accentColor, fontFamily: "'Cinzel', serif" }}
        >
          {phase === "result" ? <RotateCcw className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          {phase === "result" ? "Run Again" : "Begin Trial"}
        </button>
      )}
    </div>
  );
}
