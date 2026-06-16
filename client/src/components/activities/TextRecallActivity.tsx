import { useState } from "react";
import type { ActivityProps } from "./shared";
import { ConfidenceSlider, SessionProgress } from "./shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TOPICS = [
  { topic: "Sepsis: definition and core criteria", context: "Clinical" },
  { topic: "The spacing effect: mechanism and practical implications", context: "Learning Science" },
  { topic: "Working memory: components and capacity limits", context: "Cognitive Psychology" },
  { topic: "SBAR framework for clinical handoff", context: "Clinical Communication" },
  { topic: "The difference between near and far transfer in cognitive training", context: "Cognitive Science" },
  { topic: "Inhibitory control: what it is and why it matters", context: "Executive Function" },
  { topic: "SM-2 spaced repetition algorithm: how it works", context: "Learning Technology" },
  { topic: "Deliberate practice: key principles for skill acquisition", context: "Expertise Research" },
];

const shuffle = <T,>(arr: T[]) => [...arr].sort(() => Math.random() - 0.5);
const TOTAL = 4;

export function TextRecallActivity({ onTrialComplete, onActivityEnd, difficulty }: ActivityProps) {
  const [items] = useState(() => shuffle(TOPICS).slice(0, TOTAL));
  const [current, setCurrent] = useState(0);
  const [phase, setPhase] = useState<"study" | "recall" | "rate">("study");
  const [recall, setRecall] = useState("");
  const [confidence, setConfidence] = useState(60);
  const [selfRating, setSelfRating] = useState<number | null>(null);
  const startRef = { current: Date.now() };

  const item = items[current];

  const handleStartRecall = () => {
    startRef.current = Date.now();
    setPhase("recall");
  };

  const handleSubmitRecall = () => {
    if (!recall.trim()) return;
    setPhase("rate");
  };

  const handleRate = (rating: number) => {
    const correct = rating >= 3;
    setSelfRating(rating);
    onTrialComplete({ correct, responseTimeMs: Date.now() - startRef.current, confidence, difficulty });
    setTimeout(() => {
      setRecall("");
      setConfidence(60);
      setSelfRating(null);
      if (current >= TOTAL - 1) { onActivityEnd(); return; }
      setCurrent(c => c + 1);
      setPhase("study");
    }, 600);
  };

  return (
    <div className="space-y-5">
      <SessionProgress current={current} total={TOTAL} label="Explain from memory" />

      <div className="bg-card border border-border rounded-lg p-6 space-y-5 min-h-72">
        <div className="flex items-center gap-2">
          <span className="text-xs px-2 py-0.5 rounded border border-border text-muted-foreground font-mono">{item?.context}</span>
        </div>

        {phase === "study" && (
          <div className="space-y-4 animate-fade-in">
            <div className="text-center py-4">
              <p className="text-xs text-muted-foreground mb-3">TOPIC TO EXPLAIN FROM MEMORY</p>
              <p className="font-display font-bold text-xl text-foreground">{item?.topic}</p>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Take 10 seconds to gather your thoughts. Then explain everything you know about this topic from memory. Be specific: mechanisms, examples, caveats.
            </p>
            <Button onClick={handleStartRecall} className="w-full" data-testid="start-recall-btn">
              Start Explaining
            </Button>
          </div>
        )}

        {phase === "recall" && (
          <div className="space-y-4 animate-fade-in">
            <p className="font-display font-semibold text-foreground">{item?.topic}</p>
            <p className="text-xs text-muted-foreground">Write everything you know — mechanisms, definitions, examples, edge cases. The more complete, the better the encoding.</p>
            <textarea
              value={recall}
              onChange={e => setRecall(e.target.value)}
              placeholder="Explain from memory here..."
              autoFocus
              className="w-full h-32 bg-muted/50 border border-border rounded-md p-3 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              data-testid="text-recall-input"
            />
            <Button onClick={handleSubmitRecall} className="w-full" disabled={!recall.trim()}>
              Done Explaining
            </Button>
          </div>
        )}

        {phase === "rate" && (
          <div className="space-y-4 animate-fade-in">
            <div className="bg-muted/40 border border-border rounded p-3">
              <p className="text-xs text-muted-foreground mb-1">Your explanation:</p>
              <p className="text-sm text-foreground">{recall}</p>
            </div>
            <ConfidenceSlider value={confidence} onChange={setConfidence} />
            <p className="text-xs text-muted-foreground text-center">How complete and accurate was your explanation?</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Missing key parts", rating: 1, cls: "border-rose-400/40 text-rose-400 hover:bg-rose-400/10" },
                { label: "Some gaps", rating: 2, cls: "border-orange-400/40 text-orange-400 hover:bg-orange-400/10" },
                { label: "Mostly complete", rating: 3, cls: "border-amber-400/40 text-amber-400 hover:bg-amber-400/10" },
                { label: "Thorough & accurate", rating: 5, cls: "border-green-400/40 text-green-400 hover:bg-green-400/10" },
              ].map(r => (
                <button key={r.rating} onClick={() => handleRate(r.rating)}
                  className={cn("py-2.5 px-3 rounded-md border text-sm font-medium transition-all", r.cls)}
                  data-testid={`text-recall-rate-${r.rating}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
