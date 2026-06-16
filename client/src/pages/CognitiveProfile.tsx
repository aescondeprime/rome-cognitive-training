import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { DOMAIN_META } from "@/lib/cognitiveData";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus, AlertCircle, Award, Clock, Zap } from "lucide-react";
import type { DomainScore, Trial, Session, CalibrationHistory } from "@shared/schema";

export default function CognitiveProfile() {
  const { data: scores = [] } = useQuery<DomainScore[]>({
    queryKey: ["/api/domain-scores"],
    queryFn: () => apiRequest("GET", "/api/domain-scores").then(r => r.json()),
  });

  const { data: trials = [] } = useQuery<Trial[]>({
    queryKey: ["/api/trials/recent"],
    queryFn: () => apiRequest("GET", "/api/trials/recent").then(r => r.json()),
  });

  const { data: calibration = [] } = useQuery<CalibrationHistory[]>({
    queryKey: ["/api/calibration"],
    queryFn: () => apiRequest("GET", "/api/calibration").then(r => r.json()),
  });

  const { data: sessions = [] } = useQuery<Session[]>({
    queryKey: ["/api/sessions"],
    queryFn: () => apiRequest("GET", "/api/sessions").then(r => r.json()),
  });

  const { data: user } = useQuery({
    queryKey: ["/api/user"],
    queryFn: () => apiRequest("GET", "/api/user").then(r => r.json()),
  });

  const allDomains = DOMAIN_META.map(d => {
    const found = scores.find(s => s.domain === d.id);
    const domainTrials = trials.filter(t => t.domain === d.id);
    return {
      ...d, score: found?.score || 50, totalTrials: found?.totalTrials || 0,
      avgAccuracy: found?.avgAccuracy || 0, avgConf: found?.avgConfidence || 0, domainTrials,
    };
  });

  const sorted = [...allDomains].sort((a, b) => b.score - a.score);
  const strongest = sorted.slice(0, 2);
  const weakest = sorted.slice(-2).reverse();
  const avgScore = allDomains.reduce((s, d) => s + d.score, 0) / allDomains.length;

  // Calibration insight
  const totalConfTrials = calibration.reduce((s, c) => s + (c.totalCount || 0), 0);
  const avgAccuracyAtHighConf = calibration
    .filter(c => c.confidenceBucket >= 70)
    .reduce((s, c) => s + (c.correctCount || 0), 0) /
    Math.max(1, calibration.filter(c => c.confidenceBucket >= 70).reduce((s, c) => s + (c.totalCount || 0), 0));

  const calibrationBias = avgAccuracyAtHighConf < 0.6
    ? "overconfident"
    : avgAccuracyAtHighConf > 0.9
    ? "underconfident"
    : "well-calibrated";

  // Error patterns
  const errorTypes = trials.filter(t => !t.correct && t.errorType).map(t => t.errorType);
  const errorCounts: Record<string, number> = {};
  errorTypes.forEach(e => { if (e) errorCounts[e] = (errorCounts[e] || 0) + 1; });
  const topError = Object.entries(errorCounts).sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8 animate-fade-in">
      <div>
        <h1 className="font-display text-xl font-bold text-foreground">Cognitive Profile</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Your training history, strengths, and evidence-based growth areas</p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Composite Score", value: Math.round(avgScore), icon: <Award className="w-4 h-4" />, color: avgScore >= 70 ? "text-green-400" : "text-amber-400" },
          { label: "Sessions", value: user?.totalSessionsCompleted || 0, icon: <Zap className="w-4 h-4" />, color: "text-foreground" },
          { label: "Minutes Trained", value: user?.totalMinutesTrained || 0, icon: <Clock className="w-4 h-4" />, color: "text-foreground" },
          { label: "Total Trials", value: trials.length, icon: <TrendingUp className="w-4 h-4" />, color: "text-foreground" },
        ].map(s => (
          <div key={s.label} className="rome-card rounded-lg p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">{s.icon}<span className="text-xs">{s.label}</span></div>
            <div className={cn("font-display font-bold text-2xl", s.color)}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Domain grid */}
      <div className="rome-card rounded-lg p-5">
        <h2 className="font-display font-semibold text-sm text-foreground mb-4">All Cognitive Domains</h2>
        <div className="space-y-4">
          {allDomains.map(d => (
            <div key={d.id} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span>{d.emoji}</span>
                  <span className="text-sm text-foreground">{d.label}</span>
                  <Badge variant="outline" className={cn("text-xs", d.evidenceLevel === "strong" ? "border-green-400/30 text-green-400" : "border-amber-400/30 text-amber-400")}>
                    {d.evidenceLevel}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="font-mono">{d.totalTrials} trials</span>
                  <span className="font-mono font-bold text-foreground">{Math.round(d.score)}</span>
                </div>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all duration-700", `score-bar-${d.id}`)}
                  style={{ width: `${d.score}%` }}
                />
              </div>
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span>Accuracy: {Math.round(d.avgAccuracy)}%</span>
                <span>Avg confidence: {Math.round(d.avgConf)}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Strengths & growth areas */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="rome-card rounded-lg p-5">
          <h3 className="font-display font-semibold text-sm text-foreground mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-green-400" /> Strongest Domains
          </h3>
          {strongest.map(d => (
            <div key={d.id} className="flex items-center gap-3 mb-2">
              <span>{d.emoji}</span>
              <span className="text-sm text-foreground">{d.label}</span>
              <span className="ml-auto font-mono text-sm text-green-400">{Math.round(d.score)}</span>
            </div>
          ))}
        </div>
        <div className="rome-card rounded-lg p-5">
          <h3 className="font-display font-semibold text-sm text-foreground mb-3 flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-amber-400" /> Growth Areas
          </h3>
          {weakest.map(d => (
            <div key={d.id} className="flex items-center gap-3 mb-2">
              <span>{d.emoji}</span>
              <span className="text-sm text-foreground">{d.label}</span>
              <span className="ml-auto font-mono text-sm text-amber-400">{Math.round(d.score)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Calibration */}
      <div className="rome-card rounded-lg p-5 space-y-4">
        <h2 className="font-display font-semibold text-sm text-foreground">Confidence Calibration</h2>
        <div className={cn(
          "p-3 rounded-lg border",
          calibrationBias === "well-calibrated" ? "border-green-400/30 bg-green-400/10"
            : calibrationBias === "overconfident" ? "border-rose-400/30 bg-rose-400/10"
            : "border-blue-400/30 bg-blue-400/10"
        )}>
          <p className={cn("text-sm font-medium",
            calibrationBias === "well-calibrated" ? "text-green-400"
              : calibrationBias === "overconfident" ? "text-rose-400"
              : "text-blue-400"
          )}>
            {calibrationBias === "well-calibrated" && "✓ Well-calibrated"}
            {calibrationBias === "overconfident" && "⚠ Tendency toward overconfidence"}
            {calibrationBias === "underconfident" && "↓ Tendency toward underconfidence"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {calibrationBias === "well-calibrated" && "When you rate high confidence, you're right at a healthy rate. Keep monitoring."}
            {calibrationBias === "overconfident" && `When you report high confidence (≥70%), you're correct only ${Math.round(avgAccuracyAtHighConf * 100)}% of the time. Slow down before committing to high-confidence answers.`}
            {calibrationBias === "underconfident" && "You tend to doubt yourself even when correct. This may indicate imposter syndrome or overly strict self-grading. Trust your knowledge more."}
          </p>
          {totalConfTrials < 10 && (
            <p className="text-xs text-muted-foreground mt-2 opacity-60">Complete more calibration trials for a reliable signal.</p>
          )}
        </div>

        {calibration.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Accuracy vs Confidence (target: matching)</p>
            {[10,20,30,40,50,60,70,80,90,100].map(bucket => {
              const cal = calibration.filter(c => c.confidenceBucket === bucket);
              const total = cal.reduce((s, c) => s + (c.totalCount || 0), 0);
              const correct = cal.reduce((s, c) => s + (c.correctCount || 0), 0);
              if (total === 0) return null;
              const accuracy = correct / total;
              const ideal = bucket / 100;
              const gap = accuracy - ideal;
              return (
                <div key={bucket} className="flex items-center gap-3">
                  <span className="text-xs font-mono text-muted-foreground w-12">{bucket}% conf</span>
                  <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden relative">
                    <div className="h-full bg-primary/20 rounded-full" style={{ width: `${bucket}%` }} />
                    <div className="absolute top-0 left-0 h-full bg-primary rounded-full" style={{ width: `${accuracy * 100}%` }} />
                  </div>
                  <span className={cn("text-xs font-mono w-20 text-right", gap > 0.1 ? "text-green-400" : gap < -0.1 ? "text-rose-400" : "text-muted-foreground")}>
                    {Math.round(accuracy * 100)}% ({total})
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Error pattern diagnosis */}
      {topError && (
        <div className="bg-amber-400/10 border border-amber-400/20 rounded-lg p-5">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="w-4 h-4 text-amber-400" />
            <h3 className="font-display font-semibold text-sm text-foreground">Recurring Error Pattern</h3>
          </div>
          <p className="text-sm text-foreground mb-1">Most common error type: <span className="text-amber-400 font-medium">{topError[0]}</span> ({topError[1]} instances)</p>
          <p className="text-xs text-muted-foreground">
            {topError[0] === "rushing" && "You make more errors when responding very quickly (< 800ms). Practice pausing briefly before committing."}
            {topError[0] === "overthinking" && "Your accuracy drops on slow responses, suggesting doubt undermines correct answers. Trust first instincts more."}
            {topError[0] === "overconfident" && "You rate high confidence on wrong answers repeatedly. Consider your certainty calibration."}
            {topError[0] === "forgetting" && "Missed responses on timed tasks. May indicate working memory load issues. Use chunking strategies."}
            {topError[0] === "poor_retrieval" && "Low recall success. Increase encoding depth: use elaborative interrogation and teach-it-back techniques."}
          </p>
        </div>
      )}
    </div>
  );
}
