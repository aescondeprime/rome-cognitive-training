import { useState } from "react";
import { useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Brain, Target, FlaskConical, ArrowRight, CheckCircle2 } from "lucide-react";

const GOALS = [
  { id: "focus", label: "Sharpen focus & attention" },
  { id: "memory", label: "Improve working memory" },
  { id: "clinical", label: "Clinical decision-making" },
  { id: "creativity", label: "Creative problem-solving" },
  { id: "metacognition", label: "Self-awareness & calibration" },
  { id: "flexibility", label: "Cognitive flexibility" },
];

const MODES = [
  { id: "study", label: "Study Mode", desc: "Optimized for learning retention" },
  { id: "clinical", label: "Clinical Mode", desc: "MICU, triage, SBAR scenarios" },
  { id: "leadership", label: "Leadership Mode", desc: "Decision-making under pressure" },
  { id: "creative", label: "Creative Mode", desc: "Divergent thinking challenges" },
];

type Step = 0 | 1 | 2 | 3;

export default function Onboarding() {
  const [, navigate] = useHashLocation();
  const [step, setStep] = useState<Step>(0);
  const [name, setName] = useState("");
  const [selectedGoals, setSelectedGoals] = useState<string[]>([]);
  const [preferredMode, setPreferredMode] = useState("study");

  const updateUser = useMutation({
    mutationFn: async (data: { name: string; preferredMode: string }) => {
      await apiRequest("PATCH", "/api/user", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      navigate("/");
    },
  });

  const toggleGoal = (id: string) => {
    setSelectedGoals((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]
    );
  };

  const handleFinish = () => {
    updateUser.mutate({ name: name.trim() || "Trainee", preferredMode });
  };

  const canAdvanceStep0 = name.trim().length > 0;
  const canAdvanceStep1 = selectedGoals.length > 0;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[hsl(var(--domain-recall)/0.15)] border border-[hsl(var(--domain-recall)/0.3)] mb-5">
            <Brain className="w-8 h-8 text-[hsl(var(--domain-recall))]" />
          </div>
          <h1 className="text-3xl font-display font-bold tracking-tight text-foreground mb-2">
            Welcome to ROME
          </h1>
          <p className="text-muted-foreground text-sm">
            A cognitive training lab built on current neuroscience evidence.
          </p>
        </div>

        {/* Progress dots */}
        <div className="flex justify-center gap-2 mb-10">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === step
                  ? "w-6 bg-[hsl(var(--domain-recall))]"
                  : i < step
                  ? "w-3 bg-[hsl(var(--domain-recall)/0.5)]"
                  : "w-3 bg-border"
              }`}
            />
          ))}
        </div>

        {/* Step 0 — Name */}
        {step === 0 && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div>
              <h2 className="text-xl font-semibold text-foreground mb-1">What should we call you?</h2>
              <p className="text-sm text-muted-foreground">Used only for your local profile.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="name" className="text-sm font-medium">Name or nickname</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Alex"
                className="bg-card border-border text-foreground placeholder:text-muted-foreground"
                onKeyDown={(e) => e.key === "Enter" && canAdvanceStep0 && setStep(1)}
                autoFocus
              />
            </div>
            <Button
              className="w-full"
              onClick={() => setStep(1)}
              disabled={!canAdvanceStep0}
            >
              Continue <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        )}

        {/* Step 1 — Goals */}
        {step === 1 && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div>
              <h2 className="text-xl font-semibold text-foreground mb-1">What are your training goals?</h2>
              <p className="text-sm text-muted-foreground">Select all that apply. These shape your recommended activities.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {GOALS.map((goal) => {
                const selected = selectedGoals.includes(goal.id);
                return (
                  <button
                    key={goal.id}
                    onClick={() => toggleGoal(goal.id)}
                    className={`flex items-center gap-3 p-3 rounded-xl border text-left text-sm font-medium transition-all duration-150 ${
                      selected
                        ? "border-[hsl(var(--domain-recall))] bg-[hsl(var(--domain-recall)/0.1)] text-foreground"
                        : "border-border bg-card text-muted-foreground hover:border-[hsl(var(--domain-recall)/0.4)] hover:text-foreground"
                    }`}
                  >
                    {selected && (
                      <CheckCircle2 className="w-4 h-4 text-[hsl(var(--domain-recall))] flex-shrink-0" />
                    )}
                    {!selected && (
                      <div className="w-4 h-4 rounded-full border border-border flex-shrink-0" />
                    )}
                    {goal.label}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setStep(0)}>
                Back
              </Button>
              <Button className="flex-1" onClick={() => setStep(2)} disabled={!canAdvanceStep1}>
                Continue <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 2 — Mode */}
        {step === 2 && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div>
              <h2 className="text-xl font-semibold text-foreground mb-1">Choose your default training mode</h2>
              <p className="text-sm text-muted-foreground">You can switch modes anytime in Settings.</p>
            </div>
            <div className="space-y-3">
              {MODES.map((mode) => {
                const selected = preferredMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    onClick={() => setPreferredMode(mode.id)}
                    className={`w-full flex items-start gap-4 p-4 rounded-xl border text-left transition-all duration-150 ${
                      selected
                        ? "border-[hsl(var(--domain-recall))] bg-[hsl(var(--domain-recall)/0.08)]"
                        : "border-border bg-card hover:border-[hsl(var(--domain-recall)/0.4)]"
                    }`}
                  >
                    <div className={`w-4 h-4 mt-0.5 rounded-full border-2 flex-shrink-0 transition-colors ${
                      selected ? "border-[hsl(var(--domain-recall))] bg-[hsl(var(--domain-recall))]" : "border-border"
                    }`} />
                    <div>
                      <p className="font-semibold text-sm text-foreground">{mode.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{mode.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button className="flex-1" onClick={() => setStep(3)}>
                Continue <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 3 — Ready */}
        {step === 3 && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300 text-center">
            <div className="space-y-4">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[hsl(var(--domain-recall)/0.15)] border border-[hsl(var(--domain-recall)/0.3)]">
                <Target className="w-8 h-8 text-[hsl(var(--domain-recall))]" />
              </div>
              <h2 className="text-xl font-semibold text-foreground">
                You're set, {name.trim() || "Trainee"}.
              </h2>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                Your training lab is configured. Sessions are 15–25 minutes. Progress is saved locally.
                Evidence labels mark which features are research-backed versus speculative.
              </p>
            </div>

            <div className="bg-card border border-border rounded-xl p-4 text-left space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                <FlaskConical className="w-3.5 h-3.5" />
                Scientific note
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Cognitive training research shows near-transfer reliably; far-transfer
                (real-world skill improvement) requires deliberate integration with
                meaningful practice. Use this app as a supplement to real clinical and
                study work, not a replacement.
              </p>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button
                className="flex-1"
                onClick={handleFinish}
                disabled={updateUser.isPending}
              >
                {updateUser.isPending ? "Setting up…" : "Enter ROME"}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
