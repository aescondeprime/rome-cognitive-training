/**
 * Complex Working Memory (CWM)
 * Verbal: decide if a word is spelled correctly → remember a letter
 * Spatial: decide if a figure is Y-axis symmetric → remember a grid cell
 * Recall all memorized items in order after all rounds
 * Adaptive: advance level when ≥ 80% correct, fall back when < 50%
 */
import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, Settings2, Play, RotateCcw } from "lucide-react";
import { Link } from "wouter";

// ── Word lists for verbal decision ────────────────────────────────────────
const CORRECT_WORDS = ["brief","cloud","dream","earth","flame","grace","heart","light","magic","night","ocean","peace","quiet","river","storm","think","under","voice","water","world"];
const WRONG_WORDS   = ["breif","cloud","dreem","earht","flmae","graec","haert","lihgt","mgicc","nihgt","ocaen","paece","qiuet","rivir","strom","tinhk","undre","voiice","watre","wrold"];

// ── Symmetric shapes SVG paths (Y-axis symmetric) ─────────────────────────
const SYM_SHAPES  = ["M10,2 L18,10 L14,18 L10,14 L6,18 L2,10 Z", "M10,2 L18,10 L10,18 L2,10 Z", "M2,10 L10,2 L18,10 L10,18 Z", "M5,2 L15,2 L18,10 L15,18 L5,18 L2,10 Z"];
const ASYM_SHAPES = ["M2,2 L14,4 L18,14 L8,18 Z", "M2,6 L16,2 L18,16 L4,18 Z", "M2,2 L18,8 L14,18 L6,12 Z", "M4,2 L18,4 L16,18 L2,12 Z"];

const LETTERS_POOL = "BCDFGHJKLMNPQRSTVWXZ".split("");
const GRID_COLS = 4; const GRID_ROWS = 4; const GRID_CELLS = GRID_COLS * GRID_ROWS;

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function pickIdx(max: number) { return Math.floor(Math.random() * max); }

interface Config {
  level: number;
  decisionsPerRound: number;
  trialMs: number;
  threshAdvance: number;
  threshFallback: number;
}
const DEFAULT_CONFIG: Config = { level: 2, decisionsPerRound: 4, trialMs: 1500, threshAdvance: 80, threshFallback: 50 };

type GameType = "verbal" | "spatial";
type Phase = "idle" | "decision" | "memorize" | "recall" | "result";

interface Round { decisionAnswers: boolean[]; decisionCorrect: boolean[]; itemToRemember: string | number; }

const accent = "hsl(270 60% 65%)";

export default function CWM() {
  const [cfg, setCfg] = useState<Config>(DEFAULT_CONFIG);
  const [type, setType] = useState<GameType>("verbal");
  const [showSettings, setShowSettings] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");

  // Round state
  const [currentRound, setCurrentRound] = useState(0);
  const [currentDecision, setCurrentDecision] = useState(0);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [currentWord, setCurrentWord] = useState("");
  const [currentWordCorrect, setCurrentWordCorrect] = useState(false);
  const [currentShape, setCurrentShape] = useState("");
  const [currentShapeSym, setCurrentShapeSym] = useState(false);
  const [currentMemItem, setCurrentMemItem] = useState<string | number | null>(null);
  const [recallInput, setRecallInput] = useState<(string | number | null)[]>([]);
  const [recallIdx, setRecallIdx] = useState(0);
  const [score, setScore] = useState({ correct: 0, total: 0 });

  const buildRound = useCallback((): Round => {
    const decisionAnswers: boolean[] = [];
    const decisionCorrect: boolean[] = [];
    for (let i = 0; i < cfg.decisionsPerRound; i++) {
      if (type === "verbal") {
        const useCorrect = Math.random() > 0.5;
        decisionCorrect.push(useCorrect);
        decisionAnswers.push(false);
      } else {
        const useSym = Math.random() > 0.5;
        decisionCorrect.push(useSym);
        decisionAnswers.push(false);
      }
    }
    const itemToRemember = type === "verbal"
      ? pick(LETTERS_POOL)
      : pickIdx(GRID_CELLS);
    return { decisionAnswers, decisionCorrect, itemToRemember };
  }, [cfg.decisionsPerRound, type]);

  const startSession = useCallback(() => {
    const builtRounds: Round[] = Array.from({ length: cfg.level }, () => buildRound());
    setRounds(builtRounds);
    setCurrentRound(0); setCurrentDecision(0);
    setRecallInput([]); setRecallIdx(0);
    setScore({ correct: 0, total: cfg.level });

    // Generate first decision stimulus
    if (type === "verbal") {
      const useCorrect = builtRounds[0].decisionCorrect[0];
      setCurrentWord(useCorrect ? pick(CORRECT_WORDS) : pick(WRONG_WORDS));
      setCurrentWordCorrect(useCorrect);
    } else {
      const useSym = builtRounds[0].decisionCorrect[0];
      setCurrentShape(useSym ? pick(SYM_SHAPES) : pick(ASYM_SHAPES));
      setCurrentShapeSym(useSym);
    }
    setPhase("decision");
  }, [cfg.level, buildRound, type]);

  const handleDecision = useCallback((answer: boolean) => {
    const round = rounds[currentRound];
    // check answer
    const correct = answer === round.decisionCorrect[currentDecision];
    const updatedRounds = rounds.map((r, ri) => ri === currentRound
      ? { ...r, decisionAnswers: r.decisionAnswers.map((a, ai) => ai === currentDecision ? answer : a) }
      : r
    );
    setRounds(updatedRounds);

    const nextDec = currentDecision + 1;
    if (nextDec >= cfg.decisionsPerRound) {
      // Show memorize item
      setCurrentMemItem(round.itemToRemember);
      setPhase("memorize");
      setTimeout(() => {
        setCurrentMemItem(null);
        const nextRound = currentRound + 1;
        if (nextRound >= cfg.level) {
          // Start recall
          setRecallInput(Array(cfg.level).fill(null));
          setRecallIdx(0);
          setPhase("recall");
        } else {
          setCurrentRound(nextRound); setCurrentDecision(0);
          const r = updatedRounds[nextRound];
          if (type === "verbal") {
            setCurrentWord(r.decisionCorrect[0] ? pick(CORRECT_WORDS) : pick(WRONG_WORDS));
            setCurrentWordCorrect(r.decisionCorrect[0]);
          } else {
            setCurrentShape(r.decisionCorrect[0] ? pick(SYM_SHAPES) : pick(ASYM_SHAPES));
            setCurrentShapeSym(r.decisionCorrect[0]);
          }
          setPhase("decision");
        }
      }, cfg.trialMs);
    } else {
      setCurrentDecision(nextDec);
      const r = updatedRounds[currentRound];
      if (type === "verbal") {
        setCurrentWord(r.decisionCorrect[nextDec] ? pick(CORRECT_WORDS) : pick(WRONG_WORDS));
        setCurrentWordCorrect(r.decisionCorrect[nextDec]);
      } else {
        setCurrentShape(r.decisionCorrect[nextDec] ? pick(SYM_SHAPES) : pick(ASYM_SHAPES));
        setCurrentShapeSym(r.decisionCorrect[nextDec]);
      }
    }
  }, [rounds, currentRound, currentDecision, cfg, type]);

  const handleRecall = useCallback((item: string | number) => {
    const updated = [...recallInput];
    updated[recallIdx] = item;
    setRecallInput(updated);
    const next = recallIdx + 1;
    if (next >= cfg.level) {
      // Score
      let correct = 0;
      rounds.forEach((r, i) => { if (updated[i] === r.itemToRemember) correct++; });
      const acc = (correct / cfg.level) * 100;
      const newLevel = acc >= cfg.threshAdvance ? cfg.level + 1
                     : acc < cfg.threshFallback && cfg.level > 1 ? cfg.level - 1
                     : cfg.level;
      setScore({ correct, total: cfg.level });
      setCfg(c => ({ ...c, level: newLevel }));
      setPhase("result");
    } else {
      setRecallIdx(next);
    }
  }, [recallInput, recallIdx, cfg, rounds]);

  return (
    <div className="max-w-lg mx-auto py-4">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/athena"><button className="opacity-40 hover:opacity-80 transition-opacity"><ArrowLeft className="w-4 h-4" style={{ color: accent }} /></button></Link>
        <div className="flex-1">
          <h1 className="text-sm font-semibold tracking-widest uppercase" style={{ fontFamily: "'Cinzel', serif", color: accent }}>Complex Working Memory</h1>
          <p className="text-[10px]" style={{ color: "hsl(214 20% 40%)", fontFamily: "DM Mono, monospace" }}>Level {cfg.level} · {type}</p>
        </div>
        <button onClick={() => setShowSettings(s => !s)} className="opacity-40 hover:opacity-80 transition-opacity"><Settings2 className="w-4 h-4" style={{ color: accent }} /></button>
      </div>

      {/* Type selector */}
      {phase === "idle" && (
        <div className="flex gap-2 mb-4">
          {(["verbal", "spatial"] as GameType[]).map(t => (
            <button key={t} onClick={() => setType(t)}
              className="flex-1 py-2 rounded-lg text-[11px] font-semibold tracking-widest uppercase transition-all"
              style={{ background: type === t ? `${accent}20` : "hsl(222 20% 5%)", border: `1px solid ${type === t ? accent : "hsl(43 15% 14%)"}`, color: type === t ? accent : "hsl(214 20% 45%)", fontFamily: "'Cinzel', serif" }}>
              {t}
            </button>
          ))}
        </div>
      )}

      {/* Settings */}
      {showSettings && (
        <div className="mb-5 p-4 rounded-xl border space-y-3" style={{ background: "hsl(222 20% 5%)", borderColor: `${accent}25` }}>
          {([
            { label: "Level (items to recall)", key: "level", min: 1, max: 12, step: 1 },
            { label: "Decisions per round", key: "decisionsPerRound", min: 2, max: 8, step: 1 },
            { label: "Memorize time (ms)", key: "trialMs", min: 800, max: 3000, step: 200 },
            { label: "Advance threshold %", key: "threshAdvance", min: 60, max: 95, step: 5 },
            { label: "Fallback threshold %", key: "threshFallback", min: 30, max: 65, step: 5 },
          ] as const).map(({ label, key, min, max, step }) => (
            <div key={key} className="flex items-center justify-between gap-4">
              <label className="text-[11px]" style={{ color: "hsl(214 20% 50%)", fontFamily: "DM Mono, monospace" }}>{label}</label>
              <div className="flex items-center gap-2">
                <input type="range" min={min} max={max} step={step} value={(cfg as any)[key]}
                  onChange={e => setCfg(c => ({ ...c, [key]: Number(e.target.value) }))}
                  className="w-24" style={{ accentColor: accent }} />
                <span className="text-[11px] w-8 text-right tabular-nums" style={{ color: accent }}>{(cfg as any)[key]}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* IDLE */}
      {phase === "idle" && (
        <div className="mb-5 p-4 rounded-xl border text-[11px] leading-relaxed space-y-2" style={{ background: "hsl(222 20% 4%)", borderColor: "hsl(43 15% 12%)", color: "hsl(214 20% 50%)" }}>
          {type === "verbal"
            ? <p>Each round: decide if a word is <strong style={{ color: accent }}>spelled correctly</strong>, then remember the <strong style={{ color: accent }}>letter</strong> shown. After all rounds, recall all letters in order.</p>
            : <p>Each round: decide if a shape is <strong style={{ color: accent }}>Y-axis symmetric</strong>, then remember the <strong style={{ color: accent }}>highlighted grid cell</strong>. After all rounds, tap all cells in order.</p>}
        </div>
      )}

      {/* DECISION */}
      {phase === "decision" && (
        <div className="text-center space-y-6">
          <p className="text-[10px] tracking-widest uppercase" style={{ color: "hsl(214 20% 36%)", fontFamily: "DM Mono, monospace" }}>
            Round {currentRound + 1}/{cfg.level} · Decision {currentDecision + 1}/{cfg.decisionsPerRound}
          </p>
          {type === "verbal" ? (
            <p className="text-4xl font-bold" style={{ fontFamily: "'Cinzel', serif", color: accent, letterSpacing: "0.08em" }}>{currentWord}</p>
          ) : (
            <svg viewBox="0 0 20 20" className="w-40 h-40 mx-auto" style={{ filter: `drop-shadow(0 0 8px ${accent}60)` }}>
              <path d={currentShape} fill={accent} fillOpacity={0.8} />
            </svg>
          )}
          <div className="flex gap-3">
            {["Yes", "No"].map(ans => (
              <button key={ans} onClick={() => handleDecision(ans === "Yes")}
                className="flex-1 py-3 rounded-xl text-[12px] font-semibold tracking-widest uppercase transition-all active:scale-95"
                style={{ background: `${accent}12`, border: `1px solid ${accent}35`, color: accent, fontFamily: "'Cinzel', serif" }}>
                {ans}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* MEMORIZE */}
      {phase === "memorize" && currentMemItem !== null && (
        <div className="text-center space-y-4 py-8">
          <p className="text-[10px] tracking-widest uppercase" style={{ color: "hsl(214 20% 36%)", fontFamily: "DM Mono, monospace" }}>Remember this</p>
          {type === "verbal" ? (
            <p className="text-7xl font-bold" style={{ fontFamily: "'Cinzel', serif", color: accent, filter: `drop-shadow(0 0 20px ${accent})` }}>{currentMemItem}</p>
          ) : (
            <div className="grid mx-auto" style={{ display: "grid", gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`, width: 200, height: 200, gap: 4 }}>
              {Array.from({ length: GRID_CELLS }).map((_, i) => (
                <div key={i} className="rounded" style={{ background: i === currentMemItem ? accent : "hsl(222 20% 10%)", border: `1px solid ${i === currentMemItem ? accent : "hsl(43 15% 14%)"}`, boxShadow: i === currentMemItem ? `0 0 12px ${accent}` : "none" }} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* MEMORIZE — blank transition */}
      {phase === "memorize" && currentMemItem === null && (
        <div className="text-center py-16">
          <div className="text-[10px] tracking-widest uppercase animate-pulse" style={{ color: "hsl(214 20% 30%)", fontFamily: "DM Mono, monospace" }}>…</div>
        </div>
      )}

      {/* RECALL */}
      {phase === "recall" && (
        <div className="space-y-4">
          <p className="text-[10px] tracking-widest uppercase text-center" style={{ color: "hsl(214 20% 40%)", fontFamily: "DM Mono, monospace" }}>
            Recall item {recallIdx + 1} of {cfg.level}
          </p>
          {/* Show what's been recalled */}
          <div className="flex gap-2 flex-wrap justify-center mb-2">
            {recallInput.map((item, i) => (
              <span key={i} className="px-2 py-1 rounded text-[11px]" style={{ background: i < recallIdx ? `${accent}20` : "hsl(222 20% 8%)", border: `1px solid ${i < recallIdx ? accent : "hsl(43 15% 14%)"}`, color: i < recallIdx ? accent : "hsl(214 20% 35%)" }}>
                {item !== null ? (type === "verbal" ? item : `Cell ${item}`) : "?"}
              </span>
            ))}
          </div>
          {type === "verbal" ? (
            <div className="flex flex-wrap gap-2 justify-center">
              {LETTERS_POOL.map(l => (
                <button key={l} onClick={() => handleRecall(l)}
                  className="w-10 h-10 rounded-lg text-sm font-bold transition-all active:scale-90"
                  style={{ background: "hsl(222 20% 8%)", border: `1px solid hsl(43 15% 14%)`, color: "hsl(46 45% 70%)", fontFamily: "'Cinzel', serif" }}>
                  {l}
                </button>
              ))}
            </div>
          ) : (
            <div className="grid mx-auto" style={{ display: "grid", gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`, width: 220, height: 220, gap: 5 }}>
              {Array.from({ length: GRID_CELLS }).map((_, i) => (
                <button key={i} onClick={() => handleRecall(i)}
                  className="rounded transition-all active:scale-90"
                  style={{ background: "hsl(222 20% 9%)", border: `1px solid hsl(43 15% 16%)` }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = `${accent}30`; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "hsl(222 20% 9%)"; }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* RESULT */}
      {phase === "result" && (
        <div className="mb-6 p-5 rounded-xl border text-center space-y-4" style={{ background: "hsl(222 20% 5%)", borderColor: `${accent}30` }}>
          <p className="text-[11px] tracking-widest uppercase" style={{ fontFamily: "'Cinzel', serif", color: "hsl(214 20% 45%)" }}>Recall Complete</p>
          <p className="text-4xl font-bold" style={{ color: accent, fontFamily: "'Cinzel', serif" }}>{score.correct}/{score.total}</p>
          <p className="text-[11px]" style={{ color: "hsl(214 20% 45%)", fontFamily: "DM Mono, monospace" }}>
            Next level: <span style={{ color: accent }}>{cfg.level}</span>
          </p>
        </div>
      )}

      {phase === "idle" || phase === "result" ? (
        <button onClick={startSession}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[12px] font-semibold tracking-widest uppercase transition-all"
          style={{ background: `${accent}15`, border: `1px solid ${accent}40`, color: accent, fontFamily: "'Cinzel', serif" }}>
          {phase === "result" ? <RotateCcw className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          {phase === "result" ? "Run Again" : "Begin Trial"}
        </button>
      ) : null}
    </div>
  );
}
