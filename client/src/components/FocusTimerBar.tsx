/**
 * The focus clock, visible from every node.
 *
 * Same reasoning as the Forge and Recall bars beside it: the cycle outlives the
 * page you started it on, so a clock that only exists inside the Task
 * Stabilizer widget answers "how long do I have?" by making you go and look.
 *
 * It renders nothing when no cycle is running, goes quiet the moment one ends,
 * and shows exactly three things: the task, the time, and — when the clock has
 * run out — the one question that is actually outstanding.
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Pause, Play, Plus, TimerReset, X } from "lucide-react";
import {
  cancelFocus, completeTask, extendFocus, focusStatus, formatRemaining, pauseFocus, resumeFocus,
  IDLE_FOCUS, type FocusStatus,
} from "@/lib/focusSession";

/** One clock for the whole app, ticking once a second. */
export function useFocusStatus(): FocusStatus {
  const { data: activeProfile } = useQuery<{ id: number }>({ queryKey: ["/api/active-profile"] });
  const profileId = activeProfile?.id;
  const [status, setStatus] = useState<FocusStatus>(IDLE_FOCUS);

  useEffect(() => {
    const read = () => setStatus(focusStatus(profileId));
    read();
    const id = window.setInterval(read, 1000);
    window.addEventListener("rome:task-stabilizer:refresh", read);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("rome:task-stabilizer:refresh", read);
    };
  }, [profileId]);

  return status;
}

export default function FocusTimerBar() {
  const { data: activeProfile } = useQuery<{ id: number }>({ queryKey: ["/api/active-profile"] });
  const profileId = activeProfile?.id;
  const status = useFocusStatus();
  if (!status.active) return null;

  const urgent = !status.awaitingAnswer && status.remainingSeconds <= 60;
  const tone = status.awaitingAnswer
    ? "hsl(43 88% 62%)"
    : status.paused ? "hsl(var(--accent-h) 25% 52%)"
    : urgent ? "hsl(12 75% 62%)"
    : "hsl(var(--accent-h) 70% 60%)";

  return (
    <div className="flex items-center gap-2 min-w-0" style={{ fontFamily: "DM Mono, monospace" }}>
      <TimerReset className="w-3 h-3 shrink-0" style={{ color: tone }} />

      {status.awaitingAnswer ? (
        <>
          <span className="text-[10px] tracking-widest uppercase shrink-0" style={{ color: tone }}>
            TIME&apos;S UP · FINISHED?
          </span>
          <BarButton title="Mark it complete" onClick={() => void completeTask(profileId, status.taskId!)}>
            <Check className="w-3 h-3" />
          </BarButton>
          <BarButton title="Ten more minutes" onClick={() => void extendFocus(profileId, 10)}>
            <Plus className="w-3 h-3" />
          </BarButton>
          <BarButton title="End the cycle and leave the task open" onClick={() => void cancelFocus(profileId)}>
            <X className="w-3 h-3" />
          </BarButton>
        </>
      ) : (
        <>
          <span
            className="text-[11px] tabular-nums shrink-0"
            style={{ color: tone, letterSpacing: ".06em" }}
          >
            {formatRemaining(status.remainingSeconds)}
          </span>
          <BarButton
            title={status.paused ? "Resume" : "Pause"}
            onClick={() => (status.paused ? resumeFocus(profileId) : pauseFocus(profileId))}
          >
            {status.paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
          </BarButton>
        </>
      )}

      <span
        className="text-[10px] tracking-wide truncate"
        style={{ color: "hsl(var(--accent-h) 22% 46%)", maxWidth: 180 }}
        title={status.taskName}
      >
        {status.paused && !status.awaitingAnswer ? "paused · " : ""}{status.taskName}
      </span>
    </div>
  );
}

function BarButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="opacity-45 hover:opacity-95 transition-opacity shrink-0"
      style={{ background: "none", border: 0, cursor: "pointer", lineHeight: 0, color: "hsl(var(--accent-h) 55% 58%)" }}
    >
      {children}
    </button>
  );
}
