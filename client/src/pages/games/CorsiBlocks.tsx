/**
 * Corsi Block Tapping
 *
 * Blocks light up one at a time; you tap them back in the same order, in
 * reverse, or with the lit ones staying lit (the "sticky" variants).
 *
 * Two fixes over the first version:
 *
 * - **The board is re-scattered every round.** It used to be one hard-coded
 *   arrangement for all time, which turns a spatial-memory task into a verbal
 *   one: after a few rounds you stop remembering *where* and start remembering
 *   "top-left, middle, far-right". Fresh positions each round put the spatial
 *   load back. (There is a setting to pin the layout if you want the old
 *   behaviour for a like-for-like comparison.)
 *
 * - **Timers are generation-tagged.** The old code kept one `timerRef` while
 *   scheduling one timeout per item, so `clearTimeout` only ever cancelled the
 *   last of them and a round that ended early left its stragglers firing into
 *   the next round.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import GameShell, { type Setting } from "@/components/games/GameShell";
import {
  MONO, SERIF, alpha, randInt, useGameConfig, useGameSize, useScaled,
  type GameProps,
} from "@/lib/gameKit";
import { recordDrillResultInBackground } from "@/lib/trainingRecorder";

type Variant = "Classic" | "Reverse" | "Sticky Classic" | "Sticky Reverse";
const VARIANTS: Variant[] = ["Classic", "Reverse", "Sticky Classic", "Sticky Reverse"];

interface Point { x: number; y: number }

const accent = "hsl(165 55% 48%)";
const BOARD_ASPECT = 0.72;

/**
 * Poisson-ish scatter: reject candidates that land too close to an existing
 * block, measuring in width-percent so the spacing looks even despite the
 * board being wider than it is tall.
 */
function generateLayout(count: number): Point[] {
  const pts: Point[] = [];
  const minDist = Math.max(14, 46 / Math.sqrt(count));
  for (let guard = 0; pts.length < count && guard < 6000; guard++) {
    const p = { x: 9 + Math.random() * 82, y: 9 + Math.random() * 82 };
    if (pts.every(q => Math.hypot(q.x - p.x, (q.y - p.y) * BOARD_ASPECT) > minDist)) pts.push(p);
  }
  while (pts.length < count) pts.push({ x: 9 + Math.random() * 82, y: 9 + Math.random() * 82 });
  return pts;
}

interface Config {
  level: number;
  rounds: number;
  blocks: number;
  litMs: number;
  variant: Variant;
  shuffleLayout: boolean;
  threshAdvance: number;
  threshFallback: number;
}

const DEFAULTS: Config = {
  level: 5, rounds: 4, blocks: 9, litMs: 600, variant: "Classic",
  shuffleLayout: true, threshAdvance: 80, threshFallback: 50,
};

type Phase = "idle" | "showing" | "input" | "feedback" | "result";

export default function CorsiBlocks({ embedded, autoStart, onSessionComplete }: GameProps) {
  const [cfg, setCfg] = useGameConfig<Config>("corsi", DEFAULTS);
  const px = useScaled();
  const { width: panelW, height: panelH } = useGameSize();

  const [phase, setPhase] = useState<Phase>("idle");
  const [layout, setLayout] = useState<Point[]>(() => generateLayout(DEFAULTS.blocks));
  const [sequence, setSequence] = useState<number[]>([]);
  const [litId, setLitId] = useState<number | null>(null);
  const [stickyLit, setStickyLit] = useState<Set<number>>(new Set());
  const [playerSeq, setPlayerSeq] = useState<number[]>([]);
  const [round, setRound] = useState(0);
  const [roundResults, setRoundResults] = useState<boolean[]>([]);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const gen = useRef(0);
  const startedAt = useRef(0);

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const later = (fn: () => void, ms: number) => { timers.current.push(setTimeout(fn, ms)); };

  useEffect(() => () => { gen.current += 1; clearTimers(); }, []);

  const showSequence = useCallback((seq: number[], variant: Variant, myGen: number) => {
    setPhase("showing");
    setStickyLit(new Set());
    const sticky = variant.includes("Sticky");
    const gap = cfg.litMs + 220;

    seq.forEach((blockId, i) => {
      later(() => {
        if (myGen !== gen.current) return;
        setLitId(blockId);
        if (sticky) setStickyLit(prev => new Set([...Array.from(prev), blockId]));
      }, i * gap);
      later(() => {
        if (myGen !== gen.current) return;
        if (!sticky) setLitId(null);
      }, i * gap + cfg.litMs);
    });

    later(() => {
      if (myGen !== gen.current) return;
      setLitId(null);
      setStickyLit(new Set());
      setPlayerSeq([]);
      setPhase("input");
    }, seq.length * gap + 250);
  }, [cfg.litMs]);

  const startRound = useCallback((roundIdx: number, level: number, myGen: number) => {
    const blocks = cfg.blocks;
    const seq: number[] = [];
    for (let i = 0; i < level; i++) {
      let next = randInt(blocks);
      while (seq.length && seq[seq.length - 1] === next) next = randInt(blocks);
      seq.push(next);
    }
    if (cfg.shuffleLayout || roundIdx === 0) setLayout(generateLayout(blocks));
    setSequence(seq);
    setRound(roundIdx);
    later(() => { if (myGen === gen.current) showSequence(seq, cfg.variant, myGen); }, 550);
  }, [cfg.blocks, cfg.shuffleLayout, cfg.variant, showSequence]);

  const startSession = useCallback(() => {
    gen.current += 1;
    clearTimers();
    startedAt.current = Date.now();
    setRoundResults([]);
    setRound(0);
    startRound(0, cfg.level, gen.current);
  }, [cfg.level, startRound]);

  const startRef = useRef(startSession);
  startRef.current = startSession;
  useEffect(() => { if (autoStart) startRef.current(); }, [autoStart]);

  const handleBlockClick = useCallback((blockId: number) => {
    if (phase !== "input") return;
    const expected = cfg.variant.includes("Reverse") ? [...sequence].reverse() : sequence;
    const next = [...playerSeq, blockId];
    setPlayerSeq(next);
    if (next.length < sequence.length) return;

    const correct = next.every((id, i) => id === expected[i]);
    const results = [...roundResults, correct];
    setRoundResults(results);
    setPhase("feedback");
    const myGen = gen.current;

    later(() => {
      if (myGen !== gen.current) return;
      const nextRound = round + 1;
      if (nextRound < cfg.rounds) { startRound(nextRound, cfg.level, myGen); return; }

      const hits = results.filter(Boolean).length;
      const acc = (hits / cfg.rounds) * 100;
      const newLevel = acc >= cfg.threshAdvance && cfg.level < 20 ? cfg.level + 1
        : acc < cfg.threshFallback && cfg.level > 2 ? cfg.level - 1
        : cfg.level;
      setCfg(c => ({ ...c, level: newLevel }));
      setPhase("result");
      recordDrillResultInBackground({
        domain: "working_memory", activityId: "corsi-blocks",
        correct: hits, total: cfg.rounds, level: cfg.level, maxLevel: 20,
        startedAt: startedAt.current,
      });
      onSessionComplete?.({ correct: hits, total: cfg.rounds, level: newLevel });
    }, 950);
  }, [phase, cfg, sequence, playerSeq, roundResults, round, startRound, setCfg, onSessionComplete]);

  const settings: Setting[] = [
    { kind: "range", key: "level", label: "Span length", min: 2, max: 20 },
    { kind: "range", key: "rounds", label: "Rounds", min: 2, max: 10 },
    { kind: "range", key: "blocks", label: "Blocks on board", min: 6, max: 16 },
    { kind: "range", key: "litMs", label: "Lit time", min: 200, max: 1500, step: 50, format: v => `${v}ms` },
    { kind: "toggle", key: "shuffleLayout", label: "Re-scatter each round" },
    { kind: "range", key: "threshAdvance", label: "Advance at %", min: 60, max: 95, step: 5 },
    { kind: "range", key: "threshFallback", label: "Fall back below %", min: 30, max: 65, step: 5 },
  ];

  const active = phase === "showing" || phase === "input" || phase === "feedback";
  const boardW = Math.max(160, Math.min(panelW - px(30), (panelH - px(190)) / BOARD_ASPECT, px(520)));
  const boardH = boardW * BOARD_ASPECT;
  const blockSize = Math.max(22, Math.min(boardW * 0.11, px(54)));
  const lastCorrect = roundResults[roundResults.length - 1];

  return (
    <GameShell
      title="Corsi Blocks" accent={accent} embedded={embedded}
      subtitle={`Span ${cfg.level} · ${cfg.variant} · ${cfg.rounds} rounds`}
      phase={phase === "result" ? "result" : phase === "idle" ? "idle" : "running"}
      onStart={startSession} settings={settings} cfg={cfg} setCfg={setCfg}
      variants={
        <div className="flex flex-wrap" style={{ gap: px(6) }}>
          {VARIANTS.map(v => (
            <button key={v} onClick={() => setCfg(c => ({ ...c, variant: v }))}
              className="rounded-lg font-semibold tracking-wide uppercase transition-all"
              style={{
                padding: `${px(6)}px ${px(10)}px`, fontSize: px(10), fontFamily: SERIF,
                background: cfg.variant === v ? alpha(accent, 0.20) : "hsl(222 20% 5%)",
                border: `1px solid ${cfg.variant === v ? accent : "hsl(var(--accent-h) 15% 14%)"}`,
                color: cfg.variant === v ? accent : "hsl(214 20% 45%)",
              }}>
              {v}
            </button>
          ))}
        </div>
      }
      instructions={
        <p>
          Blocks light up one by one. Tap them in the{" "}
          <strong style={{ color: accent }}>{cfg.variant.includes("Reverse") ? "reverse" : "same"}</strong> order.
          {cfg.shuffleLayout ? " The board is re-scattered every round, so position is the only thing worth remembering." : " The layout is pinned for this session."}
        </p>
      }
    >
      {active && (
        <div className="flex flex-col items-center" style={{ gap: px(12) }}>
          <div
            className="relative rounded-xl overflow-hidden"
            style={{
              width: boardW, height: boardH,
              background: "hsl(222 20% 5%)", border: "1px solid hsl(var(--accent-h) 15% 12%)",
            }}
          >
            {layout.slice(0, cfg.blocks).map((b, id) => {
              const lit = litId === id || stickyLit.has(id);
              const tapped = phase === "input" && playerSeq.includes(id);
              return (
                <button
                  key={id}
                  onClick={() => handleBlockClick(id)}
                  className="absolute rounded-lg"
                  style={{
                    left: (b.x / 100) * boardW - blockSize / 2,
                    top: (b.y / 100) * boardH - blockSize / 2,
                    width: blockSize, height: blockSize,
                    background: lit ? accent : tapped ? alpha(accent, 0.45) : "hsl(222 20% 10%)",
                    border: `1px solid ${lit ? accent : "hsl(var(--accent-h) 15% 18%)"}`,
                    boxShadow: lit ? `0 0 ${px(24)}px ${alpha(accent, 0.55)}` : "none",
                    cursor: phase === "input" ? "pointer" : "default",
                    transform: lit ? "scale(1.09)" : "scale(1)",
                    transition: "all 0.14s ease",
                  }}
                />
              );
            })}

            {phase === "showing" && (
              <div className="absolute inset-x-0 flex justify-center" style={{ bottom: px(8) }}>
                <span style={{
                  fontFamily: MONO, fontSize: px(10), letterSpacing: "0.15em", textTransform: "uppercase",
                  background: "hsl(222 20% 4% / 0.8)", color: "hsl(214 20% 45%)",
                  padding: `${px(3)}px ${px(10)}px`, borderRadius: 999,
                }}>Watch…</span>
              </div>
            )}
            {phase === "input" && (
              <div className="absolute inset-x-0 flex justify-center" style={{ bottom: px(8) }}>
                <span style={{
                  fontFamily: MONO, fontSize: px(10), letterSpacing: "0.15em", textTransform: "uppercase",
                  background: "hsl(222 20% 4% / 0.8)", color: accent,
                  padding: `${px(3)}px ${px(10)}px`, borderRadius: 999,
                }}>Tap {playerSeq.length + 1}/{sequence.length}</span>
              </div>
            )}
            {phase === "feedback" && (
              <div className="absolute inset-0 flex items-center justify-center" style={{ background: "hsl(222 20% 4% / 0.62)" }}>
                <span style={{ fontSize: px(44), color: lastCorrect ? "hsl(130 60% 55%)" : "hsl(0 60% 55%)" }}>
                  {lastCorrect ? "✓" : "✗"}
                </span>
              </div>
            )}
          </div>

          <div className="flex justify-center" style={{ gap: px(6) }}>
            {Array.from({ length: cfg.rounds }).map((_, i) => (
              <div key={i} className="rounded-full" style={{
                width: px(8), height: px(8),
                background: i < roundResults.length
                  ? roundResults[i] ? "hsl(130 60% 50%)" : "hsl(0 60% 50%)"
                  : i === round ? accent : "hsl(222 20% 14%)",
              }} />
            ))}
          </div>
        </div>
      )}

      {phase === "result" && (
        <div className="rounded-xl border text-center w-full"
          style={{ background: "hsl(222 20% 5%)", borderColor: alpha(accent, 0.3), padding: px(18), maxWidth: px(400) }}>
          <p style={{ fontFamily: SERIF, color: "hsl(214 20% 45%)", fontSize: px(11), letterSpacing: "0.15em", textTransform: "uppercase" }}>Session Complete</p>
          <p style={{ color: accent, fontFamily: SERIF, fontSize: px(38), fontWeight: 700, marginTop: px(10) }}>
            {roundResults.filter(Boolean).length}/{cfg.rounds}
          </p>
          <p style={{ color: "hsl(214 20% 45%)", fontFamily: MONO, fontSize: px(11), marginTop: px(8) }}>
            Next span: <span style={{ color: accent }}>{cfg.level}</span>
          </p>
        </div>
      )}
    </GameShell>
  );
}
