import { useState } from "react";
import type { ActivityProps } from "./shared";
import { ConfidenceSlider, SessionProgress, GENERAL_QUESTIONS } from "./shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const shuffle = <T,>(arr: T[]) => [...arr].sort(() => Math.random() - 0.5);
const TOTAL = 10;

export function CalibrationActivity({ onTrialComplete, onActivityEnd, difficulty }: ActivityProps) {
  const [questions] = useState(() => shuffle(GENERAL_QUESTIONS).slice(0, TOTAL));
  const [current, setCurrent] = useState(0);
  const [phase, setPhase] = useState<"question" | "confidence" | "reveal">("question");
  const [answer, setAnswer] = useState("");
  const [confidence, setConfidence] = useState(60);
  const [selfGrade, setSelfGrade] = useState<boolean | null>(null);
  const startRef = { current: Date.now() };

  const q = questions[current];

  const handleAnswer = () => {
    if (!answer.trim()) return;
    setPhase("confidence");
  };

  const handleConfidence = () => {
    setPhase("reveal");
    startRef.current = Date.now();
  };

  const handleGrade = (correct: boolean) => {
    setSelfGrade(correct);
    onTrialComplete({ correct, responseTimeMs: Date.now() - startRef.current, confidence, difficulty });
    setTimeout(() => {
      setAnswer("");
      setConfidence(60);
      setSelfGrade(null);
      if (current >= TOTAL - 1) { onActivityEnd(); return; }
      setCurrent(c => c + 1);
      setPhase("question");
    }, 800);
  };

  return (
    <div className="space-y-6">
      <SessionProgress current={current} total={TOTAL} label="Calibration trials" />

      <div className="bg-card border border-border rounded-lg p-6 space-y-5">
        <div>
          <p className="text-xs font-mono text-muted-foreground mb-2">QUESTION {current + 1}</p>
          <p className="font-display font-semibold text-foreground">{q?.q}</p>
        </div>

        {phase === "question" && (
          <div className="space-y-4 animate-fade-in">
            <textarea
              value={answer}
              onChange={e => setAnswer(e.target.value)}
              placeholder="Type your answer from memory..."
              className="w-full h-24 bg-muted/50 border border-border rounded-md p-3 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              data-testid="calibration-answer-input"
            />
            <Button onClick={handleAnswer} className="w-full" disabled={!answer.trim()}>
              Submit Answer
            </Button>
          </div>
        )}

        {phase === "confidence" && (
          <div className="space-y-4 animate-fade-in">
            <div className="bg-muted/40 border border-border rounded p-3">
              <p className="text-xs text-muted-foreground">Your answer:</p>
              <p className="text-sm text-foreground mt-1">{answer}</p>
            </div>
            <ConfidenceSlider value={confidence} onChange={setConfidence} label="Before seeing the answer: how confident are you?" />
            <Button onClick={handleConfidence} className="w-full">
              Show Answer
            </Button>
          </div>
        )}

        {phase === "reveal" && (
          <div className="space-y-4 animate-fade-in">
            <div className="bg-primary/10 border border-primary/30 rounded p-3">
              <p className="text-xs text-primary font-mono mb-1">CORRECT ANSWER</p>
              <p className="text-sm text-foreground">{q?.a}</p>
            </div>
            <div className="bg-muted/40 border border-border rounded p-3">
              <p className="text-xs text-muted-foreground">Your answer:</p>
              <p className="text-sm text-foreground mt-1">{answer}</p>
            </div>
            <p className="text-xs text-muted-foreground text-center">How well did you do?</p>
            <div className="grid grid-cols-2 gap-3">
              <Button
                onClick={() => handleGrade(false)}
                variant="outline"
                className="border-rose-400/30 text-rose-400 hover:bg-rose-400/10"
              >
                Incorrect / Partial
              </Button>
              <Button
                onClick={() => handleGrade(true)}
                variant="outline"
                className="border-green-400/30 text-green-400 hover:bg-green-400/10"
              >
                Correct / Close
              </Button>
            </div>
            <p className="text-xs text-center text-muted-foreground">
              Confidence: <span className={cn("font-mono", confidence >= 70 ? "text-green-400" : confidence >= 40 ? "text-amber-400" : "text-rose-400")}>{confidence}%</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
