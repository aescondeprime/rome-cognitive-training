/**
 * Complex Working Memory
 *
 * The classic complex-span shape: a processing task you must keep answering
 * (is this word spelled right / is this shape symmetric about the vertical
 * axis) interleaved with items to hold, all recalled in order at the end.
 *
 * Changes from the first version:
 *
 * - **Keyboard answers.** Yes/No are bound to keys — A and L by default,
 *   rebindable, because the mouse round-trip was most of the response time and
 *   because the Arena needs two drills to be able to avoid each other's keys.
 * - **Recall by keyboard too** in the verbal variant: type the letter.
 * - **The processing task is scored**, not just performed. Answering the
 *   spelling questions at chance while nailing recall is not the same skill,
 *   and the result screen now says so.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import GameShell, { type Setting } from "@/components/games/GameShell";
import {
  MONO, SERIF, alpha, keyLabel, pick, randInt, useGameConfig, useGameKeys, useScaled,
  type GameProps,
} from "@/lib/gameKit";
import { recordDrillResultInBackground } from "@/lib/trainingRecorder";

const CORRECT_WORDS = ["brief","cloud","dream","earth","flame","grace","heart","light","magic","night","ocean","peace","quiet","river","storm","think","under","voice","water","world"];
const WRONG_WORDS   = ["breif","cluod","dreem","earht","flmae","graec","haert","lihgt","mgicc","nihgt","ocaen","paece","qiuet","rivir","strom","tinhk","undre","voiice","watre","wrold"];

const SYM_SHAPES  = ["M10,2 L18,10 L14,18 L10,14 L6,18 L2,10 Z", "M10,2 L18,10 L10,18 L2,10 Z", "M2,10 L10,2 L18,10 L10,18 Z", "M5,2 L15,2 L18,10 L15,18 L5,18 L2,10 Z"];
const ASYM_SHAPES = ["M2,2 L14,4 L18,14 L8,18 Z", "M2,6 L16,2 L18,16 L4,18 Z", "M2,2 L18,8 L14,18 L6,12 Z", "M4,2 L18,4 L16,18 L2,12 Z"];

const LETTERS_POOL = "BCDFGHJKLMNPQRSTVWXZ".split("");
const GRID_COLS = 4;
const GRID_CELLS = GRID_COLS * GRID_COLS;

const accent = "hsl(270 60% 65%)";

type GameType = "verbal" | "spatial";
type Phase = "idle" | "decision" | "memorize" | "recall" | "result";

interface Config {
  level: number;
  decisionsPerRound: number;
  trialMs: number;
  threshAdvance: number;
  threshFallback: number;
  type: GameType;
  keyYes: string;
  keyNo: string;
}

const DEFAULTS: Config = {
  level: 3, decisionsPerRound: 4, trialMs: 1500,
  threshAdvance: 80, threshFallback: 50, type: "verbal",
  keyYes: "a", keyNo: "l",
};

interface Round { truths: boolean[]; item: string | number }

export default function CWM({ embedded, autoStart, onSessionComplete }: GameProps) {
  const [cfg, setCfg] = useGameConfig<Config>("cwm", DEFAULTS);
  const px = useScaled();

  const [phase, setPhase] = useState<Phase>("idle");
  const [rounds, setRounds] = useState<Round[]>([]);
  const [roundIdx, setRoundIdx] = useState(0);
  const [decisionIdx, setDecisionIdx] = useState(0);
  const [stimulus, setStimulus] = useState<string>("");
  const [memItem, setMemItem] = useState<string | number | null>(null);
  const [recallInput, setRecallInput] = useState<(string | number | null)[]>([]);
  const [recallIdx, setRecallIdx] = useState(0);
  const [score, setScore] = useState({ correct: 0, total: 0, proc: 0, procTotal: 0 });
  const [flash, setFlash] = useState<"yes" | "no" | null>(null);

  const procRef = useRef({ correct: 0, total: 0 });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const gen = useRef(0);
  const startedAt = useRef(0);
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => () => { gen.current += 1; clearTimers(); }, []);

  const stimulusFor = useCallback((truth: boolean, type: GameType) =>
    type === "verbal"
      ? (truth ? pick(CORRECT_WORDS) : pick(WRONG_WORDS))
      : (truth ? pick(SYM_SHAPES) : pick(ASYM_SHAPES)), []);

  const buildRound = useCallback((type: GameType, decisions: number): Round => ({
    truths: Array.from({ length: decisions }, () => Math.random() > 0.5),
    item: type === "verbal" ? pick(LETTERS_POOL) : randInt(GRID_CELLS),
  }), []);

  const startSession = useCallback(() => {
    gen.current += 1;
    clearTimers();
    startedAt.current = Date.now();
    const built = Array.from({ length: cfg.level }, () => buildRound(cfg.type, cfg.decisionsPerRound));
    procRef.current = { correct: 0, total: 0 };
    setRounds(built);
    setRoundIdx(0);
    setDecisionIdx(0);
    setRecallInput([]);
    setRecallIdx(0);
    setMemItem(null);
    setScore({ correct: 0, total: cfg.level, proc: 0, procTotal: 0 });
    setStimulus(stimulusFor(built[0].truths[0], cfg.type));
    setPhase("decision");
  }, [cfg.level, cfg.type, cfg.decisionsPerRound, buildRound, stimulusFor]);

  const startRef = useRef(startSession);
  startRef.current = startSession;
  useEffect(() => { if (autoStart) startRef.current(); }, [autoStart]);

  const answer = useCallback((said: boolean) => {
    if (phase !== "decision") return;
    const round = rounds[roundIdx];
    if (!round) return;
    setFlash(said ? "yes" : "no");
    setTimeout(() => setFlash(null), 110);

    procRef.current.total++;
    if (said === round.truths[decisionIdx]) procRef.current.correct++;

    const nextDecision = decisionIdx + 1;
    if (nextDecision < cfg.decisionsPerRound) {
      setDecisionIdx(nextDecision);
      setStimulus(stimulusFor(round.truths[nextDecision], cfg.type));
      return;
    }

    // Round finished: show the item to hold, then move on.
    const myGen = gen.current;
    setMemItem(round.item);
    setPhase("memorize");
    timers.current.push(setTimeout(() => {
      if (myGen !== gen.current) return;
      setMemItem(null);
      const nextRound = roundIdx + 1;
      if (nextRound >= cfg.level) {
        setRecallInput(Array(cfg.level).fill(null));
        setRecallIdx(0);
        setPhase("recall");
        return;
      }
      setRoundIdx(nextRound);
      setDecisionIdx(0);
      setStimulus(stimulusFor(rounds[nextRound].truths[0], cfg.type));
      setPhase("decision");
    }, cfg.trialMs));
  }, [phase, rounds, roundIdx, decisionIdx, cfg.decisionsPerRound, cfg.level, cfg.trialMs, cfg.type, stimulusFor]);

  const recall = useCallback((item: string | number) => {
    if (phase !== "recall") return;
    const updated = [...recallInput];
    updated[recallIdx] = item;
    setRecallInput(updated);
    const next = recallIdx + 1;
    if (next < cfg.level) { setRecallIdx(next); return; }

    let correct = 0;
    rounds.forEach((r, i) => { if (updated[i] === r.item) correct++; });
    const acc = (correct / cfg.level) * 100;
    const newLevel = acc >= cfg.threshAdvance && cfg.level < 12 ? cfg.level + 1
      : acc < cfg.threshFallback && cfg.level > 1 ? cfg.level - 1
      : cfg.level;
    const proc = procRef.current;
    setScore({ correct, total: cfg.level, proc: proc.correct, procTotal: proc.total });
    setCfg(c => ({ ...c, level: newLevel }));
    setPhase("result");
    recordDrillResultInBackground({
      domain: "working_memory", activityId: "complex-working-memory",
      correct: correct + proc.correct, total: cfg.level + proc.total,
      level: cfg.level, maxLevel: 12, startedAt: startedAt.current,
    });
    onSessionComplete?.({ correct, total: cfg.level, level: newLevel });
  }, [phase, recallInput, recallIdx, cfg, rounds, setCfg, onSessionComplete]);

  // Yes/No during the processing task…
  useGameKeys([cfg.keyYes], () => answer(true), phase === "decision");
  useGameKeys([cfg.keyNo], () => answer(false), phase === "decision");
  // …and the letter pool while recalling the verbal variant.
  useGameKeys(
    cfg.type === "verbal" ? LETTERS_POOL.map(l => l.toLowerCase()) : [],
    k => recall(k.toUpperCase()),
    phase === "recall" && cfg.type === "verbal",
  );

  const settings: Setting[] = [
    { kind: "select", key: "type", label: "Variant", options: [{ value: "verbal", label: "Verbal" }, { value: "spatial", label: "Spatial" }] },
    { kind: "range", key: "level", label: "Items to recall", min: 1, max: 12 },
    { kind: "range", key: "decisionsPerRound", label: "Decisions per item", min: 1, max: 8 },
    { kind: "range", key: "trialMs", label: "Memorise time", min: 500, max: 3000, step: 100, format: v => `${(v / 1000).toFixed(1)}s` },
    { kind: "range", key: "threshAdvance", label: "Advance at %", min: 60, max: 95, step: 5 },
    { kind: "range", key: "threshFallback", label: "Fall back below %", min: 30, max: 65, step: 5 },
    { kind: "key", key: "keyYes", label: "Yes key" },
    { kind: "key", key: "keyNo", label: "No key" },
  ];

  const shellPhase = phase === "idle" ? "idle" : phase === "result" ? "result" : "running";
  const gridPx = Math.min(px(230), 230 * 1.7);

  return (
    <GameShell
      title="Complex Working Memory" accent={accent} embedded={embedded}
      subtitle={`Level ${cfg.level} · ${cfg.type} · ${cfg.decisionsPerRound} decisions/item`}
      phase={shellPhase} onStart={startSession} settings={settings} cfg={cfg} setCfg={setCfg}
      variants={
        <div className="flex" style={{ gap: px(8) }}>
          {(["verbal", "spatial"] as GameType[]).map(t => (
            <button key={t} onClick={() => setCfg(c => ({ ...c, type: t }))}
              className="flex-1 rounded-lg font-semibold tracking-widest uppercase transition-all"
              style={{
                padding: `${px(8)}px 0`, fontSize: px(11), fontFamily: SERIF,
                background: cfg.type === t ? alpha(accent, 0.2) : "hsl(222 20% 5%)",
                border: `1px solid ${cfg.type === t ? accent : "hsl(var(--accent-h) 15% 14%)"}`,
                color: cfg.type === t ? accent : "hsl(214 20% 45%)",
              }}>{t}</button>
          ))}
        </div>
      }
      instructions={
        <div style={{ display: "grid", gap: px(6) }}>
          {cfg.type === "verbal"
            ? <p>Decide whether each word is <strong style={{ color: accent }}>spelled correctly</strong>, then hold the <strong style={{ color: accent }}>letter</strong> that follows. Recall every letter in order at the end.</p>
            : <p>Decide whether each shape is <strong style={{ color: accent }}>symmetric about the vertical axis</strong>, then hold the <strong style={{ color: accent }}>highlighted cell</strong>. Tap every cell in order at the end.</p>}
          <p>
            <kbd style={{ padding: `${px(2)}px ${px(6)}px`, borderRadius: px(4), background: "hsl(222 20% 9%)", border: "1px solid hsl(var(--accent-h) 15% 18%)", color: accent }}>{keyLabel(cfg.keyYes)}</kbd> yes
            {"  ·  "}
            <kbd style={{ padding: `${px(2)}px ${px(6)}px`, borderRadius: px(4), background: "hsl(222 20% 9%)", border: "1px solid hsl(var(--accent-h) 15% 18%)", color: accent }}>{keyLabel(cfg.keyNo)}</kbd> no
          </p>
        </div>
      }
    >
      {phase === "decision" && (
        <div className="text-center w-full flex flex-col items-center" style={{ gap: px(22) }}>
          <p style={{ color: "hsl(214 20% 36%)", fontFamily: MONO, fontSize: px(10), letterSpacing: "0.15em", textTransform: "uppercase" }}>
            Item {roundIdx + 1}/{cfg.level} · Decision {decisionIdx + 1}/{cfg.decisionsPerRound}
          </p>
          {cfg.type === "verbal" ? (
            <p style={{ fontFamily: SERIF, color: accent, fontSize: px(42), fontWeight: 700, letterSpacing: "0.08em" }}>{stimulus}</p>
          ) : (
            <svg viewBox="0 0 20 20" style={{ width: px(170), height: px(170), filter: `drop-shadow(0 0 ${px(10)}px ${alpha(accent, 0.5)})` }}>
              <path d={stimulus} fill={accent} fillOpacity={0.82} />
            </svg>
          )}
          <div className="flex w-full" style={{ gap: px(10), maxWidth: px(400) }}>
            {([[true, "Yes", cfg.keyYes], [false, "No", cfg.keyNo]] as const).map(([val, label, key]) => (
              <button key={label} onClick={() => answer(val)}
                className="flex-1 rounded-xl font-semibold tracking-widest uppercase transition-all active:scale-95"
                style={{
                  padding: `${px(12)}px 0`, fontSize: px(12), fontFamily: SERIF,
                  background: flash === (val ? "yes" : "no") ? alpha(accent, 0.4) : alpha(accent, 0.12),
                  border: `1px solid ${alpha(accent, 0.35)}`, color: accent,
                }}>
                {label} ({keyLabel(key)})
              </button>
            ))}
          </div>
        </div>
      )}

      {phase === "memorize" && (
        <div className="text-center flex flex-col items-center" style={{ gap: px(14) }}>
          <p style={{ color: "hsl(214 20% 36%)", fontFamily: MONO, fontSize: px(10), letterSpacing: "0.15em", textTransform: "uppercase" }}>
            {memItem === null ? "…" : "Remember this"}
          </p>
          {memItem !== null && (cfg.type === "verbal" ? (
            <p style={{ fontFamily: SERIF, color: accent, fontSize: px(84), fontWeight: 700, filter: `drop-shadow(0 0 ${px(22)}px ${accent})` }}>{memItem}</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`, width: gridPx, height: gridPx, gap: px(5) }}>
              {Array.from({ length: GRID_CELLS }).map((_, i) => (
                <div key={i} style={{
                  borderRadius: px(5),
                  background: i === memItem ? accent : "hsl(222 20% 10%)",
                  border: `1px solid ${i === memItem ? accent : "hsl(var(--accent-h) 15% 14%)"}`,
                  boxShadow: i === memItem ? `0 0 ${px(14)}px ${accent}` : "none",
                }} />
              ))}
            </div>
          ))}
        </div>
      )}

      {phase === "recall" && (
        <div className="flex flex-col items-center w-full" style={{ gap: px(14) }}>
          <p style={{ color: "hsl(214 20% 40%)", fontFamily: MONO, fontSize: px(10), letterSpacing: "0.15em", textTransform: "uppercase" }}>
            Recall item {recallIdx + 1} of {cfg.level}
          </p>
          <div className="flex flex-wrap justify-center" style={{ gap: px(6) }}>
            {recallInput.map((item, i) => (
              <span key={i} style={{
                padding: `${px(4)}px ${px(8)}px`, borderRadius: px(5), fontSize: px(11), fontFamily: MONO,
                background: i < recallIdx ? alpha(accent, 0.2) : "hsl(222 20% 8%)",
                border: `1px solid ${i < recallIdx ? accent : "hsl(var(--accent-h) 15% 14%)"}`,
                color: i < recallIdx ? accent : "hsl(214 20% 35%)",
              }}>
                {item !== null ? (cfg.type === "verbal" ? item : `#${item}`) : "?"}
              </span>
            ))}
          </div>
          {cfg.type === "verbal" ? (
            <div className="flex flex-wrap justify-center" style={{ gap: px(6), maxWidth: px(440) }}>
              {LETTERS_POOL.map(l => (
                <button key={l} onClick={() => recall(l)}
                  className="rounded-lg font-bold transition-all active:scale-90"
                  style={{
                    width: px(40), height: px(40), fontSize: px(14), fontFamily: SERIF,
                    background: "hsl(222 20% 8%)", border: "1px solid hsl(var(--accent-h) 15% 14%)",
                    color: "hsl(46 45% 70%)",
                  }}>{l}</button>
              ))}
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`, width: gridPx, height: gridPx, gap: px(5) }}>
              {Array.from({ length: GRID_CELLS }).map((_, i) => (
                <button key={i} onClick={() => recall(i)}
                  className="transition-all active:scale-90"
                  style={{ borderRadius: px(5), background: "hsl(222 20% 9%)", border: "1px solid hsl(var(--accent-h) 15% 16%)" }}
                  onMouseEnter={e => { e.currentTarget.style.background = alpha(accent, 0.3); }}
                  onMouseLeave={e => { e.currentTarget.style.background = "hsl(222 20% 9%)"; }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {phase === "result" && (
        <div className="rounded-xl border text-center w-full"
          style={{ background: "hsl(222 20% 5%)", borderColor: alpha(accent, 0.3), padding: px(18), maxWidth: px(400) }}>
          <p style={{ fontFamily: SERIF, color: "hsl(214 20% 45%)", fontSize: px(11), letterSpacing: "0.15em", textTransform: "uppercase" }}>Recall Complete</p>
          <p style={{ color: accent, fontFamily: SERIF, fontSize: px(38), fontWeight: 700, marginTop: px(10) }}>{score.correct}/{score.total}</p>
          <p style={{ color: "hsl(214 20% 45%)", fontFamily: MONO, fontSize: px(11), marginTop: px(8) }}>
            processing {score.procTotal ? Math.round((score.proc / score.procTotal) * 100) : 0}% · next level <span style={{ color: accent }}>{cfg.level}</span>
          </p>
        </div>
      )}
    </GameShell>
  );
}
