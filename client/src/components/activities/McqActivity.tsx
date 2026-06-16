import { useState, useRef } from "react";
import type { ActivityProps } from "./shared";
import { ConfidenceSlider, SessionProgress, GENERAL_QUESTIONS } from "./shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Extended interleaved question set with distractors
const MCQ_BANK = [
  {
    q: "Which statement best describes the 'testing effect'?",
    options: ["Frequent tests reduce anxiety", "Active retrieval strengthens memory more than re-studying", "Tests predict future performance", "Multiple choice is more effective than open-ended"],
    answer: 1, domain: "learning",
  },
  {
    q: "What is the primary mechanism behind spaced repetition?",
    options: ["Reduced fatigue", "Increased motivation", "Preventing forgetting before it consolidates", "Building neural pathways through repetition"],
    answer: 2, domain: "learning",
  },
  {
    q: "A patient's SpO2 drops to 88% on room air. Your FIRST action?",
    options: ["Document and monitor", "Apply supplemental oxygen", "Call rapid response immediately", "Obtain ABG"],
    answer: 1, domain: "clinical",
  },
  {
    q: "Which of these is a classic sign of early septic shock?",
    options: ["Hypertension", "Bradycardia", "Hypotension with warm extremities", "Hypothermia alone"],
    answer: 2, domain: "clinical",
  },
  {
    q: "The Stroop task primarily measures which cognitive function?",
    options: ["Working memory capacity", "Long-term memory", "Inhibitory control", "Spatial reasoning"],
    answer: 2, domain: "cognition",
  },
  {
    q: "What does 'far transfer' mean in cognitive training?",
    options: ["Training in a distant location", "Improvement on tasks different from what was trained", "Long-duration transfer effects", "Transfer to athletic performance"],
    answer: 1, domain: "cognition",
  },
  {
    q: "Which of these best describes 'cognitive flexibility'?",
    options: ["Being relaxed in cognitive tasks", "Switching attention and strategy when rules change", "Having a large vocabulary", "Fast processing speed"],
    answer: 1, domain: "cognition",
  },
  {
    q: "In the SM-2 spaced repetition algorithm, what happens when a user rates a recall as '1' (very wrong)?",
    options: ["Interval doubles", "Interval resets to 1 day", "Card is removed", "Interval is unchanged"],
    answer: 1, domain: "learning",
  },
  {
    q: "A patient with suspected PE suddenly becomes hypotensive. Your MOST urgent concern?",
    options: ["Administer anticoagulation", "Massive PE causing obstructive shock", "Anaphylaxis from contrast", "Cardiac tamponade"],
    answer: 1, domain: "clinical",
  },
  {
    q: "According to deliberate practice research, what is the most important feature of effective practice?",
    options: ["High volume of repetition", "Immediate feedback on performance", "Practicing at low difficulty", "Group learning contexts"],
    answer: 1, domain: "learning",
  },
];

const shuffle = <T,>(arr: T[]) => [...arr].sort(() => Math.random() - 0.5);
const TOTAL = 8;

export function McqActivity({ onTrialComplete, onActivityEnd, difficulty }: ActivityProps) {
  const [questions] = useState(() => shuffle(MCQ_BANK).slice(0, TOTAL));
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [phase, setPhase] = useState<"question" | "confidence">("question");
  const [confidence, setConfidence] = useState(65);
  const [correct, setCorrect] = useState<boolean | null>(null);
  const startRef = useRef(Date.now());

  const q = questions[current];

  const handleSelect = (idx: number) => {
    if (phase !== "question") return;
    const rt = Date.now() - startRef.current;
    const isCorrect = idx === q.answer;
    setSelected(idx);
    setCorrect(isCorrect);
    setPhase("confidence");
  };

  const handleNext = () => {
    onTrialComplete({ correct: correct!, responseTimeMs: Date.now() - startRef.current, confidence, difficulty,
      errorType: !correct && confidence > 70 ? "overconfident" : undefined });
    setSelected(null);
    setCorrect(null);
    setConfidence(65);
    if (current >= TOTAL - 1) { onActivityEnd(); return; }
    setCurrent(c => c + 1);
    setPhase("question");
    startRef.current = Date.now();
  };

  return (
    <div className="space-y-6">
      <SessionProgress current={current} total={TOTAL} label="Interleaved MCQ" />

      <div className="bg-card border border-border rounded-lg p-6 space-y-5">
        <div>
          <span className="text-xs font-mono text-muted-foreground">{q?.domain?.toUpperCase()}</span>
          <p className="font-display font-semibold text-foreground mt-1">{q?.q}</p>
        </div>

        {phase === "question" && (
          <div className="space-y-2 animate-fade-in">
            {q?.options.map((opt, i) => (
              <button
                key={i}
                onClick={() => handleSelect(i)}
                data-testid={`mcq-option-${i}`}
                className="w-full text-left py-3 px-4 rounded-lg border border-border text-sm text-foreground hover:border-primary/40 hover:bg-primary/10 hover:text-primary transition-all"
              >
                <span className="font-mono text-xs text-muted-foreground mr-2">{String.fromCharCode(65 + i)}.</span>
                {opt}
              </button>
            ))}
          </div>
        )}

        {phase === "confidence" && (
          <div className="space-y-4 animate-fade-in">
            <div className="space-y-2">
              {q?.options.map((opt, i) => (
                <div
                  key={i}
                  className={cn(
                    "w-full text-left py-3 px-4 rounded-lg border text-sm",
                    i === q.answer && "border-green-400/50 bg-green-400/10 text-green-400",
                    i === selected && i !== q.answer && "border-rose-400/50 bg-rose-400/10 text-rose-400",
                    i !== q.answer && i !== selected && "border-border text-muted-foreground opacity-50"
                  )}
                >
                  <span className="font-mono text-xs mr-2">{String.fromCharCode(65 + i)}.</span>
                  {opt}
                  {i === q.answer && <span className="ml-2 text-xs">✓</span>}
                </div>
              ))}
            </div>
            <ConfidenceSlider value={confidence} onChange={setConfidence} />
            <Button onClick={handleNext} className="w-full" data-testid="mcq-next-btn">
              {current >= TOTAL - 1 ? "Finish" : "Next Question"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
