import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { ACTIVITIES, DOMAIN_META } from "@/lib/cognitiveData";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowLeft, CheckCircle2, XCircle, Timer, Brain, ChevronRight, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// Activity-specific sub-components
import { NBackActivity } from "@/components/activities/NBackActivity";
import { StroopActivity } from "@/components/activities/StroopActivity";
import { GoNoGoActivity } from "@/components/activities/GoNoGoActivity";
import { CalibrationActivity } from "@/components/activities/CalibrationActivity";
import { PatternActivity } from "@/components/activities/PatternActivity";
import { RecallVaultActivity } from "@/components/activities/RecallVaultActivity";
import { RuleShiftActivity } from "@/components/activities/RuleShiftActivity";
import { TextRecallActivity } from "@/components/activities/TextRecallActivity";
import { McqActivity } from "@/components/activities/McqActivity";
import { SpanTrackActivity } from "@/components/activities/SpanTrackActivity";
import { FermiActivity } from "@/components/activities/FermiActivity";
import { ConstraintCreativeActivity } from "@/components/activities/ConstraintCreativeActivity";

export type TrialResult = {
  correct: boolean;
  responseTimeMs: number;
  confidence: number; // 0-100
  difficulty: number;
  errorType?: string;
};

export default function Activity() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const activity = ACTIVITIES.find(a => a.id === id);
  const domain = activity ? DOMAIN_META.find(d => d.id === activity.domain) : null;

  const [phase, setPhase] = useState<"brief" | "training" | "result">("brief");
  const [sessionResults, setSessionResults] = useState<TrialResult[]>([]);
  const [sessionStart] = useState(Date.now());
  const [reflection, setReflection] = useState("");
  const [prediction, setPrediction] = useState<string | null>(null);

  const trialMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/trials", data).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/domain-scores"] });
    },
  });

  const sessionMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/sessions", data).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
    },
  });

  const handleTrialComplete = useCallback((result: TrialResult) => {
    setSessionResults(prev => [...prev, result]);
    if (!activity) return;
    trialMutation.mutate({
      domain: activity.domain,
      activityId: activity.id,
      correct: result.correct,
      responseTimeMs: result.responseTimeMs,
      confidence: result.confidence,
      difficulty: result.difficulty,
      errorType: result.errorType || null,
    });
  }, [activity]);

  const handleActivityEnd = useCallback(() => {
    setPhase("result");
    if (!activity) return;
    const durationMin = Math.round((Date.now() - sessionStart) / 60000);
    const accuracy = sessionResults.length > 0
      ? (sessionResults.filter(r => r.correct).length / sessionResults.length) * 100
      : 0;
    const avgConf = sessionResults.length > 0
      ? sessionResults.reduce((s, r) => s + r.confidence, 0) / sessionResults.length
      : 0;

    sessionMutation.mutate({
      sessionType: activity.domain,
      durationMinutes: durationMin,
      trialsCompleted: sessionResults.length,
      avgAccuracy: accuracy,
      avgConfidence: avgConf,
    });
  }, [activity, sessionResults, sessionStart]);

  if (!activity || !domain) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">Activity not found.</p>
        <Button variant="ghost" onClick={() => navigate("/training")} className="mt-4">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Training Map
        </Button>
      </div>
    );
  }

  const accuracy = sessionResults.length > 0
    ? Math.round((sessionResults.filter(r => r.correct).length / sessionResults.length) * 100)
    : 0;
  const avgConf = sessionResults.length > 0
    ? Math.round(sessionResults.reduce((s, r) => s + r.confidence, 0) / sessionResults.length)
    : 0;
  const avgRT = sessionResults.length > 0
    ? Math.round(sessionResults.reduce((s, r) => s + r.responseTimeMs, 0) / sessionResults.length)
    : 0;

  // Detect error patterns
  const errors = sessionResults.filter(r => !r.correct);
  const rushErrors = errors.filter(r => r.responseTimeMs < 800).length;
  const confidentErrors = errors.filter(r => r.confidence > 70).length;
  let errorPattern = "";
  if (rushErrors > errors.length * 0.5) errorPattern = "rushing";
  else if (confidentErrors > errors.length * 0.5) errorPattern = "overconfident";
  else if (errors.length > sessionResults.length * 0.5) errorPattern = "weak retrieval";

  return (
    <div className="min-h-screen bg-background grid-bg">
      <div className="max-w-3xl mx-auto p-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <button
            onClick={() => navigate("/training")}
            className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            data-testid="activity-back-btn"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg">{activity.emoji}</span>
              <h1 className="font-display font-bold text-lg text-foreground">{activity.name}</h1>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={cn("text-xs px-2 py-0.5 rounded-full border", `domain-${activity.domain}`)}>
                {domain.label}
              </span>
              <span className="text-xs text-muted-foreground">{activity.difficulty} · ~{activity.durationMin}min</span>
            </div>
          </div>
        </div>

        {/* Phase: Brief */}
        {phase === "brief" && (
          <div className="space-y-6 animate-fade-in">
            <div className="bg-card border border-border rounded-lg p-6 space-y-4">
              <div>
                <h2 className="font-display font-semibold text-sm text-foreground mb-2">What you're training</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">{activity.description}</p>
              </div>
              <div className="border-t border-border pt-4">
                <h2 className="font-display font-semibold text-sm text-foreground mb-2">Instructions</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">{activity.instructions}</p>
              </div>
              <div className="border-t border-border pt-4 bg-primary/5 rounded-md p-3">
                <p className="text-xs font-mono text-primary mb-1">REAL-WORLD TRANSFER</p>
                <p className="text-xs text-muted-foreground">{activity.transferNote}</p>
              </div>
              <div className="border-t border-border pt-4">
                <p className="text-xs font-mono text-muted-foreground mb-1">EVIDENCE BASIS</p>
                <p className="text-xs text-muted-foreground italic">{activity.evidenceBasis}</p>
              </div>
            </div>

            {/* Pre-task metacognition */}
            <div className="bg-card border border-border rounded-lg p-5">
              <h3 className="font-display font-semibold text-sm text-foreground mb-1">Before you begin</h3>
              <p className="text-xs text-muted-foreground mb-3">Metacognitive prediction: How well do you expect to perform? (This builds your calibration awareness.)</p>
              <div className="flex gap-2">
                {["Below average", "Average", "Above average", "Excellent"].map(p => (
                  <button
                    key={p}
                    onClick={() => setPrediction(p)}
                    className={cn(
                      "flex-1 text-xs py-2 px-1 rounded border transition-all",
                      prediction === p
                        ? "border-primary bg-primary/15 text-primary font-semibold"
                        : "border-border hover:border-primary/40 hover:bg-primary/10 hover:text-primary text-muted-foreground"
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <Button
              data-testid="begin-activity-btn"
              onClick={() => setPhase("training")}
              className="w-full gap-2"
              size="lg"
            >
              Begin Training <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}

        {/* Phase: Training */}
        {phase === "training" && (
          <div className="animate-fade-in">
            <ActivityEngine
              activity={activity}
              onTrialComplete={handleTrialComplete}
              onActivityEnd={handleActivityEnd}
              results={sessionResults}
            />
          </div>
        )}

        {/* Phase: Result */}
        {phase === "result" && (
          <div className="space-y-5 animate-fade-in">
            <div className="bg-card border border-border rounded-lg p-6">
              <h2 className="font-display font-bold text-lg text-foreground mb-6">Session Complete</h2>

              <div className="grid grid-cols-3 gap-4 mb-6">
                <ResultStat label="Accuracy" value={`${accuracy}%`} positive={accuracy >= 70} />
                <ResultStat label="Avg Confidence" value={`${avgConf}%`} neutral />
                <ResultStat label="Avg Response" value={`${avgRT}ms`} neutral />
              </div>

              <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-2">
                <div
                  className={cn("h-full rounded-full transition-all duration-700", accuracy >= 70 ? "bg-green-400" : accuracy >= 50 ? "bg-amber-400" : "bg-rose-400")}
                  style={{ width: `${accuracy}%` }}
                />
              </div>

              {errorPattern && (
                <div className="mt-4 p-3 bg-amber-400/10 border border-amber-400/20 rounded-md">
                  <p className="text-xs font-medium text-amber-400">Error Pattern Detected: {errorPattern}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {errorPattern === "rushing" && "You're responding too quickly and making preventable errors. Slow down slightly on uncertain trials."}
                    {errorPattern === "overconfident" && "You rated high confidence on incorrect answers. This is classic overconfidence. Revisit your certainty signals."}
                    {errorPattern === "weak retrieval" && "High error rate overall. Consider reducing difficulty and focusing on strengthening encoding before retrieval."}
                  </p>
                </div>
              )}
            </div>

            {/* Metacognitive reflection */}
            <div className="bg-card border border-border rounded-lg p-5">
              <h3 className="font-display font-semibold text-sm text-foreground mb-2">Reflection</h3>
              <p className="text-xs text-muted-foreground mb-3">What mental strategy did you use? What would you do differently? (Optional — builds metacognitive awareness)</p>
              <textarea
                value={reflection}
                onChange={e => setReflection(e.target.value)}
                placeholder="e.g. I noticed I was rushing when the stimuli changed quickly. Next time I'll pause briefly before responding..."
                className="w-full h-20 bg-muted/50 border border-border rounded-md p-3 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                data-testid="reflection-input"
              />
            </div>

            {/* Science feedback */}
            <div className="bg-muted/30 border border-border rounded-lg p-4">
              <p className="text-xs font-mono text-primary mb-1">TRAINING INSIGHT</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {accuracy >= 80
                  ? "Strong performance. The adaptive system will increase difficulty in your next session to maintain the desirable difficulty needed for learning."
                  : accuracy >= 60
                  ? "Good effort. Errors at this rate are productive — they signal the training is appropriately challenging. The spacing algorithm is calibrating your next review."
                  : "High error rate can indicate: too much difficulty, insufficient encoding time, or new material. Consider trying a lower-difficulty version first."}
              </p>
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => { setPhase("brief"); setSessionResults([]); }}
                className="flex-1 gap-2"
                data-testid="retry-activity-btn"
              >
                <RotateCcw className="w-4 h-4" /> Try Again
              </Button>
              <Button
                onClick={() => navigate("/training")}
                className="flex-1 gap-2"
                data-testid="done-activity-btn"
              >
                <CheckCircle2 className="w-4 h-4" /> Done
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ResultStat({ label, value, positive, neutral }: { label: string; value: string; positive?: boolean; neutral?: boolean }) {
  return (
    <div className="text-center">
      <div className={cn("font-display font-bold text-xl", neutral ? "text-foreground" : positive ? "text-green-400" : "text-rose-400")}>
        {value}
      </div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}

// Routes to correct activity component
function ActivityEngine({ activity, onTrialComplete, onActivityEnd, results }: {
  activity: typeof ACTIVITIES[0];
  onTrialComplete: (r: TrialResult) => void;
  onActivityEnd: () => void;
  results: TrialResult[];
}) {
  const difficulty = Math.min(5, Math.max(1,
    results.length > 0
      ? results.slice(-5).filter(r => r.correct).length >= 4 ? (results[results.length - 1]?.difficulty || 1) + 1 : (results[results.length - 1]?.difficulty || 1)
      : 1
  ));

  const props = { onTrialComplete, onActivityEnd, difficulty };

  switch (activity.type) {
    case "n-back": return <NBackActivity {...props} />;
    case "stroop": return <StroopActivity {...props} />;
    case "go-nogo": return <GoNoGoActivity {...props} />;
    case "calibration": return <CalibrationActivity {...props} />;
    case "pattern": return <PatternActivity {...props} />;
    case "recall-vault": return <RecallVaultActivity {...props} />;
    case "rule-shift": return <RuleShiftActivity {...props} />;
    case "text-recall": return <TextRecallActivity {...props} />;
    case "mcq": return <McqActivity {...props} />;
    case "span-track": return <SpanTrackActivity {...props} />;
    case "fermi": return <FermiActivity {...props} />;
    case "constraint-creative": return <ConstraintCreativeActivity {...props} />;
    default:
      return (
        <div className="text-center py-12">
          <Brain className="w-8 h-8 text-primary mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">Activity coming soon</p>
          <Button onClick={onActivityEnd} variant="ghost" className="mt-4">Complete Session</Button>
        </div>
      );
  }
}
