/**
 * Flux — reaction speed under a rule that will not hold still.
 *
 * A figure appears. A rule says what to do with it. You answer as fast as you
 * can. Every so often the rule changes — sometimes announced, sometimes not,
 * and when it is not the only way to find out is to get one wrong.
 *
 * **Why the rules are generated rather than listed.** A fixed set of rules is
 * learnable, and once learned the task stops measuring flexibility and starts
 * measuring recall of the set. Rules here are built from a grammar instead:
 * pick one or two predicates over the stimulus dimensions (colour, shape,
 * symbol class, parity, count, side, size), optionally combine them with
 * AND / OR / XOR, optionally negate, and choose between a two-key mapping and
 * a go/no-go mapping. That is thousands of distinct rules from a handful of
 * parts, and the space grows with every dimension added.
 *
 * **What it measures.** Accuracy and mean reaction time, plus two numbers the
 * plain versions of this task cannot give you:
 *
 * - *Shift cost* — how much slower you are on the first three trials after a
 *   rule changes than you are the rest of the time. This is the flexibility
 *   number; a low overall RT with a huge shift cost means you are fast but
 *   rigid.
 * - *Perseverations* — errors that would have been correct under the previous
 *   rule. These separate "I have not worked out the new rule" from "I am still
 *   running the old one".
 */

import { useCallback, useEffect, useRef, useState } from "react";
import GameShell, { type Setting } from "@/components/games/GameShell";
import {
  MONO, SERIF, alpha, keyLabel, pick, randInt, useGameConfig, useGameKeys, useScaled,
  type GameProps,
} from "@/lib/gameKit";
import { recordDrillResultInBackground } from "@/lib/trainingRecorder";

const accent = "hsl(190 75% 55%)";

/* ── Stimulus space ──────────────────────────────────────────────────── */

const SHAPES = ["circle", "square", "triangle", "diamond"] as const;
type Shape = typeof SHAPES[number];

const COLORS = [
  { name: "red", css: "hsl(2 70% 58%)" },
  { name: "green", css: "hsl(140 55% 50%)" },
  { name: "blue", css: "hsl(210 80% 62%)" },
  { name: "amber", css: "hsl(38 90% 58%)" },
] as const;
type ColorName = typeof COLORS[number]["name"];

const VOWELS = "AEIOU".split("");
const CONSONANTS = "BCDFGHJKLMNPRSTVWZ".split("");
const DIGITS = "123456789".split("");

interface Stim {
  shape: Shape;
  color: ColorName;
  glyph: string;
  count: number;
  large: boolean;
  left: boolean;
}

function randomStim(): Stim {
  const isDigit = Math.random() < 0.5;
  return {
    shape: pick(SHAPES),
    color: pick(COLORS).name,
    glyph: isDigit ? pick(DIGITS) : (Math.random() < 0.35 ? pick(VOWELS) : pick(CONSONANTS)),
    count: 1 + randInt(4),
    large: Math.random() < 0.5,
    left: Math.random() < 0.5,
  };
}

/* ── Rule grammar ────────────────────────────────────────────────────── */

interface Atom { label: string; test: (s: Stim) => boolean }

function randomAtom(): Atom {
  switch (randInt(8)) {
    case 0: { const c = pick(COLORS); return { label: `it is ${c.name}`, test: s => s.color === c.name }; }
    case 1: { const sh = pick(SHAPES); return { label: `it is a ${sh}`, test: s => s.shape === sh }; }
    case 2: return { label: "the symbol is a digit", test: s => DIGITS.includes(s.glyph) };
    case 3: return { label: "the symbol is a vowel", test: s => VOWELS.includes(s.glyph) };
    case 4: return { label: "the symbol is an even digit", test: s => DIGITS.includes(s.glyph) && Number(s.glyph) % 2 === 0 };
    case 5: return { label: "there are more than two", test: s => s.count > 2 };
    case 6: return { label: "it sits on the left", test: s => s.left };
    default: return { label: "it is large", test: s => s.large };
  }
}

type Answer = "A" | "B" | "none";

interface Rule {
  text: string;
  kind: "binary" | "gonogo";
  answer: (s: Stim) => Answer;
}

/**
 * Complexity ladder. Level 1 is one plain predicate against two keys; by level
 * 5 you can be handed a negated exclusive-or with a withhold branch.
 */
function makeRule(level: number, keyA: string, keyB: string): Rule {
  const wantCompound = level >= 3 && Math.random() < Math.min(0.85, 0.3 + level * 0.1);
  const wantNegate = level >= 4 && Math.random() < 0.35;
  const wantGoNoGo = level >= 2 && Math.random() < (level >= 5 ? 0.4 : 0.25);

  let label: string;
  let test: (s: Stim) => boolean;

  if (wantCompound) {
    let a = randomAtom();
    let b = randomAtom();
    let guard = 0;
    while (b.label === a.label && guard++ < 20) b = randomAtom();
    const combos = level >= 5 ? ["and", "or", "xor"] as const : ["and", "or"] as const;
    const combo = pick(combos);
    label = `${a.label} ${combo} ${b.label}`;
    test = combo === "and" ? (s => a.test(s) && b.test(s))
      : combo === "or" ? (s => a.test(s) || b.test(s))
      : (s => a.test(s) !== b.test(s));
  } else {
    const a = randomAtom();
    label = a.label;
    test = a.test;
  }

  if (wantNegate) {
    const inner = test;
    label = `NOT (${label})`;
    test = s => !inner(s);
  }

  const A = keyLabel(keyA);
  const B = keyLabel(keyB);
  return wantGoNoGo
    ? { kind: "gonogo", text: `Press ${A} if ${label} — otherwise press nothing`, answer: s => (test(s) ? "A" : "none") }
    : { kind: "binary", text: `Press ${A} if ${label}, otherwise ${B}`, answer: s => (test(s) ? "A" : "B") };
}

/* ── Config ──────────────────────────────────────────────────────────── */

interface Config {
  level: number;
  trials: number;
  deadlineMs: number;
  blockLen: number;
  cueRate: number;
  keyA: string;
  keyB: string;
  threshAdvance: number;
  threshFallback: number;
}

const DEFAULTS: Config = {
  level: 1, trials: 40, deadlineMs: 1800, blockLen: 8, cueRate: 50,
  keyA: "f", keyB: "j", threshAdvance: 82, threshFallback: 55,
};

type Phase = "idle" | "cue" | "trial" | "feedback" | "result";

interface Totals {
  correct: number; answered: number; trials: number;
  rtSum: number; rtCount: number;
  shiftRtSum: number; shiftRtCount: number;
  perseverations: number; shifts: number;
}

const EMPTY: Totals = {
  correct: 0, answered: 0, trials: 0, rtSum: 0, rtCount: 0,
  shiftRtSum: 0, shiftRtCount: 0, perseverations: 0, shifts: 0,
};

export default function Flux({ embedded, autoStart, onSessionComplete }: GameProps) {
  const [cfg, setCfg] = useGameConfig<Config>("flux", DEFAULTS);
  const px = useScaled();

  const [phase, setPhase] = useState<Phase>("idle");
  const [stim, setStim] = useState<Stim | null>(null);
  const [rule, setRule] = useState<Rule | null>(null);
  const [cueText, setCueText] = useState<string | null>(null);
  const [trialNo, setTrialNo] = useState(0);
  const [progress, setProgress] = useState(0);
  const [verdict, setVerdict] = useState<"correct" | "wrong" | "late" | null>(null);
  const [totals, setTotals] = useState<Totals>(EMPTY);
  const [lastRt, setLastRt] = useState<number | null>(null);

  const ruleRef = useRef<Rule | null>(null);
  const prevRuleRef = useRef<Rule | null>(null);
  const stimRef = useRef<Stim | null>(null);
  const totalsRef = useRef<Totals>({ ...EMPTY });
  const trialRef = useRef(0);
  const sinceShift = useRef(0);
  const blockTarget = useRef(8);
  const onsetRef = useRef(0);
  const answeredRef = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const raf = useRef(0);
  const gen = useRef(0);
  const startedAt = useRef(0);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

  const clearAll = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    cancelAnimationFrame(raf.current);
  };
  const later = (fn: () => void, ms: number) => { timers.current.push(setTimeout(fn, ms)); };
  useEffect(() => () => { gen.current += 1; clearAll(); }, []);

  const finish = useCallback(() => {
    clearAll();
    const t = { ...totalsRef.current };
    const acc = t.trials > 0 ? (t.correct / t.trials) * 100 : 0;
    const level = cfgRef.current.level;
    const newLevel = acc >= cfgRef.current.threshAdvance && level < 8 ? level + 1
      : acc < cfgRef.current.threshFallback && level > 1 ? level - 1
      : level;
    setTotals(t);
    setCfg(c => ({ ...c, level: newLevel }));
    setPhase("result");
    setStim(null);
    recordDrillResultInBackground({
      domain: "flexibility", activityId: "flux",
      correct: t.correct, total: Math.max(1, t.trials),
      level, maxLevel: 8, startedAt: startedAt.current,
    });
    onSessionComplete?.({ correct: t.correct, total: Math.max(1, t.trials), level: newLevel });
  }, [setCfg, onSessionComplete]);

  const beginTrial = useCallback((i: number, myGen: number) => {
    if (myGen !== gen.current) return;
    if (i >= cfgRef.current.trials) { finish(); return; }

    // Rule shift?
    let cued = false;
    if (!ruleRef.current || sinceShift.current >= blockTarget.current) {
      if (ruleRef.current) {
        prevRuleRef.current = ruleRef.current;
        totalsRef.current.shifts++;
      }
      ruleRef.current = makeRule(cfgRef.current.level, cfgRef.current.keyA, cfgRef.current.keyB);
      setRule(ruleRef.current);
      sinceShift.current = 0;
      const jitter = Math.max(3, cfgRef.current.blockLen);
      blockTarget.current = jitter + randInt(Math.max(2, Math.round(jitter / 2)));
      // The first rule of a session is always shown; after that it is a coin
      // weighted by the cue-rate setting.
      cued = prevRuleRef.current === null || Math.random() * 100 < cfgRef.current.cueRate;
    }

    trialRef.current = i;
    setTrialNo(i);
    answeredRef.current = false;
    setVerdict(null);

    const present = () => {
      if (myGen !== gen.current) return;
      setCueText(null);
      const s = randomStim();
      stimRef.current = s;
      setStim(s);
      setPhase("trial");
      setProgress(0);
      onsetRef.current = performance.now();
      const tick = () => {
        if (myGen !== gen.current || answeredRef.current) return;
        const elapsed = performance.now() - onsetRef.current;
        const limit = cfgRef.current.deadlineMs;
        setProgress(Math.min(1, elapsed / limit));
        if (elapsed >= limit) { respondRef.current(null); return; }
        raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
    };

    if (cued && ruleRef.current) {
      setCueText(ruleRef.current.text);
      setPhase("cue");
      later(present, 1600);
    } else {
      present();
    }
  }, [finish]);

  const beginRef = useRef(beginTrial);
  beginRef.current = beginTrial;

  /** `choice === null` means the deadline ran out. */
  const respond = useCallback((choice: "A" | "B" | null) => {
    if (answeredRef.current || !ruleRef.current || !stimRef.current) return;
    answeredRef.current = true;
    cancelAnimationFrame(raf.current);

    const expected = ruleRef.current.answer(stimRef.current);
    const given: Answer = choice ?? "none";
    const rt = performance.now() - onsetRef.current;
    const isPostShift = sinceShift.current < 3;

    const t = totalsRef.current;
    t.trials++;
    if (choice) t.answered++;
    const ok = given === expected;
    if (ok) {
      t.correct++;
      t.rtSum += rt; t.rtCount++;
      if (isPostShift) { t.shiftRtSum += rt; t.shiftRtCount++; }
    } else if (prevRuleRef.current && choice) {
      // Would this have been right under the rule we just left?
      if (prevRuleRef.current.answer(stimRef.current) === given) t.perseverations++;
    }

    sinceShift.current++;
    setTotals({ ...t });
    setLastRt(choice ? Math.round(rt) : null);
    setVerdict(ok ? "correct" : choice ? "wrong" : "late");
    setPhase("feedback");

    const myGen = gen.current;
    later(() => beginRef.current(trialRef.current + 1, myGen), ok ? 320 : 620);
  }, []);

  const respondRef = useRef(respond);
  respondRef.current = respond;

  const startSession = useCallback(() => {
    gen.current += 1;
    clearAll();
    startedAt.current = Date.now();
    totalsRef.current = { ...EMPTY };
    ruleRef.current = null;
    prevRuleRef.current = null;
    sinceShift.current = 0;
    blockTarget.current = cfg.blockLen;
    setTotals({ ...EMPTY });
    setLastRt(null);
    setVerdict(null);
    setRule(null);
    beginTrial(0, gen.current);
  }, [cfg.blockLen, beginTrial]);

  const startRef = useRef(startSession);
  startRef.current = startSession;
  useEffect(() => { if (autoStart) startRef.current(); }, [autoStart]);

  useGameKeys([cfg.keyA], () => respondRef.current("A"), phase === "trial");
  useGameKeys([cfg.keyB], () => respondRef.current("B"), phase === "trial");

  const settings: Setting[] = [
    { kind: "range", key: "level", label: "Rule complexity", min: 1, max: 8 },
    { kind: "range", key: "trials", label: "Trials", min: 10, max: 120, step: 5 },
    { kind: "range", key: "deadlineMs", label: "Deadline", min: 400, max: 4000, step: 100, format: v => `${(v / 1000).toFixed(1)}s` },
    { kind: "range", key: "blockLen", label: "Trials per rule", min: 3, max: 25 },
    { kind: "range", key: "cueRate", label: "Rule shifts announced", min: 0, max: 100, step: 10, format: v => `${v}%` },
    { kind: "key", key: "keyA", label: "Key A" },
    { kind: "key", key: "keyB", label: "Key B" },
    { kind: "range", key: "threshAdvance", label: "Advance at %", min: 60, max: 95, step: 5 },
    { kind: "range", key: "threshFallback", label: "Fall back below %", min: 30, max: 70, step: 5 },
  ];

  const meanRt = totals.rtCount ? Math.round(totals.rtSum / totals.rtCount) : 0;
  const shiftRt = totals.shiftRtCount ? Math.round(totals.shiftRtSum / totals.shiftRtCount) : 0;
  const shiftCost = meanRt && shiftRt ? shiftRt - meanRt : 0;

  const stage = px(230);
  const colorOf = (n: ColorName) => COLORS.find(c => c.name === n)!.css;

  return (
    <GameShell
      title="Flux" accent={accent} embedded={embedded}
      subtitle={`Complexity ${cfg.level} · ${(cfg.deadlineMs / 1000).toFixed(1)}s deadline · ${cfg.cueRate}% announced`}
      phase={phase === "idle" ? "idle" : phase === "result" ? "result" : "running"}
      onStart={startSession} settings={settings} cfg={cfg} setCfg={setCfg}
      instructions={
        <div style={{ display: "grid", gap: px(6) }}>
          <p>A figure appears and a rule decides what to press. Answer before the bar empties.</p>
          <p>
            <kbd style={{ padding: `${px(2)}px ${px(6)}px`, borderRadius: px(4), background: "hsl(222 20% 9%)", border: "1px solid hsl(var(--accent-h) 15% 18%)", color: accent }}>{keyLabel(cfg.keyA)}</kbd>
            {" and "}
            <kbd style={{ padding: `${px(2)}px ${px(6)}px`, borderRadius: px(4), background: "hsl(222 20% 9%)", border: "1px solid hsl(var(--accent-h) 15% 18%)", color: accent }}>{keyLabel(cfg.keyB)}</kbd>
            {" — some rules also ask you to press nothing at all."}
          </p>
          <p>The rule changes roughly every {cfg.blockLen} trials. About {cfg.cueRate}% of changes are announced; the rest you infer from being wrong.</p>
        </div>
      }
    >
      {phase === "cue" && cueText && (
        <div className="text-center rounded-xl border w-full"
          style={{ padding: px(22), maxWidth: px(420), background: alpha(accent, 0.08), borderColor: alpha(accent, 0.4) }}>
          <p style={{ fontFamily: MONO, fontSize: px(10), letterSpacing: "0.2em", textTransform: "uppercase", color: "hsl(214 20% 45%)" }}>New rule</p>
          <p style={{ fontFamily: SERIF, fontSize: px(19), color: accent, marginTop: px(10), lineHeight: 1.45 }}>{cueText}</p>
        </div>
      )}

      {(phase === "trial" || phase === "feedback") && (
        <div className="flex flex-col items-center w-full" style={{ gap: px(14), maxWidth: px(430) }}>
          <div className="w-full rounded-full overflow-hidden" style={{ height: px(4), background: "hsl(222 20% 10%)" }}>
            <div style={{
              height: "100%", width: `${(1 - progress) * 100}%`,
              background: verdict === "correct" ? "hsl(130 60% 55%)" : verdict ? "hsl(0 60% 55%)" : accent,
            }} />
          </div>

          <div className="flex items-center justify-between w-full">
            <span style={{ color: "hsl(214 20% 36%)", fontFamily: MONO, fontSize: px(10) }}>
              {trialNo + 1} / {cfg.trials}
            </span>
            <span style={{ color: "hsl(214 20% 36%)", fontFamily: MONO, fontSize: px(10) }}>
              {totals.correct}/{totals.trials} · {lastRt !== null ? `${lastRt}ms` : "—"}
            </span>
          </div>

          <div
            className="w-full flex items-center rounded-xl"
            style={{
              height: stage, padding: px(14),
              justifyContent: stim?.left ? "flex-start" : "flex-end",
              background: "hsl(222 20% 5%)",
              border: `1px solid ${verdict === "correct" ? "hsl(130 60% 40%)" : verdict === "wrong" || verdict === "late" ? "hsl(0 60% 40%)" : "hsl(var(--accent-h) 15% 12%)"}`,
              transition: "border-color 0.15s",
            }}
          >
            {stim && (
              <div className="flex flex-wrap items-center justify-center" style={{ gap: px(8), maxWidth: "58%" }}>
                {Array.from({ length: stim.count }).map((_, i) => {
                  const size = (stim.large ? px(64) : px(40));
                  const c = colorOf(stim.color);
                  return (
                    <svg key={i} viewBox="0 0 100 100" style={{ width: size, height: size }}>
                      {stim.shape === "circle" && <circle cx="50" cy="50" r="46" fill={c} fillOpacity={0.85} />}
                      {stim.shape === "square" && <rect x="6" y="6" width="88" height="88" rx="10" fill={c} fillOpacity={0.85} />}
                      {stim.shape === "triangle" && <polygon points="50,4 96,94 4,94" fill={c} fillOpacity={0.85} />}
                      {stim.shape === "diamond" && <polygon points="50,2 98,50 50,98 2,50" fill={c} fillOpacity={0.85} />}
                      <text
                        x="50" y={stim.shape === "triangle" ? "78" : "50"}
                        textAnchor="middle" dominantBaseline="central"
                        fontFamily="'Cinzel', serif" fontWeight="700" fontSize="42"
                        fill="hsl(222 25% 6%)"
                      >
                        {stim.glyph}
                      </text>
                    </svg>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex w-full" style={{ gap: px(10) }}>
            {([["A", cfg.keyA], ["B", cfg.keyB]] as const).map(([slot, key]) => (
              <button key={slot} onPointerDown={() => respondRef.current(slot)}
                className="flex-1 rounded-xl font-semibold tracking-widest uppercase transition-all active:scale-95"
                style={{
                  padding: `${px(12)}px 0`, fontSize: px(12), fontFamily: SERIF,
                  background: alpha(accent, 0.14), border: `1px solid ${alpha(accent, 0.35)}`, color: accent,
                }}>
                {keyLabel(key)}
              </button>
            ))}
          </div>

          <p style={{ color: "hsl(214 20% 30%)", fontFamily: MONO, fontSize: px(9), letterSpacing: "0.1em", textAlign: "center" }}>
            {rule?.kind === "gonogo" ? "this rule may want no answer at all" : " "}
          </p>
        </div>
      )}

      {phase === "result" && (
        <div className="rounded-xl border text-center w-full"
          style={{ background: "hsl(222 20% 5%)", borderColor: alpha(accent, 0.3), padding: px(18), maxWidth: px(430) }}>
          <p style={{ fontFamily: SERIF, color: "hsl(214 20% 45%)", fontSize: px(11), letterSpacing: "0.15em", textTransform: "uppercase" }}>Session Complete</p>
          <div className="flex justify-center" style={{ gap: px(26), marginTop: px(14) }}>
            {([
              [totals.trials ? `${Math.round((totals.correct / totals.trials) * 100)}%` : "0%", "accuracy"],
              [meanRt ? `${meanRt}ms` : "—", "mean RT"],
              [shiftCost ? `${shiftCost > 0 ? "+" : ""}${shiftCost}ms` : "—", "shift cost"],
            ] as const).map(([value, label]) => (
              <div key={label}>
                <p style={{ color: accent, fontFamily: SERIF, fontSize: px(24), fontWeight: 700 }}>{value}</p>
                <p style={{ color: "hsl(214 20% 40%)", fontFamily: MONO, fontSize: px(9), letterSpacing: "0.1em", textTransform: "uppercase" }}>{label}</p>
              </div>
            ))}
          </div>
          <p style={{ color: "hsl(214 20% 45%)", fontFamily: MONO, fontSize: px(10), marginTop: px(12) }}>
            {totals.shifts} rule shift{totals.shifts === 1 ? "" : "s"} · {totals.perseverations} perseveration{totals.perseverations === 1 ? "" : "s"} · next complexity <span style={{ color: accent }}>{cfg.level}</span>
          </p>
        </div>
      )}
    </GameShell>
  );
}
