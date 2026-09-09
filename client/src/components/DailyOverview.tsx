/**
 * The daily overview — what you get instead of a snooze button.
 *
 * The alarm stops when Tab is pressed, and the moment it does this is what is
 * on screen: the day ahead and the work already open. It is deliberately the
 * *only* way out of the alarm, so waking up and being told what you are waking
 * up for are the same action rather than two, the second of which never
 * happens.
 *
 * Read-only on purpose. Nothing here can be ticked, started or edited: the
 * first thirty seconds after an alarm is not when anyone makes a good decision
 * about their task list, and a panel that invites one is a panel that gets
 * dismissed unread.
 *
 * ── Sized to the screen, not to a max-width ─────────────────────────────────
 *
 * It takes most of the window — `min(1180px, 88vw)` by `88vh` — because it is
 * the whole screen's job for the thirty seconds it exists, and because the
 * amount to read varies enormously: a day with two things on it and a day with
 * fourteen should not both be shown through the same small window. Past roughly
 * 900px the two sections sit side by side rather than stacked, so a wide monitor
 * shows the day and the work at once instead of one under a scrollbar.
 */

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ListChecks, Sunrise, X } from "lucide-react";
import { KRONOS_TYPE, type ItemType } from "@/lib/kronosTypes";
import { readTasks } from "@/lib/focusSession";
import { apiRequest } from "@/lib/queryClient";

interface TodayItem {
  type: ItemType;
  id: number;
  title: string;
  color: string;
  start_time: string;
  duration_minutes: number;
}

/** "07:00" → "7:00 AM". Kronos stores wall time as a string and never as a Date. */
function timeLabel(value: string): string {
  const [hours, minutes] = String(value ?? "").split(":").map(Number);
  if (!Number.isFinite(hours)) return "";
  const suffix = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes || 0).padStart(2, "0")} ${suffix}`;
}

export function useDailyOverview(profileId: number | undefined) {
  const dateStr = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }, []);

  const { data: schedule = [] } = useQuery<TodayItem[]>({
    queryKey: ["kronos-today", dateStr],
    queryFn: () => apiRequest("GET", `/api/kronos/today?date=${dateStr}`).then(r => r.json()),
    retry: false,
  });

  const tasks = useMemo(
    () => readTasks(profileId).filter(task => !task.completedAt),
    [profileId],
  );

  return { schedule, tasks, dateStr };
}

/**
 * One line, under 240 characters, for Akira to say out loud.
 *
 * Three sentences at most and no lists: `announce` is speech, and a spoken
 * enumeration of nine calendar rows is not a briefing, it is a recitation
 * nobody follows past the third item. The panel behind it carries the detail —
 * this says how much detail there is and what the first thing is.
 */
export function spokenDebrief(schedule: { title: string; start_time: string }[], tasks: { title: string }[]): string[] {
  const hour = new Date().getHours();
  const greeting = hour < 5 ? "It's the middle of the night." : hour < 12 ? "Good morning." : hour < 18 ? "Good afternoon." : "Good evening.";
  const lines = [`${greeting} It's ${new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}.`];

  if (schedule.length === 0) {
    lines.push("Nothing is on the calendar today.");
  } else {
    const first = schedule[0];
    lines.push(
      schedule.length === 1
        ? `One thing today: ${first.title} at ${timeLabel(first.start_time)}.`
        : `${schedule.length} things today. First is ${first.title} at ${timeLabel(first.start_time)}.`,
    );
  }

  if (tasks.length > 0) {
    lines.push(tasks.length === 1
      ? `One task still open: ${tasks[0].title}.`
      : `${tasks.length} tasks still open, starting with ${tasks[0].title}.`);
  }
  return lines.map(line => line.slice(0, 240));
}

export default function DailyOverview({
  profileId, onClose,
}: {
  profileId: number | undefined;
  onClose: () => void;
}) {
  const { schedule, tasks } = useDailyOverview(profileId);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const now = new Date();

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-[3vh]"
      style={{ zIndex: 260, background: "hsl(222 24% 3% / 0.82)", backdropFilter: "blur(18px)" }}
    >
      <div
        className="flex flex-col overflow-hidden"
        style={{
          width: "min(1180px, 88vw)",
          height: "88vh",
          background: "hsl(222 22% 7% / 0.94)",
          border: "1px solid hsl(var(--accent-h) 25% 20% / 0.7)",
          borderRadius: 16,
          boxShadow: "0 30px 90px hsl(222 40% 2% / 0.7)",
        }}
      >
        <header
          className="flex items-center gap-4 shrink-0"
          style={{
            padding: "clamp(14px, 2.2vh, 26px) clamp(18px, 2.6vw, 40px)",
            borderBottom: "1px solid hsl(var(--accent-h) 20% 16% / 0.6)",
          }}
        >
          <Sunrise className="shrink-0" style={{ width: 20, height: 20, color: "hsl(var(--accent-h) 80% 62%)" }} />
          <div className="min-w-0 flex-1">
            <div
              className="tracking-[0.2em] uppercase"
              style={{
                fontFamily: "DM Mono, monospace",
                fontSize: "clamp(11px, 1.5vh, 15px)",
                color: "hsl(var(--accent-h) 70% 62%)",
              }}
            >
              Daily overview
            </div>
            <div
              className="mt-1"
              style={{ fontSize: "clamp(12px, 1.6vh, 17px)", color: "hsl(var(--accent-h) 20% 58%)" }}
            >
              {now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
              {" · "}
              {now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
            </div>
          </div>
          <button
            onClick={onClose}
            title="Close (Esc)"
            className="opacity-40 hover:opacity-90 transition-opacity shrink-0"
            style={{ background: "none", border: 0, cursor: "pointer", lineHeight: 0 }}
          >
            <X style={{ width: 18, height: 18, color: "hsl(var(--accent-h) 40% 60%)" }} />
          </button>
        </header>

        {/* Two columns on anything wide enough for them, stacked otherwise.
            A container query would be the right tool and is not worth a
            dependency here: this element is a fixed fraction of the viewport,
            so the viewport is a faithful proxy for its own width. */}
        <div
          className="flex-1 min-h-0 overflow-y-auto grid gap-x-10 gap-y-7 content-start"
          style={{
            padding: "clamp(16px, 2.6vh, 32px) clamp(18px, 2.6vw, 40px)",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(340px, 100%), 1fr))",
          }}
        >
          <Section icon={<CalendarDays className="w-3.5 h-3.5" />} title="Today" count={schedule.length}>
            {schedule.length === 0 ? (
              <Empty>Nothing on the calendar.</Empty>
            ) : schedule.map(item => (
              <div key={`${item.type}-${item.id}`} className="flex items-baseline gap-3 py-1.5">
                <span
                  className="tabular-nums shrink-0"
                  style={{
                    width: 84,
                    fontFamily: "DM Mono, monospace",
                    fontSize: "clamp(11px, 1.4vh, 14px)",
                    color: "hsl(var(--accent-h) 25% 55%)",
                  }}
                >
                  {timeLabel(item.start_time)}
                </span>
                <span
                  className="rounded-full shrink-0"
                  style={{ width: 7, height: 7, background: item.color || KRONOS_TYPE[item.type]?.color }}
                />
                <span
                  className="min-w-0 truncate"
                  style={{ fontSize: "clamp(13px, 1.8vh, 18px)", color: "hsl(var(--accent-h) 12% 84%)" }}
                >
                  {item.title}
                </span>
              </div>
            ))}
          </Section>

          {/* No `slice` any more. The panel is tall enough to show a real task
              list, and truncating it silently was the old max-height talking. */}
          <Section icon={<ListChecks className="w-3.5 h-3.5" />} title="Open tasks" count={tasks.length}>
            {tasks.length === 0 ? (
              <Empty>Nothing open.</Empty>
            ) : tasks.map(task => (
              <div key={task.id} className="flex items-baseline gap-3 py-1.5">
                <span
                  className="tabular-nums shrink-0"
                  style={{
                    width: 84,
                    fontFamily: "DM Mono, monospace",
                    fontSize: "clamp(11px, 1.4vh, 14px)",
                    color: "hsl(var(--accent-h) 25% 55%)",
                  }}
                >
                  {task.dueDate ?? "—"}
                </span>
                <span
                  className="min-w-0 truncate"
                  style={{ fontSize: "clamp(13px, 1.8vh, 18px)", color: "hsl(var(--accent-h) 12% 84%)" }}
                >
                  {task.title}
                </span>
              </div>
            ))}
          </Section>
        </div>

        <footer
          className="shrink-0 tracking-widest uppercase"
          style={{
            padding: "clamp(10px, 1.4vh, 16px) clamp(18px, 2.6vw, 40px)",
            borderTop: "1px solid hsl(var(--accent-h) 20% 16% / 0.6)",
            fontFamily: "DM Mono, monospace",
            fontSize: "clamp(9px, 1.2vh, 12px)",
            color: "hsl(var(--accent-h) 20% 45%)",
          }}
        >
          Esc to close
        </footer>
      </div>
    </div>
  );
}

function Section({
  icon, title, count, children,
}: {
  icon: React.ReactNode; title: string; count: number; children: React.ReactNode;
}) {
  return (
    <section>
      <div
        className="flex items-center gap-2 mb-3 pb-2 tracking-[0.18em] uppercase"
        style={{
          fontFamily: "DM Mono, monospace",
          fontSize: "clamp(10px, 1.3vh, 13px)",
          color: "hsl(var(--accent-h) 45% 55%)",
          borderBottom: "1px solid hsl(var(--accent-h) 18% 16% / 0.5)",
        }}
      >
        <span style={{ lineHeight: 0 }}>{icon}</span>
        {title}
        <span style={{ color: "hsl(var(--accent-h) 25% 40%)" }}>{count}</span>
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="py-1.5" style={{ fontSize: "clamp(13px, 1.8vh, 18px)", color: "hsl(var(--accent-h) 15% 45%)" }}>{children}</div>
  );
}
