import { useState } from "react";
import type { ActivityProps } from "./shared";
import { ConfidenceSlider, SessionProgress } from "./shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Plus, X } from "lucide-react";

const CHALLENGES = [
  {
    problem: "Your team needs to train 50 nurses on a new protocol before next week.",
    constraints: ["No budget for outside trainers", "Most nurses work 12-hour shifts", "No more than 15 minutes can come from patient care time"],
    scamperPrompts: ["Substitute: What if peer learning replaced formal training?", "Modify: Could the training be broken into 3-minute micro-modules?", "Eliminate: What's the minimum viable knowledge they actually need?"],
  },
  {
    problem: "Improve patient satisfaction scores with no additional staffing.",
    constraints: ["No new hires", "No overtime budget", "Cannot reduce clinical duties"],
    scamperPrompts: ["Adapt: Borrow from hospitality industry's 'first touch' principles", "Rearrange: What if nurses led check-ins before physicians?", "Combine: Can discharge education happen during routine tasks?"],
  },
  {
    problem: "Design a cognitive training program for ICU nurses that actually gets used.",
    constraints: ["It cannot add more than 5 minutes per shift", "Must be done on existing devices", "Must show measurable results within 30 days"],
    scamperPrompts: ["Substitute: What if gamification replaced formal study?", "Minimize: What's the single highest-ROI skill to train?", "Purpose-shift: Could existing charting workflows become learning moments?"],
  },
  {
    problem: "Reduce medication errors in a busy ICU by 30% within 60 days.",
    constraints: ["Cannot add new software", "Cannot mandate additional training hours", "Solutions must be free"],
    scamperPrompts: ["Adapt: What error-prevention techniques from aviation could apply?", "Reorder: Can verification steps be reorganized?", "Combine: Can two existing checks be merged into one stronger one?"],
  },
];

const shuffle = <T,>(arr: T[]) => [...arr].sort(() => Math.random() - 0.5);
const TOTAL = 2;

export function ConstraintCreativeActivity({ onTrialComplete, onActivityEnd, difficulty }: ActivityProps) {
  const [challenges] = useState(() => shuffle(CHALLENGES).slice(0, TOTAL));
  const [current, setCurrent] = useState(0);
  const [phase, setPhase] = useState<"ideate" | "rate">("ideate");
  const [ideas, setIdeas] = useState<string[]>(["", "", ""]);
  const [confidence, setConfidence] = useState(60);
  const [selectedBest, setSelectedBest] = useState(-1);
  const startRef = { current: Date.now() };

  const c = challenges[current];

  const addIdea = () => setIdeas(i => [...i, ""]);
  const removeIdea = (idx: number) => setIdeas(i => i.filter((_, j) => j !== idx));
  const updateIdea = (idx: number, val: string) => setIdeas(i => { const a = [...i]; a[idx] = val; return a; });

  const handleProceed = () => {
    setPhase("rate");
  };

  const handleRate = (score: number) => {
    const rt = Date.now() - startRef.current;
    const ideaCount = ideas.filter(i => i.trim().length > 0).length;
    const correct = ideaCount >= 2 && selectedBest >= 0;
    onTrialComplete({ correct, responseTimeMs: rt, confidence, difficulty });
    setIdeas(["", "", ""]); setSelectedBest(-1); setConfidence(60);
    if (current >= TOTAL - 1) { onActivityEnd(); return; }
    setCurrent(c => c + 1);
    setPhase("ideate");
    startRef.current = Date.now();
  };

  return (
    <div className="space-y-5">
      <SessionProgress current={current} total={TOTAL} label="Constraint creative" />

      <div className="bg-card border border-border rounded-lg p-6 space-y-5">
        <div>
          <p className="text-xs font-mono text-muted-foreground mb-2">PROBLEM TO SOLVE</p>
          <p className="font-display font-semibold text-foreground">{c?.problem}</p>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-mono text-rose-400">HARD CONSTRAINTS</p>
          {c?.constraints.map((con, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="text-rose-400 mt-0.5">✕</span>
              <span className="text-xs text-foreground">{con}</span>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-mono text-primary">SCAMPER PROMPTS</p>
          {c?.scamperPrompts.map((p, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="text-primary mt-0.5">→</span>
              <span className="text-xs text-muted-foreground">{p}</span>
            </div>
          ))}
        </div>

        {phase === "ideate" && (
          <div className="space-y-3 animate-fade-in">
            <p className="text-xs text-muted-foreground">Generate as many solutions as possible within the constraints:</p>
            {ideas.map((idea, i) => (
              <div key={i} className="flex gap-2">
                <input
                  value={idea}
                  onChange={e => updateIdea(i, e.target.value)}
                  placeholder={`Idea ${i + 1}...`}
                  className="flex-1 bg-muted/50 border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  data-testid={`constraint-idea-${i}`}
                />
                {ideas.length > 1 && (
                  <button onClick={() => removeIdea(i)} className="text-muted-foreground hover:text-foreground">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
            <button onClick={addIdea} className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors">
              <Plus className="w-3 h-3" /> Add idea
            </button>
            <Button onClick={handleProceed} className="w-full" disabled={ideas.filter(i => i.trim()).length < 1} data-testid="constraint-proceed-btn">
              Review & Select Best Idea
            </Button>
          </div>
        )}

        {phase === "rate" && (
          <div className="space-y-4 animate-fade-in">
            <p className="text-xs text-muted-foreground">Which idea would you actually pursue?</p>
            {ideas.filter(i => i.trim()).map((idea, i) => (
              <button
                key={i}
                onClick={() => setSelectedBest(i)}
                className={cn(
                  "w-full text-left p-3 rounded-lg border text-sm transition-all",
                  selectedBest === i ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground hover:border-primary/30"
                )}
              >
                {idea}
              </button>
            ))}
            <ConfidenceSlider value={confidence} onChange={setConfidence} label="How creative/feasible is your best idea?" />
            <Button onClick={() => handleRate(confidence)} className="w-full" disabled={selectedBest < 0} data-testid="constraint-finish-btn">
              {current >= TOTAL - 1 ? "Finish" : "Next Challenge"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
