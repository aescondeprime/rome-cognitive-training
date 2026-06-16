import { useState, useEffect, useRef } from "react";
import type { ActivityProps } from "./shared";
import { SessionProgress } from "./shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const VARIABLE_SETS = [
  { vars: ["HR", "BP", "SpO2", "Temp"], units: ["bpm", "mmHg", "%", "°C"] },
  { vars: ["Task A", "Task B", "Task C", "Task D"], units: ["", "", "", ""] },
  { vars: ["Pt 1", "Pt 2", "Pt 3", "Pt 4"], units: ["bed", "bed", "bed", "bed"] },
];

function randInt(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }

const TOTAL_ROUNDS = 5;

export function SpanTrackActivity({ onTrialComplete, onActivityEnd, difficulty }: ActivityProps) {
  const varSet = VARIABLE_SETS[0];
  const varCount = Math.min(4, Math.max(2, difficulty));
  const vars = varSet.vars.slice(0, varCount);

  const [round, setRound] = useState(0);
  const [phase, setPhase] = useState<"showing" | "quiz">("showing");
  const [values, setValues] = useState<number[]>(() => vars.map(() => randInt(10, 99)));
  const [updates, setUpdates] = useState<Array<{ idx: number; oldVal: number; newVal: number }>>([]);
  const [answers, setAnswers] = useState<string[]>(() => vars.map(() => ""));
  const [feedback, setFeedback] = useState<boolean[] | null>(null);
  const startRef = useRef(Date.now());

  // Show updates one at a time
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (round >= TOTAL_ROUNDS) return;
    const updateCount = Math.min(varCount, Math.max(1, Math.round(difficulty * 0.7)));
    const indices = vars.map((_, i) => i).sort(() => Math.random() - 0.5).slice(0, updateCount);
    const newUpdates = indices.map(i => ({
      idx: i,
      oldVal: values[i],
      newVal: randInt(10, 99),
    }));
    setUpdates(newUpdates);
    setStep(0);
    setPhase("showing");
  }, [round]);

  useEffect(() => {
    if (phase !== "showing") return;
    if (step >= updates.length) {
      const newVals = [...values];
      updates.forEach(u => { newVals[u.idx] = u.newVal; });
      setValues(newVals);
      setTimeout(() => {
        startRef.current = Date.now();
        setAnswers(vars.map(() => ""));
        setFeedback(null);
        setPhase("quiz");
      }, 1200);
      return;
    }
    const t = setTimeout(() => setStep(s => s + 1), 1500);
    return () => clearTimeout(t);
  }, [step, phase, updates]);

  const handleSubmit = () => {
    const fb = values.map((v, i) => answers[i].trim() === String(v));
    setFeedback(fb);
    const rt = Date.now() - startRef.current;
    const correct = fb.every(Boolean);
    onTrialComplete({ correct, responseTimeMs: rt, confidence: 60, difficulty: varCount });
    setTimeout(() => {
      setFeedback(null);
      if (round >= TOTAL_ROUNDS - 1) { onActivityEnd(); return; }
      setRound(r => r + 1);
    }, 1500);
  };

  return (
    <div className="space-y-6">
      <SessionProgress current={round} total={TOTAL_ROUNDS} label="Variable tracking" />

      <div className="bg-card border border-border rounded-lg p-6 space-y-6">
        <p className="text-xs font-mono text-muted-foreground">TRACK ALL VARIABLES · REMEMBER CURRENT VALUES</p>

        {/* Current values display */}
        <div className="grid grid-cols-2 gap-3">
          {vars.map((v, i) => {
            const updating = phase === "showing" && updates[step]?.idx === i;
            const justUpdated = phase === "showing" && updates.slice(0, step).some(u => u.idx === i);
            return (
              <div key={v} className={cn(
                "rounded-lg border p-3 text-center transition-all",
                updating ? "border-amber-400/60 bg-amber-400/10" : justUpdated ? "border-primary/40 bg-primary/10" : "border-border bg-muted/30"
              )}>
                <div className="text-xs text-muted-foreground">{v}</div>
                <div className={cn("font-display font-bold text-xl mt-1", updating ? "text-amber-400" : justUpdated ? "text-primary" : "text-foreground")}>
                  {phase === "showing"
                    ? updating
                      ? updates[step].newVal
                      : justUpdated
                      ? updates.find(u => u.idx === i)?.newVal ?? values[i]
                      : values[i]
                    : "?"
                  }
                </div>
                {varSet.units[i] && <div className="text-xs text-muted-foreground">{varSet.units[i]}</div>}
              </div>
            );
          })}
        </div>

        {phase === "showing" && step < updates.length && (
          <div className="text-center animate-fade-in">
            <p className="text-xs text-amber-400">
              Updating: <strong>{vars[updates[step]?.idx]}</strong> → {updates[step]?.newVal}
            </p>
          </div>
        )}

        {phase === "quiz" && (
          <div className="space-y-4 animate-fade-in">
            <p className="text-xs text-muted-foreground text-center">Report the CURRENT value of each variable:</p>
            {vars.map((v, i) => (
              <div key={v} className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground w-20 shrink-0">{v}</span>
                <Input
                  value={answers[i]}
                  onChange={e => {
                    const a = [...answers]; a[i] = e.target.value; setAnswers(a);
                  }}
                  placeholder="Enter value"
                  className={cn("font-mono", feedback && (feedback[i] ? "border-green-400/50" : "border-rose-400/50"))}
                  data-testid={`span-track-input-${i}`}
                />
                {feedback && (
                  <span className={feedback[i] ? "text-green-400" : "text-rose-400"}>
                    {feedback[i] ? "✓" : `✗ (${values[i]})`}
                  </span>
                )}
              </div>
            ))}
            {!feedback && (
              <Button onClick={handleSubmit} className="w-full" disabled={answers.some(a => !a.trim())} data-testid="span-track-submit">
                Submit Recall
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
