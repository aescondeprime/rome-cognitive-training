/**
 * Memory Span
 *
 * Digits or letters flash one at a time; you give them back in order, reversed,
 * or sorted.
 *
 * **The bug this rewrite exists for.** `showSequence` scheduled one `setTimeout`
 * per item but stored them all in a single `timerRef`, so only the last one was
 * ever cancellable. When a round ended — or the span changed, or you left and
 * came back — the earlier timeouts kept firing into the *next* round: items from
 * the round you had already finished appeared during the new one, and the
 * `sequence` state they raced against was no longer the sequence your answer was
 * being graded on, so correct answers were marked wrong. Every timeout is now
 * tagged with a generation counter and dropped if the generation has moved on,
 * and the whole timer list is cleared on start, unmount and round change.
 *
 * The tap pad also has a keyboard now — typing a digit or letter enters it,
 * Backspace takes one back.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Delete } from "lucide-react";
import GameShell, { type Setting } from "@/components/games/GameShell";
import {
  MONO, SERIF, alpha, useGameConfig, useGameKeys, useScaled,
  type GameProps,
} from "@/lib/gameKit";
import { recordDrillResultInBackground } from "@/lib/trainingRecorder";

type SpanType = "Digit" | "DigitReverse" | "DigitSorted" | "Letter" | "LetterReverse" | "LetterSorted";
const TYPES: SpanType[] = ["Digit", "DigitReverse", "DigitSorted", "Letter", "LetterReverse", "LetterSorted"];

const DIGIT_POOL = "123456789".split("");
const LETTER_POOL = "BCDFGHJKLMNPQRSTVWXZ".split("");

const accent = "hsl(35 90% 62%)";

function poolFor(type: SpanType) { return type.startsWith("Letter") ? LETTER_POOL : DIGIT_POOL; }

function genSequence(level: number, type: SpanType): string[] {
  const pool = poolFor(type);
  const seq: string[] = [];
  for (let i = 0; i < level; i++) {
    let c = pool[Math.floor(Math.random() * pool.length)];
    while (c === seq[seq.length - 1]) c = pool[Math.floor(Math.random() * pool.length)];
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
  gapMs: number;
  type: SpanType;
  threshAdvance: number;
  threshFallback: number;
}

const DEFAULTS: Config = {
  level: 5, rounds: 4, litMs: 800, gapMs: 250, type: "Digit",
  threshAdvance: 80, threshFallback: 50,
};

type Phase = "idle" | "showing" | "input" | "feedback" | "result";

export default function MemorySpan({ embedded, autoStart, onSessionComplete }: GameProps) {
  const [cfg, setCfg] = useGameConfig<Config>("memory-span", DEFAULTS);
  const px = useScaled();

  const [phase, setPhase] = useState<Phase>("idle");
  const [sequence, setSequence] = useState<string[]>([]);
  const [shownIdx, setShownIdx] = useState(-1);
  const [playerInput, setPlayerInput] = useState<string[]>([]);
  const [round, setRound] = useState(0);
  const [roundResults, setRoundResults] = useState<boolean[]>([]);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const gen = useRef(0);
  const startedAt = useRef(0);
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const later = (fn: () => void, ms: number) => { timers.current.push(setTimeout(fn, ms)); };
  useEffect(() => () => { gen.current += 1; clearTimers(); }, []);

  const showSequence = useCallback((seq: string[], myGen: number) => {
    setPhase("showing");
    setShownIdx(-1);
    const step = cfg.litMs + cfg.gapMs;
    seq.forEach((_, i) => {
      later(() => { if (myGen === gen.current) setShownIdx(i); }, i * step);
      later(() => { if (myGen === gen.current) setShownIdx(-1); }, i * step + cfg.litMs);
    });
    later(() => {
      if (myGen !== gen.current) return;
      setPlayerInput([]);
      setPhase("input");
    }, seq.length * step + 300);
  }, [cfg.litMs, cfg.gapMs]);

  const startRound = useCallback((roundIdx: number, level: number, myGen: number) => {
    const seq = genSequence(level, cfg.type);
    setSequence(seq);
    setRound(roundIdx);
    setPlayerInput([]);
    later(() => { if (myGen === gen.current) showSequence(seq, myGen); }, 450);
  }, [cfg.type, showSequence]);

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

  const handleInput = useCallback((item: string) => {
    if (phase !== "input") return;
    const next = [...playerInput, item];
    setPlayerInput(next);
    if (next.length < sequence.length) return;

    const expected = expectedAnswer(sequence, cfg.type);
    const correct = next.every((c, i) => c === expected[i]);
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
      const newLevel = acc >= cfg.threshAdvance && cfg.level < 30 ? cfg.level + 1
        : acc < cfg.threshFallback && cfg.level > 2 ? cfg.level - 1
        : cfg.level;
      setCfg(c => ({ ...c, level: newLevel }));
      setPhase("result");
      recordDrillResultInBackground({
        domain: "recall", activityId: "memory-span",
        correct: hits, total: cfg.rounds, level: cfg.level, maxLevel: 30,
        startedAt: startedAt.current,
      });
      onSessionComplete?.({ correct: hits, total: cfg.rounds, level: newLevel });
    }, 950);
  }, [phase, playerInput, sequence, cfg, roundResults, round, startRound, setCfg, onSessionComplete]);

  const backspace = useCallback(() => {
    if (phase !== "input") return;
    setPlayerInput(p => p.slice(0, -1));
  }, [phase]);

  const pool = poolFor(cfg.type);
  useGameKeys(
    pool.map(c => c.toLowerCase()),
    k => handleInput(k.toUpperCase()),
    phase === "input",
  );
  useGameKeys(["Backspace"], backspace, phase === "input");

  const settings: Setting[] = [
    { kind: "select", key: "type", label: "Variant", options: TYPES.map(t => ({ value: t, label: t })) },
    { kind: "range", key: "level", label: "Span length", min: 2, max: 30 },
    { kind: "range", key: "rounds", label: "Rounds", min: 2, max: 10 },
    { kind: "range", key: "litMs", label: "Display time", min: 200, max: 3000, step: 50, format: v => `${v}ms` },
    { kind: "range", key: "gapMs", label: "Gap", min: 50, max: 1500, step: 50, format: v => `${v}ms` },
    { kind: "range", key: "threshAdvance", label: "Advance at %", min: 60, max: 95, step: 5 },
    { kind: "range", key: "threshFallback", label: "Fall back below %", min: 30, max: 65, step: 5 },
  ];

  const active = phase === "showing" || phase === "input" || phase === "feedback";
  const shownItem = shownIdx >= 0 ? sequence[shownIdx] : null;
  const expectedSeq = phase === "feedback" ? expectedAnswer(sequence, cfg.type) : [];

  return (
    <GameShell
      title="Memory Span" accent={accent} embedded={embedded}
      subtitle={`Span ${cfg.level} · ${cfg.type} · ${cfg.rounds} rounds`}
      phase={phase === "idle" ? "idle" : phase === "result" ? "result" : "running"}
      onStart={startSession} settings={settings} cfg={cfg} setCfg={setCfg}
      variants={
        <div className="flex flex-wrap" style={{ gap: px(6) }}>
          {TYPES.map(t => (
            <button key={t} onClick={() => setCfg(c => ({ ...c, type: t }))}
              className="rounded-lg font-semibold tracking-wide uppercase transition-all"
              style={{
                padding: `${px(6)}px ${px(10)}px`, fontSize: px(10), fontFamily: SERIF,
                background: cfg.type === t ? alpha(accent, 0.2) : "hsl(222 20% 5%)",
                border: `1px solid ${cfg.type === t ? accent : "hsl(var(--accent-h) 15% 14%)"}`,
                color: cfg.type === t ? accent : "hsl(214 20% 45%)",
              }}>{t}</button>
          ))}
        </div>
      }
      instructions={
        <p>
          A sequence flashes one item at a time. Give it back{" "}
          <strong style={{ color: accent }}>
            {cfg.type.includes("Reverse") ? "in reverse" : cfg.type.includes("Sorted") ? "sorted" : "in the same order"}
          </strong>{" "}
          — type it or tap the pad. Span grows as you improve.
        </p>
      }
    >
      {phase === "showing" && (
        <div className="text-center">
          <div style={{
            fontFamily: SERIF, fontWeight: 700, fontSize: px(110), lineHeight: 1,
            minHeight: px(120), transition: "all 0.12s ease",
            color: shownItem ? accent : "transparent",
            filter: shownItem ? `drop-shadow(0 0 ${px(26)}px ${accent})` : "none",
          }}>
            {shownItem ?? "·"}
          </div>
          <p style={{ color: "hsl(214 20% 36%)", fontFamily: MONO, fontSize: px(10), marginTop: px(14), letterSpacing: "0.15em" }}>
            {Math.max(shownIdx + 1, 0)} / {sequence.length}
          </p>
        </div>
      )}

      {(phase === "input" || phase === "feedback") && (
        <div className="flex flex-col items-center w-full" style={{ gap: px(16) }}>
          <div className="flex flex-wrap justify-center" style={{ gap: px(6) }}>
            {Array.from({ length: sequence.length }).map((_, i) => {
              const val = playerInput[i];
              const ok = phase === "feedback" && val !== undefined ? val === expectedSeq[i] : null;
              return (
                <span key={i} className="flex items-center justify-center rounded-lg font-bold"
                  style={{
                    width: px(38), height: px(38), fontSize: px(17), fontFamily: SERIF,
                    background: phase === "feedback"
                      ? (ok ? "hsl(130 40% 15%)" : "hsl(0 40% 15%)")
                      : val ? alpha(accent, 0.2) : "hsl(222 20% 8%)",
                    border: `1px solid ${phase === "feedback" ? (ok ? "hsl(130 60% 40%)" : "hsl(0 60% 40%)") : val ? accent : "hsl(var(--accent-h) 15% 16%)"}`,
                    color: phase === "feedback" ? (ok ? "hsl(130 60% 60%)" : "hsl(0 60% 60%)") : val ? accent : "hsl(214 20% 30%)",
                  }}>
                  {phase === "feedback" ? (val ?? "—") : (val ?? "")}
                </span>
              );
            })}
          </div>

          {phase === "feedback" && (
            <p style={{ color: "hsl(214 20% 42%)", fontFamily: MONO, fontSize: px(11) }}>
              Expected: {expectedSeq.join(" ")}
            </p>
          )}

          {phase === "input" && (
            <div className="flex flex-wrap justify-center" style={{ gap: px(7), maxWidth: px(460) }}>
              {pool.map(item => (
                <button key={item} onClick={() => handleInput(item)}
                  className="rounded-lg font-bold transition-all active:scale-90"
                  style={{
                    width: px(44), height: px(44), fontSize: px(15), fontFamily: SERIF,
                    background: "hsl(222 20% 8%)", border: "1px solid hsl(var(--accent-h) 15% 16%)",
                    color: "hsl(46 45% 70%)",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.color = accent; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "hsl(var(--accent-h) 15% 16%)"; e.currentTarget.style.color = "hsl(46 45% 70%)"; }}>
                  {item}
                </button>
              ))}
              <button onClick={backspace}
                className="rounded-lg flex items-center justify-center transition-all active:scale-90"
                style={{
                  width: px(44), height: px(44),
                  background: "hsl(222 20% 8%)", border: "1px solid hsl(var(--accent-h) 15% 16%)", color: "hsl(214 20% 45%)",
                }}>
                <Delete style={{ width: px(16), height: px(16) }} />
              </button>
            </div>
          )}
        </div>
      )}

      {active && (
        <div className="flex justify-center" style={{ gap: px(6), marginTop: px(18) }}>
          {Array.from({ length: cfg.rounds }).map((_, i) => (
            <div key={i} className="rounded-full" style={{
              width: px(8), height: px(8),
              background: i < roundResults.length
                ? roundResults[i] ? "hsl(130 60% 50%)" : "hsl(0 60% 50%)"
                : i === round ? accent : "hsl(222 20% 14%)",
            }} />
          ))}
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
