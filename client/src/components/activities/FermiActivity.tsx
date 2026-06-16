import { useState } from "react";
import type { ActivityProps } from "./shared";
import { ConfidenceSlider, SessionProgress } from "./shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const FERMI_QUESTIONS = [
  {
    q: "How many heartbeats does the average person have in a lifetime?",
    hint: "Average resting HR × minutes/day × 365 × lifespan",
    rangeLow: 2_000_000_000, rangeHigh: 3_500_000_000,
    display: "~2.5 billion",
    solution: "~70 bpm × 60 min × 24h × 365 days × 80 years ≈ 2.9 billion",
  },
  {
    q: "How many hospital beds are there in the United States?",
    hint: "US population × hospital beds per capita",
    rangeLow: 800_000, rangeHigh: 1_000_000,
    display: "~900,000",
    solution: "~330M population, roughly 2.9 beds per 1000 people → ~920,000 beds",
  },
  {
    q: "Estimate the number of nursing shifts worked in a US hospital per year.",
    hint: "Average hospital size × shifts/day × 365",
    rangeLow: 50_000, rangeHigh: 200_000,
    display: "~100,000 shifts/year for a 250-bed hospital",
    solution: "250 beds × 4 nurses/10 beds × 3 shifts × 365 days ≈ 109,500 shifts",
  },
  {
    q: "How many words does a person read in a lifetime of dedicated reading?",
    hint: "Reading speed × pages/day × days reading × years",
    rangeLow: 500_000_000, rangeHigh: 2_000_000_000,
    display: "~1 billion words",
    solution: "250 wpm × 60 min/day × 365 × 50 years ≈ 274 million pages; or ~1 billion words",
  },
  {
    q: "How many decision points does an ICU nurse encounter in a 12-hour shift?",
    hint: "Assessments + medication events + communication events + documentation",
    rangeLow: 200, rangeHigh: 1_000,
    display: "~400-800 decision points",
    solution: "~30 assessments/patient × 4 patients + ~100 medication events + ~50 communication points ≈ 500+ decisions",
  },
];

const shuffle = <T,>(arr: T[]) => [...arr].sort(() => Math.random() - 0.5);
const TOTAL = 3;

export function FermiActivity({ onTrialComplete, onActivityEnd, difficulty }: ActivityProps) {
  const [questions] = useState(() => shuffle(FERMI_QUESTIONS).slice(0, TOTAL));
  const [current, setCurrent] = useState(0);
  const [phase, setPhase] = useState<"reason" | "estimate" | "reveal">("reason");
  const [reasoning, setReasoning] = useState("");
  const [estimate, setEstimate] = useState("");
  const [confidence, setConfidence] = useState(55);
  const startRef = { current: Date.now() };

  const q = questions[current];

  const isInRange = (val: string, low: number, high: number) => {
    const num = parseFloat(val.replace(/[^0-9.eE+\-]/g, ""));
    if (isNaN(num)) return false;
    return num >= low * 0.1 && num <= high * 10; // 10x tolerance
  };

  const handleReveal = () => {
    const rt = Date.now() - startRef.current;
    const correct = isInRange(estimate, q.rangeLow, q.rangeHigh);
    onTrialComplete({ correct, responseTimeMs: rt, confidence, difficulty });
    setPhase("reveal");
  };

  const handleNext = () => {
    setReasoning(""); setEstimate(""); setConfidence(55);
    if (current >= TOTAL - 1) { onActivityEnd(); return; }
    setCurrent(c => c + 1);
    setPhase("reason");
    startRef.current = Date.now();
  };

  const correct = isInRange(estimate, q?.rangeLow, q?.rangeHigh);

  return (
    <div className="space-y-5">
      <SessionProgress current={current} total={TOTAL} label="Fermi estimation" />

      <div className="bg-card border border-border rounded-lg p-6 space-y-5">
        <div>
          <p className="text-xs font-mono text-muted-foreground mb-2">FIRST-PRINCIPLES ESTIMATION</p>
          <p className="font-display font-semibold text-lg text-foreground">{q?.q}</p>
          <p className="text-xs text-muted-foreground mt-2">Hint: {q?.hint}</p>
        </div>

        {(phase === "reason" || phase === "estimate") && (
          <div className="space-y-4 animate-fade-in">
            <div>
              <label className="text-xs text-muted-foreground">Break it down — your reasoning:</label>
              <textarea
                value={reasoning}
                onChange={e => setReasoning(e.target.value)}
                placeholder="Step 1: Start with something you know... Step 2: ..."
                className="w-full h-24 bg-muted/50 border border-border rounded-md p-3 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary mt-1"
                data-testid="fermi-reasoning-input"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Your final estimate (number):</label>
              <input
                value={estimate}
                onChange={e => setEstimate(e.target.value)}
                placeholder="e.g. 2500000000 or 2.5e9"
                className="w-full bg-muted/50 border border-border rounded-md px-3 py-2 text-sm text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary mt-1"
                data-testid="fermi-estimate-input"
              />
            </div>
            <ConfidenceSlider value={confidence} onChange={setConfidence} />
            <Button onClick={handleReveal} className="w-full" disabled={!estimate.trim()} data-testid="fermi-reveal-btn">
              Compare to Answer
            </Button>
          </div>
        )}

        {phase === "reveal" && (
          <div className="space-y-4 animate-fade-in">
            <div className={cn("p-4 rounded-lg border", correct ? "border-green-400/30 bg-green-400/10" : "border-amber-400/30 bg-amber-400/10")}>
              <p className={cn("text-sm font-bold mb-1", correct ? "text-green-400" : "text-amber-400")}>
                {correct ? "✓ Within reasonable range!" : "📊 Off the range — good learning moment"}
              </p>
              <p className="text-sm text-foreground">Accepted range: {q?.rangeLow.toLocaleString()} – {q?.rangeHigh.toLocaleString()}</p>
              <p className="text-sm text-muted-foreground mt-1"><strong className="text-foreground">Ballpark:</strong> {q?.display}</p>
            </div>
            <div className="bg-muted/30 border border-border rounded p-3">
              <p className="text-xs text-muted-foreground mb-1">SOLUTION WALKTHROUGH</p>
              <p className="text-xs text-foreground">{q?.solution}</p>
            </div>
            <Button onClick={handleNext} className="w-full" data-testid="fermi-next-btn">
              {current >= TOTAL - 1 ? "Finish" : "Next Estimate"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
