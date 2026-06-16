import { useState, useRef } from "react";
import type { ActivityProps } from "./shared";
import { ConfidenceSlider, SessionProgress } from "./shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PATTERNS = [
  { sequence: [2, 4, 8, 16, "?"], answer: "32", rule: "×2 each step", options: ["24", "32", "20", "64"] },
  { sequence: [1, 3, 6, 10, "?"], answer: "15", rule: "+2, +3, +4, +5...", options: ["12", "15", "14", "16"] },
  { sequence: ["🔴", "🔵", "🔴", "🔵", "?"], answer: "🔴", rule: "Alternating colors", options: ["🔵", "🔴", "🟡", "🟢"] },
  { sequence: [100, 50, 25, 12.5, "?"], answer: "6.25", rule: "÷2 each step", options: ["10", "6.25", "5", "8"] },
  { sequence: ["A", "C", "F", "J", "?"], answer: "O", rule: "+2, +3, +4, +5 letters", options: ["N", "O", "P", "M"] },
  { sequence: [1, 1, 2, 3, 5, "?"], answer: "8", rule: "Fibonacci: each = sum of previous two", options: ["7", "8", "9", "6"] },
  { sequence: [3, 9, 27, 81, "?"], answer: "243", rule: "×3 each step", options: ["162", "243", "270", "324"] },
  { sequence: ["Mon", "Wed", "Fri", "Sun", "?"], answer: "Tue", rule: "Every other day, wrapping", options: ["Mon", "Tue", "Thu", "Sat"] },
  { sequence: [5, 10, 20, 40, "?"], answer: "80", rule: "×2 each step", options: ["60", "80", "70", "75"] },
  { sequence: [4, 9, 16, 25, "?"], answer: "36", rule: "Perfect squares: 2², 3², 4², 5², 6²", options: ["30", "36", "35", "40"] },
];

const shuffle = <T,>(arr: T[]) => [...arr].sort(() => Math.random() - 0.5);

export function PatternActivity({ onTrialComplete, onActivityEnd, difficulty }: ActivityProps) {
  const [questions] = useState(() => shuffle(PATTERNS).slice(0, 8));
  const [current, setCurrent] = useState(0);
  const [phase, setPhase] = useState<"question" | "confidence">("question");
  const [selected, setSelected] = useState<string | null>(null);
  const [confidence, setConfidence] = useState(65);
  const [correct, setCorrect] = useState<boolean | null>(null);
  const startRef = useRef(Date.now());

  const q = questions[current];

  const handleSelect = (option: string) => {
    if (phase !== "question") return;
    const rt = Date.now() - startRef.current;
    const isCorrect = option === q.answer;
    setSelected(option);
    setCorrect(isCorrect);
    setPhase("confidence");
  };

  const handleNext = () => {
    onTrialComplete({ correct: correct!, responseTimeMs: Date.now() - startRef.current, confidence, difficulty });
    setSelected(null);
    setCorrect(null);
    setConfidence(65);
    if (current >= questions.length - 1) { onActivityEnd(); return; }
    setCurrent(c => c + 1);
    setPhase("question");
    startRef.current = Date.now();
  };

  return (
    <div className="space-y-6">
      <SessionProgress current={current} total={questions.length} label="Pattern recognition" />

      <div className="bg-card border border-border rounded-lg p-6 space-y-6">
        <div>
          <p className="text-xs font-mono text-muted-foreground mb-3">FIND THE PATTERN · SELECT NEXT IN SEQUENCE</p>
          <div className="flex items-center gap-3 flex-wrap">
            {q?.sequence.map((s, i) => (
              <div key={i} className={cn(
                "px-4 py-3 rounded-lg border font-display font-bold text-lg text-center min-w-12",
                s === "?" ? "border-primary bg-primary/10 text-primary animate-pulse" : "border-border text-foreground bg-muted/30"
              )}>
                {String(s)}
              </div>
            ))}
          </div>
        </div>

        {phase === "question" && (
          <div className="grid grid-cols-2 gap-3 animate-fade-in">
            {q?.options.map(opt => (
              <button
                key={opt}
                onClick={() => handleSelect(opt)}
                className="py-3 px-4 rounded-lg border border-border text-foreground font-display font-semibold hover:border-primary/40 hover:bg-primary/10 hover:text-primary transition-all"
                data-testid={`pattern-option-${opt}`}
              >
                {opt}
              </button>
            ))}
          </div>
        )}

        {phase === "confidence" && (
          <div className="space-y-4 animate-fade-in">
            <div className={cn("p-3 rounded-lg border", correct ? "border-green-400/30 bg-green-400/10" : "border-rose-400/30 bg-rose-400/10")}>
              <p className={cn("text-sm font-medium", correct ? "text-green-400" : "text-rose-400")}>
                {correct ? "✓ Correct!" : `✗ Incorrect. Answer: ${q?.answer}`}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Rule: {q?.rule}</p>
            </div>
            <ConfidenceSlider value={confidence} onChange={setConfidence} />
            <Button onClick={handleNext} className="w-full" data-testid="pattern-next-btn">
              {current >= questions.length - 1 ? "Finish" : "Next"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
