/**
 * The moon in the top bar.
 *
 * Deliberately not a clock. The focus bar counts down because twenty-five
 * minutes is a thing you pace yourself against; a sleep period is not, and a
 * nine-hour countdown sitting in the chrome is an invitation to keep looking at
 * it. So this says only which state the period is in and when it ends — two
 * facts that do not change second to second.
 *
 * It renders nothing when no period exists, which is nearly always.
 */

import { Moon, MoonStar, AlarmClockOff } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { clockLabel } from "@/lib/sleepSession";
import { useSleepStatus } from "./SleepController";

export default function SleepBar() {
  const { data: activeProfile } = useQuery<{ id: number }>({ queryKey: ["/api/active-profile"] });
  const status = useSleepStatus(activeProfile?.id);
  if (!status.period) return null;

  const ringing = status.phase === "ringing";
  const armed = status.phase === "armed";
  const tone = ringing
    ? "hsl(12 80% 64%)"
    : armed ? "hsl(248 30% 58%)" : "hsl(248 55% 68%)";
  const Icon = ringing ? AlarmClockOff : armed ? Moon : MoonStar;

  return (
    <div className="flex items-center gap-2 min-w-0" style={{ fontFamily: "DM Mono, monospace" }}>
      <Icon className="w-3 h-3 shrink-0" style={{ color: tone }} />
      <span className="text-[10px] tracking-widest uppercase shrink-0" style={{ color: tone }}>
        {ringing ? "Wake" : armed ? "Set" : status.period.label}
      </span>
      <span className="text-[10px] tabular-nums truncate" style={{ color: "hsl(var(--accent-h) 22% 50%)" }}>
        {ringing
          ? "press Tab"
          : armed
            ? `${clockLabel(status.period.startsAt)} → ${clockLabel(status.period.endsAt)}`
            : `until ${clockLabel(status.period.endsAt)}`}
      </span>
    </div>
  );
}
