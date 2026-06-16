import { useState, useEffect, useRef } from "react";
import type { ActivityProps } from "./shared";
import { ConfidenceSlider, SessionProgress, STROOP_STIMULI, COLORS } from "./shared";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const TOTAL_TRIALS = 12;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function StroopActivity({ onTrialComplete, onActivityEnd, difficulty }: ActivityProps) {
  const [trial, setTrial] = useState(0);
  const [stimulus, setStimulus] = useState(STROOP_STIMULI[0]);
  const [phase, setPhase] = useState<"stimulus" | "confidence">("stimulus");
  const [confidence, setConfidence] = useState(70);
  const [lastCorrect, setLastCorrect] = useState<boolean | null>(null);
  const [lastRT, setLastRT] = useState(0);
  const startRef = useRef(Date.now());
  const [shuffled] = useState(() => {
    const stimuli = [];
    for (let i = 0; i < TOTAL_TRIALS; i++) {
      stimuli.push(STROOP_STIMULI[i % STROOP_STIMULI.length]);
    }
    return shuffle(stimuli);
  });

  useEffect(() => {
    setStimulus(shuffled[trial] || STROOP_STIMULI[0]);
    startRef.current = Date.now();
    setPhase("stimulus");
  }, [trial]);

  const handleResponse = (color: string) => {
    const rt = Date.now() - startRef.current;
    const correct = color === stimulus.correct;
    setLastCorrect(correct);
    setLastRT(rt);
    setPhase("confidence");
  };

  const handleConfirmConfidence = () => {
    onTrialComplete({
      correct: lastCorrect!,
      responseTimeMs: lastRT,
      confidence,
      difficulty,
      errorType: !lastCorrect && lastRT < 800 ? "rushing" : undefined,
    });
    setConfidence(70);
    if (trial >= TOTAL_TRIALS - 1) {
      onActivityEnd();
    } else {
      setTrial(t => t + 1);
    }
  };

  return (
    <div className="space-y-8">
      <SessionProgress current={trial} total={TOTAL_TRIALS} label="Stroop trials" />

      {phase === "stimulus" ? (
        <div className="bg-card border border-border rounded-lg p-8 text-center space-y-8">
          <p className="text-xs text-muted-foreground font-mono">RESPOND TO THE INK COLOR — IGNORE THE WORD</p>
          <div
            style={{ color: stimulus.color }}
            className="font-display font-black text-5xl select-none tracking-widest"
            data-testid="stroop-word"
          >
            {stimulus.word}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {COLORS.map(color => (
              <button
                key={color}
                onClick={() => handleResponse(color)}
                data-testid={`stroop-btn-${color}`}
                className={cn(
                  "py-3 px-2 rounded-lg font-bold text-sm uppercase border transition-all hover:scale-105",
                  color === "red" && "border-red-400/40 text-red-400 hover:bg-red-400/10",
                  color === "blue" && "border-blue-400/40 text-blue-400 hover:bg-blue-400/10",
                  color === "green" && "border-green-400/40 text-green-400 hover:bg-green-400/10",
                  color === "yellow" && "border-yellow-400/40 text-yellow-400 hover:bg-yellow-400/10",
                )}
              >
                {color}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg p-8 space-y-6 animate-fade-in">
          <div className={cn("text-center text-lg font-bold", lastCorrect ? "text-green-400" : "text-rose-400")}>
            {lastCorrect ? "✓ Correct" : "✗ Incorrect"} — {lastRT}ms
          </div>
          <ConfidenceSlider value={confidence} onChange={setConfidence} />
          <Button onClick={handleConfirmConfidence} className="w-full" data-testid="confirm-confidence-btn">
            Next Trial
          </Button>
        </div>
      )}
    </div>
  );
}
