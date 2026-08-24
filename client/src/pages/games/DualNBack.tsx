/**
 * Dual N-Back
 *
 * Audio channel: a letter is spoken. Visual channel: a square lights in one of
 * nine cells. You press one key when the letter matches the one N steps back
 * and another when the position does.
 *
 * Three things changed from the first version:
 *
 * - **The speech said "Capital C".** `SpeechSynthesisUtterance("C")` is a lone
 *   uppercase character, and most macOS voices spell that out with its case.
 *   Feeding the voice a pronunciation ("see", "aitch", "kay") sidesteps the
 *   whole question — it also removes the letter-name ambiguity that made C/K
 *   and S/X hard to tell apart at speed.
 *
 * - **Match rate is yours to set.** The sequence is now generated up front with
 *   a target proportion of matches per channel rather than left to chance, so a
 *   21-trial run cannot come out with two matches or with fourteen.
 *
 * - **The response keys are rebindable**, which matters in the Arena: Complex
 *   Working Memory wants a yes/no pair too, and two drills fighting over A and
 *   L is a worse experience than moving one of them.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import GameShell, { type Setting } from "@/components/games/GameShell";
import {
  MONO, SERIF, alpha, keyLabel, randInt, useGameConfig, useGameKeys, useScaled,
  type GameProps,
} from "@/lib/gameKit";
import { recordDrillResultInBackground } from "@/lib/trainingRecorder";

const LETTERS = ["C", "H", "K", "L", "Q", "R", "S", "T"];

/** Pronunciations, not names — see the header note about "Capital C". */
const SPOKEN: Record<string, string> = {
  C: "see", H: "aitch", K: "kay", L: "el", Q: "cue", R: "are", S: "ess", T: "tee",
};

const GRID = 9;
const accent = "hsl(210 80% 62%)";

function speak(letter: string, volume: number) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  if (volume <= 0) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(SPOKEN[letter] ?? letter.toLowerCase());
  u.rate = 0.95;
  u.pitch = 1;
  u.volume = volume / 100;
  u.lang = "en-US";
  window.speechSynthesis.speak(u);
}

interface Config {
  n: number;
  trials: number;
  trialMs: number;
  matchRate: number;
  threshAdvance: number;
  threshFallback: number;
  volume: number;
  keyAudio: string;
  keyPos: string;
}

const DEFAULTS: Config = {
  n: 1, trials: 21, trialMs: 3000, matchRate: 30,
  threshAdvance: 80, threshFallback: 50, volume: 60,
  keyAudio: "a", keyPos: "l",
};

/**
 * Build both channels so that roughly `matchRate` percent of the scorable
 * trials are matches, independently per channel. Non-match trials are forced
 * to differ from the N-back item rather than merely drawn at random, or the
 * effective rate would drift above the setting.
 */
function buildSequences(trials: number, n: number, matchRate: number) {
  const pos: number[] = [];
  const letters: string[] = [];
  for (let i = 0; i < trials; i++) {
    if (i >= n && Math.random() * 100 < matchRate) {
      pos.push(pos[i - n]);
    } else {
      let p = randInt(GRID);
      if (i >= n) while (p === pos[i - n]) p = randInt(GRID);
      pos.push(p);
    }
    if (i >= n && Math.random() * 100 < matchRate) {
      letters.push(letters[i - n]);
    } else {
      let l = LETTERS[randInt(LETTERS.length)];
      if (i >= n) while (l === letters[i - n]) l = LETTERS[randInt(LETTERS.length)];
      letters.push(l);
    }
  }
  return { pos, letters };
}

type Phase = "idle" | "running" | "result";
interface Result {
  nLevel: number;
  audioCorrect: number; posCorrect: number; scorable: number;
  audioHits: number; audioTargets: number;
  posHits: number; posTargets: number;
}

export default function DualNBack({ embedded, autoStart, onSessionComplete }: GameProps) {
  const [cfg, setCfg] = useGameConfig<Config>("dual-n-back", DEFAULTS);
  const px = useScaled();

  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<Result | null>(null);
  const [step, setStep] = useState(0);
  const [activePos, setActivePos] = useState<number | null>(null);
  const [flash, setFlash] = useState<{ audio: boolean; pos: boolean }>({ audio: false, pos: false });
  const [feedback, setFeedback] = useState<{ audio: "hit" | "miss" | null; pos: "hit" | "miss" | null }>({ audio: null, pos: null });

  const seq = useRef<{ pos: number[]; letters: string[] }>({ pos: [], letters: [] });
  const pressedAudio = useRef(false);
  const pressedPos = useRef(false);
  const stats = useRef({ audioCorrect: 0, posCorrect: 0, scorable: 0, audioHits: 0, audioTargets: 0, posHits: 0, posTargets: 0 });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const gen = useRef(0);
  const startedAt = useRef(0);

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const later = (fn: () => void, ms: number) => { timers.current.push(setTimeout(fn, ms)); };

  const endSession = useCallback((n: number) => {
    clearTimers();
    const s = { ...stats.current };
    const acc = s.scorable > 0 ? ((s.audioCorrect + s.posCorrect) / (s.scorable * 2)) * 100 : 0;
    const newN = acc >= cfg.threshAdvance ? n + 1
      : acc < cfg.threshFallback && n > 1 ? n - 1
      : n;
    setResult({ nLevel: newN, ...s });
    setCfg(c => ({ ...c, n: newN }));
    setPhase("result");
    setActivePos(null);
    recordDrillResultInBackground({
      domain: "working_memory", activityId: "dual-n-back",
      correct: s.audioCorrect + s.posCorrect, total: s.scorable * 2,
      level: n, maxLevel: 8, startedAt: startedAt.current,
    });
    onSessionComplete?.({ correct: s.audioCorrect + s.posCorrect, total: s.scorable * 2, level: newN });
  }, [cfg.threshAdvance, cfg.threshFallback, setCfg, onSessionComplete]);

  const runStep = useCallback((i: number, n: number, trials: number, myGen: number) => {
    if (myGen !== gen.current) return;

    // Score the trial that just finished, both channels, hits and correct
    // rejections alike — pressing nothing on a non-match is a right answer.
    if (i > 0 && i - 1 >= n) {
      const j = i - 1;
      const audioMatch = seq.current.letters[j] === seq.current.letters[j - n];
      const posMatch = seq.current.pos[j] === seq.current.pos[j - n];
      stats.current.scorable++;
      if (audioMatch) {
        stats.current.audioTargets++;
        if (pressedAudio.current) { stats.current.audioHits++; stats.current.audioCorrect++; }
      } else if (!pressedAudio.current) stats.current.audioCorrect++;
      if (posMatch) {
        stats.current.posTargets++;
        if (pressedPos.current) { stats.current.posHits++; stats.current.posCorrect++; }
      } else if (!pressedPos.current) stats.current.posCorrect++;

      setFeedback({
        audio: audioMatch ? (pressedAudio.current ? "hit" : "miss") : (pressedAudio.current ? "miss" : null),
        pos: posMatch ? (pressedPos.current ? "hit" : "miss") : (pressedPos.current ? "miss" : null),
      });
      later(() => setFeedback({ audio: null, pos: null }), Math.min(500, cfg.trialMs / 3));
    }

    if (i >= trials) { endSession(n); return; }

    pressedAudio.current = false;
    pressedPos.current = false;
    setStep(i);
    setActivePos(seq.current.pos[i]);
    speak(seq.current.letters[i], cfg.volume);
    later(() => { if (myGen === gen.current) setActivePos(null); }, Math.max(300, cfg.trialMs * 0.55));
    later(() => runStep(i + 1, n, trials, myGen), cfg.trialMs);
  }, [cfg.trialMs, cfg.volume, endSession]);

  const startSession = useCallback(() => {
    gen.current += 1;
    const myGen = gen.current;
    clearTimers();
    startedAt.current = Date.now();
    seq.current = buildSequences(cfg.trials, cfg.n, cfg.matchRate);
    pressedAudio.current = false;
    pressedPos.current = false;
    stats.current = { audioCorrect: 0, posCorrect: 0, scorable: 0, audioHits: 0, audioTargets: 0, posHits: 0, posTargets: 0 };
    setResult(null);
    setFeedback({ audio: null, pos: null });
    setStep(0);
    setPhase("running");
    runStep(0, cfg.n, cfg.trials, myGen);
  }, [cfg.trials, cfg.n, cfg.matchRate, runStep]);

  // Blitz mounts a panel and expects it to be playing; nothing else auto-starts.
  const startRef = useRef(startSession);
  startRef.current = startSession;
  useEffect(() => { if (autoStart) startRef.current(); }, [autoStart]);

  useEffect(() => () => {
    gen.current += 1;
    clearTimers();
    // Blitz can rotate this panel away mid-utterance; the voice is global and
    // would otherwise keep reading letters for a drill that no longer exists.
    if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
  }, []);

  const hitAudio = useCallback(() => {
    pressedAudio.current = true;
    setFlash(f => ({ ...f, audio: true }));
    setTimeout(() => setFlash(f => ({ ...f, audio: false })), 120);
  }, []);
  const hitPos = useCallback(() => {
    pressedPos.current = true;
    setFlash(f => ({ ...f, pos: true }));
    setTimeout(() => setFlash(f => ({ ...f, pos: false })), 120);
  }, []);

  useGameKeys([cfg.keyAudio], hitAudio, phase === "running");
  useGameKeys([cfg.keyPos], hitPos, phase === "running");

  const settings: Setting[] = [
    { kind: "range", key: "n", label: "N-Back level", min: 1, max: 10 },
    { kind: "range", key: "matchRate", label: "Match rate %", min: 5, max: 60, step: 5, format: v => `${v}%` },
    { kind: "range", key: "trials", label: "Trials", min: 10, max: 60 },
    { kind: "range", key: "trialMs", label: "Trial time", min: 1000, max: 6000, step: 250, format: v => `${(v / 1000).toFixed(2)}s` },
    { kind: "range", key: "threshAdvance", label: "Advance at %", min: 60, max: 95, step: 5 },
    { kind: "range", key: "threshFallback", label: "Fall back below %", min: 30, max: 70, step: 5 },
    { kind: "range", key: "volume", label: "Voice volume", min: 0, max: 100, step: 10 },
    { kind: "key", key: "keyAudio", label: "Audio match key" },
    { kind: "key", key: "keyPos", label: "Position match key" },
  ];

  const cell = px(84);
  const gap = px(8);

  return (
    <GameShell
      title="Dual N-Back" accent={accent} embedded={embedded}
      subtitle={`N = ${cfg.n} · ${cfg.trials} trials · ${(cfg.trialMs / 1000).toFixed(1)}s · ${cfg.matchRate}% matches`}
      phase={phase} onStart={startSession} settings={settings} cfg={cfg} setCfg={setCfg}
      instructions={
        <div style={{ display: "grid", gap: px(6) }}>
          <p>A letter is spoken and a square lights up. Respond when either matches what happened <strong style={{ color: accent }}>{cfg.n} step{cfg.n === 1 ? "" : "s"} back</strong>.</p>
          <p>
            <kbd style={{ padding: `${px(2)}px ${px(6)}px`, borderRadius: px(4), background: "hsl(222 20% 9%)", border: "1px solid hsl(var(--accent-h) 15% 18%)", color: accent }}>{keyLabel(cfg.keyAudio)}</kbd> audio match
            {"  ·  "}
            <kbd style={{ padding: `${px(2)}px ${px(6)}px`, borderRadius: px(4), background: "hsl(222 20% 9%)", border: "1px solid hsl(var(--accent-h) 15% 18%)", color: accent }}>{keyLabel(cfg.keyPos)}</kbd> position match
          </p>
          <p>Staying silent on a non-match counts as a correct answer. N rises past {cfg.threshAdvance}% and falls below {cfg.threshFallback}%.</p>
        </div>
      }
    >
      {phase === "running" && (
        <div className="flex flex-col items-center" style={{ gap: px(16) }}>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(3, ${cell}px)`, gap }}>
            {Array.from({ length: GRID }).map((_, i) => {
              const on = activePos === i;
              return (
                <div
                  key={i}
                  style={{
                    width: cell, height: cell, borderRadius: px(10),
                    background: on ? accent : "hsl(222 20% 8%)",
                    border: `1px solid ${on ? accent : "hsl(var(--accent-h) 15% 14%)"}`,
                    boxShadow: on ? `0 0 ${px(30)}px ${alpha(accent, 0.80)}` : "none",
                    transition: "all 0.12s ease",
                  }}
                />
              );
            })}
          </div>

          <div className="flex items-center justify-between w-full" style={{ maxWidth: cell * 3 + gap * 2 }}>
            <span style={{ color: "hsl(214 20% 38%)", fontFamily: MONO, fontSize: px(10) }}>
              {step + 1} / {cfg.trials}
            </span>
            <div className="flex" style={{ gap: px(14) }}>
              {([["AUDIO", feedback.audio], ["POS", feedback.pos]] as const).map(([label, fb]) => (
                <span key={label} style={{
                  fontFamily: MONO, fontSize: px(10), transition: "color 0.2s",
                  color: fb === "hit" ? "hsl(130 60% 55%)" : fb === "miss" ? "hsl(0 60% 55%)" : "hsl(214 20% 30%)",
                }}>
                  {label} {fb === "hit" ? "✓" : fb === "miss" ? "✗" : "·"}
                </span>
              ))}
            </div>
          </div>

          <div className="flex w-full" style={{ gap: px(10), maxWidth: cell * 3 + gap * 2 }}>
            {([[cfg.keyAudio, "Audio", hitAudio, flash.audio], [cfg.keyPos, "Position", hitPos, flash.pos]] as const).map(([k, label, fn, lit]) => (
              <button
                key={label}
                onPointerDown={fn}
                className="flex-1 rounded-xl font-semibold tracking-widest uppercase transition-all active:scale-95"
                style={{
                  padding: `${px(12)}px 0`, fontSize: px(11), fontFamily: SERIF,
                  background: lit ? `${alpha(accent, 0.45)}` : `${alpha(accent, 0.15)}`,
                  border: `1px solid ${alpha(accent, lit ? 1 : 0.35)}`,
                  color: accent,
                }}
              >
                {label} ({keyLabel(k)})
              </button>
            ))}
          </div>
        </div>
      )}

      {phase === "result" && result && (
        <div
          className="rounded-xl border text-center w-full"
          style={{ background: "hsl(222 20% 5%)", borderColor: `${alpha(accent, 0.30)}`, padding: px(18), maxWidth: px(420) }}
        >
          <p style={{ fontFamily: SERIF, color: "hsl(214 20% 45%)", fontSize: px(11), letterSpacing: "0.15em", textTransform: "uppercase" }}>
            Session Complete
          </p>
          <div className="flex justify-center" style={{ gap: px(34), marginTop: px(14) }}>
            <div>
              <p style={{ color: accent, fontFamily: SERIF, fontSize: px(30), fontWeight: 700 }}>
                {result.scorable ? Math.round(((result.audioCorrect + result.posCorrect) / (result.scorable * 2)) * 100) : 0}%
              </p>
              <p style={{ color: "hsl(214 20% 40%)", fontFamily: MONO, fontSize: px(10) }}>accuracy</p>
            </div>
            <div>
              <p style={{ color: accent, fontFamily: SERIF, fontSize: px(30), fontWeight: 700 }}>{result.nLevel}</p>
              <p style={{ color: "hsl(214 20% 40%)", fontFamily: MONO, fontSize: px(10) }}>next N</p>
            </div>
          </div>
          <p style={{ color: "hsl(214 20% 42%)", fontFamily: MONO, fontSize: px(10), marginTop: px(12) }}>
            audio {result.audioHits}/{result.audioTargets} targets · position {result.posHits}/{result.posTargets} targets
          </p>
        </div>
      )}
    </GameShell>
  );
}
