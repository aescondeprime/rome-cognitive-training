/**
 * A live Quantum Recall run, visible from every node.
 *
 * Generation takes minutes on a local model, and the point of moving the
 * session above the router was that you can go and do something else while it
 * happens. That only works if the run is visible from wherever you went and one
 * click from being resumed — otherwise "is it ready yet?" is answered by
 * navigating back, which is the thing this was meant to stop mattering.
 *
 * It sits beside the Forge's job bar in the utility rail, renders nothing when
 * no run exists, and says the one thing worth knowing: whether the passage in
 * front of you is waiting, and how many rounds are written and waiting behind
 * it. The reading clock is deliberately *not* shown here — it is not running
 * while you are elsewhere, and a frozen countdown in the corner would say the
 * opposite.
 */

import { Link } from "wouter";
import { Dices, Loader2 } from "lucide-react";
import { useRecallSessionOptional } from "@/lib/recallSession";

export default function RecallStatusBar() {
  const session = useRecallSessionOptional();
  if (!session || !session.active || session.phase === "loading") return null;

  const waiting = session.phase === "ready" || session.phase === "waiting" || session.phase === "comparing";
  const label = session.phase === "ready"
    ? (session.buffered > 0 ? "READY TO BEGIN" : "WRITING THE FIRST ROUND")
    : session.phase === "waiting" ? "WRITING QUESTIONS"
    : session.phase === "grading" ? "MARKING"
    : session.phase === "summary" ? "RUN COMPLETE"
    : session.phase === "archive" ? "ARCHIVE OPEN"
    : session.phase === "comparing" ? "COMPARING"
    : session.phase === "compare" ? "COMPARISON READY"
    : session.phase === "manual" ? "COMPARING BY HAND"
    : session.round ? "YOUR TURN"
    : "PASSAGE WAITING";

  const tone = session.phase === "summary" ? "hsl(220 12% 45%)"
    : waiting && session.buffered === 0 ? "hsl(43 60% 60%)"
    : "hsl(270 60% 72%)";

  return (
    <Link href="/academia/recall">
      <button
        className="flex min-w-0 items-center gap-2 rounded-sm border px-2 py-1 transition-colors"
        style={{ borderColor: "hsl(270 30% 22%)" }}
        title="Back to the run"
      >
        {waiting && session.buffered === 0
          ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" style={{ color: tone }} />
          : <Dices className="h-3 w-3 shrink-0" style={{ color: tone }} />}
        <div className="min-w-0 text-left">
          <p className="truncate text-[9px] tracking-widest uppercase" style={{ fontFamily: "DM Mono, monospace", color: tone }}>
            {label}
          </p>
          <p className="truncate text-[7px] tracking-widest uppercase" style={{ fontFamily: "DM Mono, monospace", color: "hsl(var(--accent-h) 20% 38%)" }}>
            {session.phase === "comparing" && session.compareProgress
              ? `${session.compareProgress.done}/${session.compareProgress.total} claims`
              : `${session.coverage.seen}/${session.coverage.total} covered`}
            {session.buffered > 0 && session.phase !== "comparing" && ` · ${session.buffered} ready`}
          </p>
        </div>
      </button>
    </Link>
  );
}
