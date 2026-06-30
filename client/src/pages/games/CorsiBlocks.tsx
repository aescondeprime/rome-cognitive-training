/**
 * Corsi Block Tapping
 * 9 randomized blocks on a canvas. A sequence of blocks lights up one by one.
 * Player clicks them in the same order (Classic) or reverse (Reverse).
 * Sticky variants keep the block lit until the sequence ends.
 * Adaptive span length.
 */
import { useState, useCallback, useRef, useEffect } from "react";
import { ArrowLeft, Settings2, Play, RotateCcw } from "lucide-react";
import { Link } from "wouter";

type Variant = "Classic" | "Reverse" | "Sticky Classic" | "Sticky Reverse";

interface Block { id: number; x: number; y: number; }

// 9 fixed block positions (percent of container, shuffled looking layout)
const BASE_BLOCKS: Omit<Block, "id">[] = [
  { x: 12, y: 15 }, { x: 55, y: 10 }, { x: 82, y: 22 },
  { x: 28, y: 45 }, { x: 70, y: 40 }, { x: 15, y: 68 },
  { x: 50, y: 62 }, { x: 80, y: 70 }, { x: 38, y: 82 },
];
const BLOCKS: Block[] = BASE_BLOCKS.map((b, i) => ({ ...b, id: i }));

const BLOCK_SIZE = 48; // px

interface Config {
  level: number;
  rounds: number;
  litMs: number;
  variant: Variant;
  threshAdvance: number;
  threshFallback: number;
}
const DEFAULT_CONFIG: Config = {
  level: 5, rounds: 4, litMs: 600, variant: "Classic",
  threshAdvance: 80, threshFallback: 50,
};

type Phase = "idle" | "showing" | "input" | "feedback" | "result";
const accent = "hsl(165 55% 48%)";

export default function CorsiBlocks() {
  const [cfg, setCfg] = useState<Config>(DEFAULT_CONFIG);
  const [showSettings, setShowSettings] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");

  const [sequence, setSequence] = useState<number[]>([]);
  const [litId, setLitId] = useState<number | null>(null);
  const [stickyLit, setStickyLit] = useState<Set<number>>(new Set());
  const [playerSeq, setPlayerSeq] = useState<number[]>([]);
  const [round, setRound] = useState(0);
  const [roundResults, setRoundResults] = useState<boolean[]>([]);
  const [containerWidth, setContainerWidth] = useState(320);
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const observe = () => {
      if (containerRef.current) setContainerWidth(containerRef.current.offsetWidth);
    };
    observe();
    const ro = new ResizeObserver(observe);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const clearTimers = () => { if (timerRef.current) clearTimeout(timerRef.current); };

  const generateSequence = useCallback((level: number): number[] => {
    const seq: number[] = [];
    for (let i = 0; i < level; i++) {
      let next: number;
      do { next = Math.floor(Math.random() * BLOCKS.length); } while (seq[seq.length - 1] === next);
      seq.push(next);
    }
    return seq;
  }, []);

  const showSequence = useCallback((seq: number[], variant: Variant) => {
    setPhase("showing");
    setStickyLit(new Set());
    const isSticky = variant.includes("Sticky");
    const gap = cfg.litMs + 200;

    seq.forEach((blockId, i) => {
      timerRef.current = setTimeout(() => {
        setLitId(blockId);
        if (isSticky) setStickyLit(prev => new Set([...prev, blockId]));
        timerRef.current = setTimeout(() => {
          if (!isSticky) setLitId(null);
          if (i === seq.length - 1) {
            setTimeout(() => {
              setLitId(null);
              setStickyLit(new Set());
              setPlayerSeq([]);
              setPhase("input");
            }, 300);
          }
        }, cfg.litMs);
      }, i * gap);
    });
  }, [cfg.litMs]);

  const startRound = useCallback((roundIdx: number, level: number) => {
    const seq = generateSequence(level);
    setSequence(seq);
    setRound(roundIdx);
    setTimeout(() => showSequence(seq, cfg.variant), 500);
  }, [generateSequence, showSequence, cfg.variant]);

  const startSession = useCallback(() => {
    clearTimers();
    setRoundResults([]);
    setRound(0);
    startRound(0, cfg.level);
  }, [cfg.level, startRound]);

  const handleBlockClick = useCallback((blockId: number) => {
    if (phase !== "input") return;
    const isReverse = cfg.variant.includes("Reverse");
    const expected = isReverse ? [...sequence].reverse() : sequence;
    const newSeq = [...playerSeq, blockId];
    setPlayerSeq(newSeq);

    if (newSeq.length === sequence.length) {
      const correct = newSeq.every((id, i) => id === expected[i]);
      const newResults = [...roundResults, correct];
      setRoundResults(newResults);
      setPhase("feedback");
      timerRef.current = setTimeout(() => {
        const nextRound = round + 1;
        if (nextRound >= cfg.rounds) {
          const hits = newResults.filter(Boolean).length;
          const acc = (hits / cfg.rounds) * 100;
          const newLevel = acc >= cfg.threshAdvance && cfg.level < 20 ? cfg.level + 1
                         : acc < cfg.threshFallback && cfg.level > 1 ? cfg.level - 1
                         : cfg.level;
          setCfg(c => ({ ...c, level: newLevel }));
          setPhase("result");
        } else {
          startRound(nextRound, cfg.level);
        }
      }, 900);
    }
  }, [phase, cfg, sequence, playerSeq, roundResults, round, startRound]);

  const lastCorrect = roundResults[roundResults.length - 1];
  const cw = containerWidth;
  const ch = Math.round(cw * 0.75);

  return (
    <div className="max-w-lg mx-auto py-4">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/athena"><button className="opacity-40 hover:opacity-80 transition-opacity"><ArrowLeft className="w-4 h-4" style={{ color: accent }} /></button></Link>
        <div className="flex-1">
          <h1 className="text-sm font-semibold tracking-widest uppercase" style={{ fontFamily: "'Cinzel', serif", color: accent }}>Corsi Blocks</h1>
          <p className="text-[10px]" style={{ color: "hsl(214 20% 40%)", fontFamily: "DM Mono, monospace" }}>Span {cfg.level} · {cfg.variant} · {cfg.rounds} rounds</p>
        </div>
        <button onClick={() => setShowSettings(s => !s)} className="opacity-40 hover:opacity-80 transition-opacity"><Settings2 className="w-4 h-4" style={{ color: accent }} /></button>
      </div>

      {/* Variant selector */}
      {phase === "idle" && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {(["Classic","Reverse","Sticky Classic","Sticky Reverse"] as Variant[]).map(v => (
            <button key={v} onClick={() => setCfg(c => ({ ...c, variant: v }))}
              className="px-2.5 py-1.5 rounded-lg text-[10px] font-semibold tracking-wide uppercase transition-all"
              style={{ background: cfg.variant === v ? `${accent}20` : "hsl(222 20% 5%)", border: `1px solid ${cfg.variant === v ? accent : "hsl(43 15% 14%)"}`, color: cfg.variant === v ? accent : "hsl(214 20% 45%)", fontFamily: "'Cinzel', serif" }}>
              {v}
            </button>
          ))}
        </div>
      )}

      {/* Settings */}
      {showSettings && (
        <div className="mb-5 p-4 rounded-xl border space-y-3" style={{ background: "hsl(222 20% 5%)", borderColor: `${accent}25` }}>
          {([
            { label: "Span Length (Level)", key: "level" as const, min: 2, max: 20, step: 1 },
            { label: "Rounds", key: "rounds" as const, min: 2, max: 10, step: 1 },
            { label: "Lit Time (ms)", key: "litMs" as const, min: 300, max: 1500, step: 100 },
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
          <p>Blocks will light up one by one. Tap them in the <strong style={{ color: accent }}>{cfg.variant.includes("Reverse") ? "reverse" : "same"}</strong> order. Span adapts to your accuracy.</p>
        </div>
      )}

      {/* Block grid */}
      {(phase === "showing" || phase === "input" || phase === "feedback") && (
        <div ref={containerRef} className="relative rounded-xl mb-4 overflow-hidden"
          style={{ width: "100%", height: ch, background: "hsl(222 20% 5%)", border: "1px solid hsl(43 15% 12%)" }}>
          {BLOCKS.map(b => {
            const isLit = litId === b.id || stickyLit.has(b.id);
            const isClicked = phase === "input" && playerSeq.includes(b.id);
            const px = (b.x / 100) * cw - BLOCK_SIZE / 2;
            const py = (b.y / 100) * ch - BLOCK_SIZE / 2;
            return (
              <button key={b.id}
                onClick={() => handleBlockClick(b.id)}
                className="absolute rounded-lg transition-all duration-150"
                style={{
                  left: px, top: py, width: BLOCK_SIZE, height: BLOCK_SIZE,
                  background: isLit ? accent : isClicked ? `${accent}50` : "hsl(222 20% 10%)",
                  border: `1px solid ${isLit ? accent : "hsl(43 15% 18%)"}`,
                  boxShadow: isLit ? `0 0 20px ${accent}80` : "none",
                  cursor: phase === "input" ? "pointer" : "default",
                  transform: isLit ? "scale(1.08)" : "scale(1)",
                }}
              />
            );
          })}

          {/* Status overlay */}
          {phase === "showing" && (
            <div className="absolute inset-x-0 bottom-2 flex justify-center">
              <span className="text-[10px] tracking-widest uppercase px-3 py-1 rounded-full" style={{ background: "hsl(222 20% 4% / 0.8)", color: "hsl(214 20% 45%)", fontFamily: "DM Mono, monospace" }}>Watch…</span>
            </div>
          )}
          {phase === "input" && (
            <div className="absolute inset-x-0 bottom-2 flex justify-center">
              <span className="text-[10px] tracking-widest uppercase px-3 py-1 rounded-full" style={{ background: "hsl(222 20% 4% / 0.8)", color: accent, fontFamily: "DM Mono, monospace" }}>
                Tap {playerSeq.length + 1}/{sequence.length}
              </span>
            </div>
          )}
          {phase === "feedback" && (
            <div className="absolute inset-0 flex items-center justify-center rounded-xl" style={{ background: "hsl(222 20% 4% / 0.6)" }}>
              <span className="text-4xl">{lastCorrect ? "✓" : "✗"}</span>
            </div>
          )}
        </div>
      )}

      {/* Round dots */}
      {(phase === "showing" || phase === "input" || phase === "feedback") && (
        <div className="flex gap-1.5 justify-center mb-4">
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
          <p className="text-[11px] tracking-widest uppercase" style={{ fontFamily: "'Cinzel', serif", color: "hsl(214 20% 45%)" }}>Round Complete</p>
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
