import { useState, useEffect, useRef } from "react";
import type { ActivityProps } from "./shared";
import { SessionProgress } from "./shared";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// Real-world N-back stimuli
const STIMULI_POOLS = {
  medical: ["Metoprolol 25mg", "SpO2 94%", "K+ 3.2", "BP 88/54", "Heparin drip", "NPO", "Lactulose", "Lasix 40mg", "EKG", "CBC"],
  directions: ["Turn left", "Third floor", "Exit B", "Bay 4", "Main corridor", "Elevator 2", "Lab results", "Room 312", "Stairwell C", "Pharmacy"],
  tasks: ["Chart review", "Vital signs", "Medication pass", "Family call", "Discharge plan", "Wound care", "Consult placed", "Blood draw", "Restraint check", "Pain reassess"],
};

const TOTAL_TRIALS = 15;
const DISPLAY_MS = 2000;

export function NBackActivity({ onTrialComplete, onActivityEnd, difficulty }: ActivityProps) {
  const n = Math.min(3, Math.max(1, difficulty));
  const [sequence, setSequence] = useState<string[]>([]);
  const [trial, setTrial] = useState(0);
  const [phase, setPhase] = useState<"showing" | "respond" | "feedback">("showing");
  const [current, setCurrent] = useState("");
  const [feedbackCorrect, setFeedbackCorrect] = useState<boolean | null>(null);
  const [pool] = useState<"medical" | "directions" | "tasks">(() => {
    const keys = Object.keys(STIMULI_POOLS) as Array<keyof typeof STIMULI_POOLS>;
    return keys[Math.floor(Math.random() * keys.length)];
  });
  const startRef = useRef(Date.now());
  const seqRef = useRef<string[]>([]);

  const pickNext = (seq: string[]) => {
    const pool_items = STIMULI_POOLS[pool];
    // ~30% chance of match
    if (seq.length >= n && Math.random() < 0.3) {
      return seq[seq.length - n];
    }
    let item;
    do { item = pool_items[Math.floor(Math.random() * pool_items.length)]; }
    while (seq.length >= n && item === seq[seq.length - n]);
    return item;
  };

  useEffect(() => {
    if (trial >= TOTAL_TRIALS) { onActivityEnd(); return; }
    const next = pickNext(seqRef.current);
    const newSeq = [...seqRef.current, next];
    seqRef.current = newSeq;
    setSequence(newSeq);
    setCurrent(next);
    setPhase("showing");
    startRef.current = Date.now();
    setFeedbackCorrect(null);

    const showTimer = setTimeout(() => setPhase("respond"), DISPLAY_MS);
    return () => clearTimeout(showTimer);
  }, [trial]);

  const isMatch = sequence.length > n && sequence[sequence.length - 1] === sequence[sequence.length - 1 - n];

  const handleResponse = (matched: boolean) => {
    const rt = Date.now() - startRef.current;
    const correct = matched === isMatch;
    setFeedbackCorrect(correct);
    setPhase("feedback");
    onTrialComplete({ correct, responseTimeMs: rt, confidence: 65, difficulty: n });
    setTimeout(() => setTrial(t => t + 1), 800);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <SessionProgress current={trial} total={TOTAL_TRIALS} label={`${n}-Back (${pool})`} />
        <span className="text-xs font-mono text-primary ml-4 shrink-0">N={n}</span>
      </div>

      <div className="bg-card border border-border rounded-lg p-8 text-center space-y-6">
        <p className="text-xs text-muted-foreground font-mono">Does this match the item from {n} step{n > 1 ? "s" : ""} ago?</p>

        <div className="min-h-20 flex items-center justify-center">
          {phase === "showing" && (
            <div className="animate-fade-in">
              <span className="font-display font-bold text-2xl text-primary">{current}</span>
            </div>
          )}
          {phase === "respond" && (
            <div className="text-lg font-display font-semibold text-foreground">
              Match?
              <p className="text-xs font-mono text-muted-foreground mt-1 font-normal">Item shown: "{current}"</p>
            </div>
          )}
          {phase === "feedback" && (
            <div className={cn("text-2xl font-bold", feedbackCorrect ? "text-green-400" : "text-rose-400")}>
              {feedbackCorrect ? "✓ Correct" : "✗ Incorrect"}
            </div>
          )}
        </div>

        {/* History */}
        <div className="flex flex-wrap gap-1 justify-center">
          {sequence.slice(-6).map((s, i) => (
            <span
              key={i}
              className={cn(
                "text-xs px-2 py-0.5 rounded border",
                i === sequence.slice(-6).length - 1
                  ? "border-primary/50 text-primary bg-primary/10"
                  : i === sequence.slice(-6).length - 1 - n
                  ? "border-amber-400/50 text-amber-400 bg-amber-400/10"
                  : "border-border text-muted-foreground"
              )}
            >
              {s}
            </span>
          ))}
        </div>

        {phase === "respond" && (
          <div className="grid grid-cols-2 gap-4">
            <Button
              onClick={() => handleResponse(true)}
              variant="outline"
              className="border-green-400/30 text-green-400 hover:bg-green-400/10 hover:border-green-400/60"
              data-testid="nback-match-btn"
            >
              MATCH
            </Button>
            <Button
              onClick={() => handleResponse(false)}
              variant="outline"
              className="border-rose-400/30 text-rose-400 hover:bg-rose-400/10 hover:border-rose-400/60"
              data-testid="nback-no-match-btn"
            >
              NO MATCH
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
