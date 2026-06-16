import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { DOMAIN_META, ACTIVITIES } from "@/lib/cognitiveData";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { ChevronRight, Clock, BarChart2 } from "lucide-react";
import { useState } from "react";

export default function TrainingMap() {
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);

  const { data: scores = [] } = useQuery({
    queryKey: ["/api/domain-scores"],
    queryFn: () => apiRequest("GET", "/api/domain-scores").then(r => r.json()),
  });

  const filteredActivities = selectedDomain
    ? ACTIVITIES.filter(a => a.domain === selectedDomain)
    : ACTIVITIES;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8 animate-fade-in">
      <div>
        <h1 className="font-display text-xl font-bold text-foreground">Athena Trials</h1>
        <p className="text-sm text-muted-foreground mt-0.5">10 cognitive domains · 16 activities · evidence-backed</p>
      </div>

      {/* Domain filters */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setSelectedDomain(null)}
          className={cn(
            "px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
            !selectedDomain ? "bg-primary/15 text-primary border-primary/30" : "text-muted-foreground border-border hover:border-primary/30 hover:text-foreground"
          )}
        >
          All Activities
        </button>
        {DOMAIN_META.map(d => {
          const score = scores.find((s: any) => s.domain === d.id);
          return (
            <button
              key={d.id}
              onClick={() => setSelectedDomain(selectedDomain === d.id ? null : d.id)}
              data-testid={`domain-filter-${d.id}`}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium border transition-all flex items-center gap-1.5",
                selectedDomain === d.id
                  ? `domain-${d.id}`
                  : "text-muted-foreground border-border hover:border-border hover:text-foreground"
              )}
            >
              {d.emoji} {d.label.split(" ")[0]}
              {score && (
                <span className="font-mono">{Math.round(score.score)}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Domain info panel */}
      {selectedDomain && (() => {
        const meta = DOMAIN_META.find(d => d.id === selectedDomain)!;
        const score = scores.find((s: any) => s.domain === selectedDomain);
        return (
          <div className={cn("border rounded-lg p-5 space-y-3", `domain-${selectedDomain}`)}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-2xl">{meta.emoji}</span>
                <div>
                  <h2 className="font-display font-semibold text-sm">{meta.label}</h2>
                  <p className="text-xs opacity-80">{meta.description}</p>
                </div>
              </div>
              {score && (
                <div className="text-right">
                  <div className="font-display font-bold text-lg">{Math.round(score.score)}</div>
                  <div className="text-xs opacity-70">{score.totalTrials} trials</div>
                </div>
              )}
            </div>
            <div className="border-t border-current/20 pt-3">
              <p className="text-xs opacity-75 italic leading-relaxed">{meta.scienceBasis}</p>
            </div>
            {meta.caveat && (
              <div className="text-xs opacity-60 flex items-start gap-1.5">
                <span>⚠️</span>
                <span>{meta.caveat}</span>
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              <span className="text-xs opacity-60 font-medium mr-1">Transfers to:</span>
              {meta.transferTargets.map(t => (
                <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-current/10 opacity-80">{t}</span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium opacity-60">Evidence:</span>
              <Badge variant="outline" className={cn("text-xs", meta.evidenceLevel === "strong" ? "border-green-400/50 text-green-400" : "border-amber-400/50 text-amber-400")}>
                {meta.evidenceLevel === "strong" ? "Strong RCT support" : "Moderate support"}
              </Badge>
            </div>
          </div>
        );
      })()}

      {/* Activity grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filteredActivities.map(act => (
          <ActivityCard key={act.id} activity={act} />
        ))}
      </div>
    </div>
  );
}

function ActivityCard({ activity }: { activity: typeof ACTIVITIES[0] }) {
  const diffColors: Record<string, string> = {
    Easy: "text-green-400 bg-green-400/10 border-green-400/20",
    Medium: "text-amber-400 bg-amber-400/10 border-amber-400/20",
    Hard: "text-[hsl(0_45%_58%)] bg-[hsl(0_55%_20%/0.25)] border-[hsl(0_50%_30%/0.5)]",
    Adaptive: "text-cyan-400 bg-cyan-400/10 border-cyan-400/20",
  };

  return (
    <Link href={`/activity/${activity.id}`}>
      <div
        data-testid={`activity-card-${activity.id}`}
        className="activity-card bg-card border border-border rounded-lg p-4 cursor-pointer h-full flex flex-col"
      >
        <div className="flex items-start justify-between mb-3">
          <span className="text-2xl">{activity.emoji}</span>
          <div className="flex items-center gap-1.5">
            <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium", diffColors[activity.difficulty] || diffColors.Medium)}>
              {activity.difficulty}
            </span>
          </div>
        </div>
        <div className="flex-1">
          <h3 className="font-display font-semibold text-sm text-foreground mb-1">{activity.name}</h3>
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{activity.description}</p>
        </div>
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
          <div className="flex items-center gap-3">
            <span className={cn("text-xs px-1.5 py-0.5 rounded border", `domain-${activity.domain}`)}>
              {activity.domain.replace(/_/g, " ")}
            </span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" />
              {activity.durationMin}m
            </span>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </div>
      </div>
    </Link>
  );
}
