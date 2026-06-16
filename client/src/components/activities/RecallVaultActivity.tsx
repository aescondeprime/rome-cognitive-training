import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ActivityProps } from "./shared";
import { SessionProgress } from "./shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BookOpen } from "lucide-react";
import { Link } from "wouter";

export function RecallVaultActivity({ onTrialComplete, onActivityEnd, difficulty }: ActivityProps) {
  const { data: dueItems = [], isLoading } = useQuery({
    queryKey: ["/api/recall-items/due"],
    queryFn: () => apiRequest("GET", "/api/recall-items/due").then(r => r.json()),
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, quality }: { id: number; quality: number }) =>
      apiRequest("PATCH", `/api/recall-items/${id}/review`, { quality }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/recall-items"] }),
  });

  const [current, setCurrent] = useState(0);
  const [phase, setPhase] = useState<"question" | "reveal">("question");
  const [startTime] = useState(Date.now());

  if (isLoading) return <div className="text-center py-8 text-muted-foreground text-sm">Loading your review items...</div>;

  if (dueItems.length === 0) {
    return (
      <div className="bg-card border border-border rounded-lg p-8 text-center space-y-4">
        <BookOpen className="w-10 h-10 text-primary mx-auto" />
        <div>
          <h3 className="font-display font-semibold text-foreground mb-1">No items due for review</h3>
          <p className="text-sm text-muted-foreground">All your recall items are up to date. Add new items in the Memory Vault.</p>
        </div>
        <div className="flex gap-3 justify-center">
          <Link href="/vault">
            <Button variant="outline" size="sm">Go to Memory Vault</Button>
          </Link>
          <Button size="sm" onClick={onActivityEnd}>Done</Button>
        </div>
      </div>
    );
  }

  const item = dueItems[current];
  const total = dueItems.length;

  const handleGrade = (quality: number) => {
    // 0-5: 0=blackout, 2=wrong, 3=barely correct, 4=correct, 5=perfect
    const correct = quality >= 3;
    const rt = Date.now() - startTime;
    reviewMutation.mutate({ id: item.id, quality });
    onTrialComplete({ correct, responseTimeMs: rt / dueItems.length, confidence: quality * 20, difficulty });

    if (current >= total - 1) {
      onActivityEnd();
    } else {
      setCurrent(c => c + 1);
      setPhase("question");
    }
  };

  return (
    <div className="space-y-6">
      <SessionProgress current={current} total={total} label="Spaced recall" />

      <div className="bg-card border border-border rounded-lg p-6 space-y-5 min-h-64">
        <div>
          <p className="text-xs font-mono text-muted-foreground mb-1">{item?.category?.toUpperCase()}</p>
          <p className="font-display font-semibold text-lg text-foreground">{item?.front}</p>
        </div>

        {phase === "question" && (
          <div className="space-y-4 animate-fade-in">
            <p className="text-xs text-muted-foreground">Try to recall the answer completely before revealing it. This effort is what builds memory.</p>
            <Button onClick={() => setPhase("reveal")} variant="outline" className="w-full" data-testid="reveal-answer-btn">
              Reveal Answer
            </Button>
          </div>
        )}

        {phase === "reveal" && (
          <div className="space-y-5 animate-fade-in">
            <div className="bg-primary/10 border border-primary/30 rounded-md p-4">
              <p className="text-xs text-primary font-mono mb-1">ANSWER</p>
              <p className="text-foreground">{item?.back}</p>
            </div>

            <div>
              <p className="text-xs text-muted-foreground text-center mb-3">How well did you recall it?</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Complete blank", sub: "No recall", q: 0, cls: "border-rose-400/40 text-rose-400 hover:bg-rose-400/10" },
                  { label: "Very wrong", sub: "Incorrect with struggle", q: 1, cls: "border-orange-400/40 text-orange-400 hover:bg-orange-400/10" },
                  { label: "Barely recalled", sub: "Correct but very hard", q: 3, cls: "border-amber-400/40 text-amber-400 hover:bg-amber-400/10" },
                  { label: "Perfect recall", sub: "Easy and complete", q: 5, cls: "border-green-400/40 text-green-400 hover:bg-green-400/10" },
                ].map(g => (
                  <button
                    key={g.q}
                    onClick={() => handleGrade(g.q)}
                    data-testid={`recall-grade-${g.q}`}
                    className={cn("py-2.5 px-3 rounded-md border text-left transition-all", g.cls)}
                  >
                    <div className="text-xs font-medium">{g.label}</div>
                    <div className="text-xs opacity-70 mt-0.5">{g.sub}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
