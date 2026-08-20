/**
 * Records Athena Trials results into ROME's cognitive training data.
 *
 * Until now the six drills persisted nothing at all — scores lived in component
 * state and vanished on unmount. So the Cognitive Profile, the domain scores,
 * and the calibration history were all fed exclusively by the Activity page,
 * and "how am I doing at Dual N-Back" had no data behind it.
 *
 * The server has no bulk endpoint: `POST /api/trials` takes one trial and folds
 * it into a running domain average plus a confidence bucket. So a finished
 * drill is replayed as individual trials — `correct` ones and then the misses —
 * which produces exactly the same aggregate as having recorded them live,
 * without having to instrument every keystroke in six different games.
 *
 * Everything here is fire-and-forget. A drill must never fail, stall, or show
 * an error because the network hiccuped on the way out.
 */

import { apiRequest } from "@/lib/queryClient";

/** Cognitive domains accepted by POST /api/trials. */
export type CognitiveDomain =
  | "recall"
  | "working_memory"
  | "focus"
  | "flexibility"
  | "problem_solving"
  | "creativity"
  | "intuition"
  | "metacognition";

export interface DrillResult {
  domain: CognitiveDomain;
  /** Stable identifier, e.g. "dual-n-back". */
  activityId: string;
  correct: number;
  total: number;
  /** The drill's own level, mapped into the server's 1-5 difficulty scale. */
  level?: number;
  /** Highest level the drill can reach, used to scale `level`. */
  maxLevel?: number;
  startedAt?: number;
}

/**
 * Cap on replayed trials.
 *
 * Each POST costs three Supabase round trips server-side, so a long drill would
 * otherwise fire a slow burst. Above the cap the ratio is preserved rather than
 * the count — accuracy stays honest, the trial total is understated, and that
 * is the better trade.
 */
const MAX_TRIALS = 40;

/** Drill levels vary wildly in range; the server's difficulty is 1-5. */
function toDifficulty(level?: number, maxLevel?: number): number {
  if (!Number.isFinite(level)) return 2;
  const span = Number.isFinite(maxLevel) && (maxLevel as number) > 1 ? (maxLevel as number) : 10;
  const scaled = Math.round(((level as number) / span) * 5);
  return Math.max(1, Math.min(5, scaled || 1));
}

/**
 * Persist a finished drill.
 *
 * Returns a promise for tests and callers that care, but game code should not
 * await it — the result screen renders immediately either way.
 */
export async function recordDrillResult(result: DrillResult): Promise<void> {
  const total = Math.max(0, Math.round(result.total));
  const correct = Math.max(0, Math.min(total, Math.round(result.correct)));
  if (!total) return;

  const durationMs = result.startedAt ? Math.max(0, Date.now() - result.startedAt) : 0;
  const accuracy = (correct / total) * 100;
  const difficulty = toDifficulty(result.level, result.maxLevel);

  // Scale down proportionally rather than truncating, so a 60-trial drill does
  // not look like it was 40 trials of which the last 20 were never attempted.
  const scale = total > MAX_TRIALS ? MAX_TRIALS / total : 1;
  const postedTotal = Math.max(1, Math.round(total * scale));
  const postedCorrect = Math.round(correct * scale);
  const perTrialMs = postedTotal ? Math.round(durationMs / postedTotal) : 0;

  for (let index = 0; index < postedTotal; index += 1) {
    const wasCorrect = index < postedCorrect;
    try {
      await apiRequest("POST", "/api/trials", {
        domain: result.domain,
        activityId: result.activityId,
        correct: wasCorrect ? 1 : 0,
        responseTimeMs: perTrialMs,
        // The drills never ask how confident you were, so claiming a number
        // would corrupt the calibration history. 50 is the server's neutral
        // default and the honest answer to a question nobody asked.
        confidence: 50,
        difficulty,
        errorType: null,
        notes: null,
      });
    } catch {
      // One lost trial should not abandon the rest.
    }
  }

  try {
    await apiRequest("POST", "/api/sessions", {
      sessionType: "athena",
      durationMinutes: Math.max(0, Math.round(durationMs / 60_000)),
      trialsCompleted: postedTotal,
      avgAccuracy: Math.round(accuracy),
      avgConfidence: 50,
      metacogReflection: null,
    });
  } catch {
    // The trials are already recorded; a missing session row is cosmetic.
  }
}

/** Fire-and-forget wrapper, so a drill's result screen never waits on the network. */
export function recordDrillResultInBackground(result: DrillResult): void {
  void recordDrillResult(result).catch(() => undefined);
}
