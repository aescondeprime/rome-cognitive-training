import { useState } from "react";
import { SCENARIOS, DOMAIN_META } from "@/lib/cognitiveData";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ChevronRight, Target, Clock, ArrowLeft, CheckCircle2 } from "lucide-react";

export default function ScenarioDeck() {
  const [selected, setSelected] = useState<typeof SCENARIOS[0] | null>(null);
  const [phase, setPhase] = useState<"select" | "active" | "reflect">("select");
  const [response, setResponse] = useState("");
  const [reflection, setReflection] = useState("");
  const [startTime] = useState(Date.now());

  const sessionMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/sessions", data).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/stats"] }),
  });

  const handleComplete = () => {
    if (!selected) return;
    const mins = Math.round((Date.now() - startTime) / 60000);
    sessionMutation.mutate({
      sessionType: "scenario",
      durationMinutes: mins,
      trialsCompleted: 1,
      avgAccuracy: 75,
      avgConfidence: 65,
      metacogReflection: reflection,
    });
    setPhase("reflect");
  };

  const diffColors: Record<string, string> = {
    Easy: "border-green-400/30 text-green-400",
    Medium: "border-amber-400/30 text-amber-400",
    Hard: "border-[hsl(0_50%_30%/0.6)] text-[hsl(0_45%_58%)] bg-[hsl(0_55%_18%/0.2)]",
  };

  if (phase === "select") {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-8 animate-fade-in">
        <div>
          <h1 className="font-display text-xl font-bold text-foreground">Scenario Deck</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Real-world simulation missions — integrated recall, attention, reasoning, and decision-making</p>
        </div>

        <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
          <p className="text-xs font-mono text-primary mb-1">TRAINING PHILOSOPHY</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Scenarios are the bridge between isolated drills and real-world performance. Each mission forces multiple cognitive systems to work together simultaneously — exactly how performance demands they operate in practice. There are no "correct" answers in many scenarios; the goal is structured reasoning, not memorization.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          {SCENARIOS.map(s => (
            <button
              key={s.id}
              onClick={() => { setSelected(s); setPhase("active"); }}
              data-testid={`scenario-card-${s.id}`}
              className="activity-card bg-card border border-border rounded-lg p-5 text-left space-y-3 w-full"
            >
              <div className="flex items-start justify-between">
                <span className="text-2xl">{s.emoji}</span>
                <Badge variant="outline" className={cn("text-xs", diffColors[s.difficulty])}>
                  {s.difficulty}
                </Badge>
              </div>
              <div>
                <h3 className="font-display font-semibold text-sm text-foreground">{s.title}</h3>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{s.description}</p>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-border">
                <div className="flex flex-wrap gap-1">
                  {s.skills.slice(0, 3).map(skill => (
                    <span key={skill} className={cn("text-xs px-1.5 py-0.5 rounded border", `domain-${skill}`)}>
                      {skill.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="w-3 h-3" /> {s.durationMin}m
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (phase === "active" && selected) {
    return (
      <div className="p-6 max-w-3xl mx-auto grid-bg min-h-screen animate-fade-in">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => setPhase("select")} className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg">{selected.emoji}</span>
              <h1 className="font-display font-bold text-lg text-foreground">{selected.title}</h1>
            </div>
            <p className="text-xs text-muted-foreground">Scenario Mission · {selected.difficulty}</p>
          </div>
        </div>

        <div className="space-y-5">
          <div className="rome-card rounded-lg p-5">
            <p className="text-xs font-mono text-muted-foreground mb-2">CONTEXT: {selected.context.toUpperCase()}</p>
            <pre className="text-sm text-foreground font-sans leading-relaxed whitespace-pre-wrap">{selected.prompt}</pre>
          </div>

          <div className="rome-card rounded-lg p-5 space-y-3">
            <h3 className="font-display font-semibold text-sm text-foreground">Your Response</h3>
            <p className="text-xs text-muted-foreground">Work through this systematically. Use full sentences. Think out loud in writing. You have no time limit — quality {'>'} speed here.</p>
            <textarea
              value={response}
              onChange={e => setResponse(e.target.value)}
              placeholder="Work through the scenario here..."
              className="w-full h-48 bg-muted/50 border border-border rounded-md p-3 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              data-testid="scenario-response-input"
            />
          </div>

          <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
            <p className="text-xs font-mono text-primary mb-1">COGNITIVE SKILLS BEING EXERCISED</p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {selected.skills.map(s => (
                <span key={s} className={cn("text-xs px-2 py-0.5 rounded-full border", `domain-${s}`)}>
                  {s.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          </div>

          <Button
            onClick={handleComplete}
            className="w-full"
            disabled={response.trim().length < 50}
            data-testid="scenario-complete-btn"
          >
            <CheckCircle2 className="w-4 h-4 mr-2" />
            Complete Mission
          </Button>
          {response.trim().length < 50 && (
            <p className="text-xs text-muted-foreground text-center">Write at least 50 characters to complete</p>
          )}
        </div>
      </div>
    );
  }

  if (phase === "reflect" && selected) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-6 animate-fade-in">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 className="w-5 h-5 text-green-400" />
            <h1 className="font-display font-bold text-lg text-foreground">Mission Complete</h1>
          </div>
          <p className="text-sm text-muted-foreground">{selected.title}</p>
        </div>

        <div className="rome-card rounded-lg p-5 space-y-4">
          <h3 className="font-display font-semibold text-sm text-foreground">Metacognitive Debrief</h3>
          <p className="text-xs text-muted-foreground">This is where learning consolidates. Answer briefly:</p>

          {["What mental model did you use to approach this?", "Where did you feel most uncertain?", "What would you do differently with more time?"].map((q, i) => (
            <div key={i}>
              <p className="text-xs font-medium text-foreground mb-1">{q}</p>
              <textarea
                className="w-full h-14 bg-muted/50 border border-border rounded-md p-2.5 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="Your reflection..."
              />
            </div>
          ))}
        </div>

        <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
          <p className="text-xs font-mono text-primary mb-1">SCIENCE NOTE</p>
          <p className="text-xs text-muted-foreground">Scenarios work because they require multiple cognitive systems to operate together, creating interleaved practice across domains. The post-scenario debrief — even when self-guided — significantly improves retention and transfer compared to practice without reflection.</p>
        </div>

        <Button onClick={() => { setPhase("select"); setResponse(""); setReflection(""); }} className="w-full">
          Back to Scenario Deck
        </Button>
      </div>
    );
  }

  return null;
}
