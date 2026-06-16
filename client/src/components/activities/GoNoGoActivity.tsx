import { useState, useEffect, useRef } from "react";
import type { ActivityProps } from "./shared";
import { SessionProgress } from "./shared";
import { cn } from "@/lib/utils";

const TOTAL_TRIALS = 20;
const GO_RATIO = 0.7; // 70% go trials
const DISPLAY_MS = 700;
const ISI_MS = 600; // inter-stimulus interval

export function GoNoGoActivity({ onTrialComplete, onActivityEnd, difficulty }: ActivityProps) {
  const [trial, setTrial] = useState(0);
  const [isGo, setIsGo] = useState(false);
  const [phase, setPhase] = useState<"isi" | "stimulus" | "feedback">("isi");
  const [responded, setResponded] = useState(false);
  const [feedbackCorrect, setFeedbackCorrect] = useState<boolean | null>(null);
  const startRef = useRef(0);
  const trialRef = useRef(0);

  useEffect(() => {
    if (trial >= TOTAL_TRIALS) return;
    // ISI phase
    setPhase("isi");
    setResponded(false);
    setFeedbackCorrect(null);
    const isiDelay = Math.max(300, ISI_MS - difficulty * 40);

    const isiTimer = setTimeout(() => {
      const go = Math.random() < GO_RATIO;
      setIsGo(go);
      setPhase("stimulus");
      startRef.current = Date.now();

      // Auto-end stimulus phase
      const stimTimer = setTimeout(() => {
        if (!responded) {
          // Timed out — if Go, it's a miss
          if (go) {
            setFeedbackCorrect(false);
            onTrialComplete({ correct: false, responseTimeMs: DISPLAY_MS, confidence: 50, difficulty, errorType: "forgetting" });
          } else {
            // No-go + no response = correct
            setFeedbackCorrect(true);
            onTrialComplete({ correct: true, responseTimeMs: DISPLAY_MS, confidence: 50, difficulty });
          }
          setPhase("feedback");
          trialRef.current += 1;
          if (trialRef.current >= TOTAL_TRIALS) setTimeout(() => onActivityEnd(), 600);
          else setTimeout(() => setTrial(t => t + 1), 600);
        }
      }, DISPLAY_MS);

      return () => clearTimeout(stimTimer);
    }, isiDelay);

    return () => clearTimeout(isiTimer);
  }, [trial]);

  const handlePress = () => {
    if (phase !== "stimulus" || responded) return;
    setResponded(true);
    const rt = Date.now() - startRef.current;
    const correct = isGo; // pressing on Go = correct; pressing on NoGo = commission error
    setFeedbackCorrect(correct);
    onTrialComplete({
      correct,
      responseTimeMs: rt,
      confidence: 70,
      difficulty,
      errorType: !correct ? "rushing" : undefined,
    });
    setPhase("feedback");
    trialRef.current += 1;
    if (trialRef.current >= TOTAL_TRIALS) setTimeout(() => onActivityEnd(), 600);
    else setTimeout(() => setTrial(t => t + 1), 600);
  };

  return (
    <div className="space-y-8">
      <SessionProgress current={trial} total={TOTAL_TRIALS} label="Go/No-Go trials" />

      <div
        className="bg-card border border-border rounded-lg p-8 text-center cursor-pointer select-none"
        onClick={handlePress}
        data-testid="gonogo-area"
      >
        <p className="text-xs text-muted-foreground font-mono mb-6">PRESS on GREEN CIRCLE · WITHHOLD on RED CIRCLE</p>

        {phase === "isi" && (
          <div className="h-32 flex items-center justify-center">
            <div className="w-3 h-3 rounded-full bg-muted-foreground/40" />
          </div>
        )}

        {phase === "stimulus" && (
          <div className="h-32 flex items-center justify-center">
            <div
              className={cn("w-28 h-28 rounded-full flex items-center justify-center font-bold text-lg transition-all animate-fade-in", isGo ? "bg-green-400/20 border-2 border-green-400 text-green-400" : "bg-rose-400/20 border-2 border-rose-400 text-rose-400")}
              data-testid={isGo ? "go-signal" : "nogo-signal"}
            >
              {isGo ? "GO" : "NO-GO"}
            </div>
          </div>
        )}

        {phase === "feedback" && (
          <div className="h-32 flex items-center justify-center">
            <div className={cn("text-2xl font-display font-bold", feedbackCorrect ? "text-green-400" : "text-rose-400")}>
              {feedbackCorrect ? "✓" : "✗"}
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground mt-4">Click or tap anywhere to respond</p>
      </div>
    </div>
  );
}
