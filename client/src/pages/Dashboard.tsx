import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";
import { Brain, Zap, Target, TrendingUp, Clock, Award, ChevronRight, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DOMAIN_META, ACTIVITIES } from "@/lib/cognitiveData";

export default function Dashboard() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["/api/stats"],
    queryFn: () => apiRequest("GET", "/api/stats").then(r => r.json()),
  });

  const { data: scores = [] } = useQuery({
    queryKey: ["/api/domain-scores"],
    queryFn: () => apiRequest("GET", "/api/domain-scores").then(r => r.json()),
  });

  const { data: dueItems = [] } = useQuery({
    queryKey: ["/api/recall-items/due"],
    queryFn: () => apiRequest("GET", "/api/recall-items/due").then(r => r.json()),
  });

  const allScores = DOMAIN_META.map(d => {
    const found = scores.find((s: any) => s.domain === d.id);
    return { ...d, score: found?.score || 50, trials: found?.totalTrials || 0 };
  });

  const avgScore = allScores.reduce((s, d) => s + d.score, 0) / allScores.length;

  const recommended = ACTIVITIES.slice(0, 3);

  const readiness = avgScore >= 70 ? "High" : avgScore >= 50 ? "Moderate" : "Building";
  const readinessColor = avgScore >= 70 ? "text-green-400" : avgScore >= 50 ? "text-amber-400" : "text-rose-400";

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-roman text-xl font-bold text-gold-300 tracking-widest uppercase">Command Center</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Monday · Cognitive training protocol active</p>
        </div>
        <Link href="/training">
          <Button data-testid="start-session-btn" className="gap-2" size="sm">
            <Zap className="w-4 h-4" />
            Begin Session
          </Button>
        </Link>
      </div>

      {/* Readiness cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Cognitive Readiness"
          value={readiness}
          sub={`${Math.round(avgScore)}/100 composite`}
          icon={<Brain className="w-4 h-4" />}
          valueClass={readinessColor}
        />
        <StatCard
          label="Sessions Done"
          value={stats?.user?.totalSessionsCompleted || 0}
          sub="total training sessions"
          icon={<Award className="w-4 h-4" />}
        />
        <StatCard
          label="Minutes Trained"
          value={stats?.user?.totalMinutesTrained || 0}
          sub="cumulative focused work"
          icon={<Clock className="w-4 h-4" />}
        />
        <StatCard
          label="Due for Review"
          value={dueItems.length}
          sub={dueItems.length > 0 ? "items need spaced recall" : "no items due"}
          icon={<Target className="w-4 h-4" />}
          valueClass={dueItems.length > 0 ? "text-amber-400" : undefined}
        />
      </div>

      {/* Domain radar */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="rome-card rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-semibold text-sm text-foreground">Cognitive Domain Map</h2>
            <Link href="/profile">
              <button className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors">
                Details <ChevronRight className="w-3 h-3" />
              </button>
            </Link>
          </div>
          <div className="space-y-2.5">
            {allScores.map(d => (
              <DomainBar key={d.id} domain={d} />
            ))}
          </div>
        </div>

        <div className="space-y-4">
          {/* Recommended activities */}
          <div className="rome-card rounded-lg p-5">
            <h2 className="font-display font-semibold text-sm text-foreground mb-3">Recommended Today</h2>
            <div className="space-y-2">
              {recommended.map(act => (
                <Link href={`/activity/${act.id}`} key={act.id}>
                  <button
                    data-testid={`recommended-activity-${act.id}`}
                    className="activity-card w-full flex items-center gap-3 p-3 rounded-md border border-border hover:border-primary/30 bg-muted/30 hover:bg-muted/60 text-left transition-all"
                  >
                    <span className="text-xl">{act.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{act.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{act.domain}</p>
                    </div>
                    <span className={cn("text-xs px-2 py-0.5 rounded-full border font-mono", `domain-${act.domain.replace(/\s/g, "_")}`)}>
                      {act.difficulty}
                    </span>
                  </button>
                </Link>
              ))}
            </div>
            <Link href="/training">
              <Button variant="ghost" size="sm" className="w-full mt-3 text-xs text-muted-foreground hover:text-primary">
                View all activities →
              </Button>
            </Link>
          </div>

          {/* Weakness spotlight */}
          {stats?.weakestDomains?.length > 0 && (
            <div className="rome-card rounded-lg border-[hsl(0_52%_28%/0.5)] bg-[hsl(0_55%_8%/0.6)] p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle className="w-4 h-4 text-[hsl(0_48%_52%)]" />
                <span className="text-sm font-roman font-semibold text-[hsl(0_45%_62%)] tracking-wider">Focus Area</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Your lowest domain is <span className="text-amber-400 font-medium">{DOMAIN_META.find(d => d.id === stats.weakestDomains[0]?.domain)?.name ?? stats.weakestDomains[0]?.domain}</span>.
                Target this in your next session for maximum growth.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Science brief — roman border treatment */}
      <div className="rome-card rome-border-top rome-border-bottom rounded-lg px-5 pt-8 pb-7">
        <p className="text-xs font-mono text-gold-500 mb-1">SCIENCE BRIEF</p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Training works best in <strong className="text-foreground">15–25 minute focused sessions</strong> with structured warm-up, core drill, scenario, and reflection phases.
          Evidence from retrieval practice research (Butowska et al., 2024) shows that <strong className="text-foreground">variable retrieval</strong> — processing the same information in slightly different ways — significantly boosts long-term retention beyond standard spaced repetition.
          Your adaptive difficulty adjusts in real time based on accuracy, response time, and confidence calibration.
        </p>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, icon, valueClass }: { label: string; value: any; sub: string; icon: React.ReactNode; valueClass?: string }) {
  return (
    <div className="rome-card rounded-lg p-4">
      <div className="flex items-center gap-2 text-muted-foreground mb-2">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <div className={cn("text-xl font-display font-bold text-foreground", valueClass)}>{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
    </div>
  );
}

function DomainBar({ domain }: { domain: any }) {
  const pct = Math.round(domain.score);
  return (
    <div className="flex items-center gap-3">
      <span className="text-base w-5 text-center">{domain.emoji}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-foreground">{domain.label}</span>
          <span className="text-xs font-mono text-muted-foreground">{pct}</span>
        </div>
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all duration-700", `score-bar-${domain.id}`)}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
