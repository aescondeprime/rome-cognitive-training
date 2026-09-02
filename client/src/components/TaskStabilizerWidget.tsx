/**
 * TaskStabilizerWidget — the particle-accelerator focus queue.
 *
 * Tasks are profile-specific and live in localStorage so they survive app
 * upgrades. Three things reach outside this file:
 *
 * • **Focus cycles** create a matching Kronos assignment while the timer runs,
 *   and update or remove it when the cycle finishes or is cancelled.
 * • **Due dates** put a task on a day in Kronos Keep, which is also what puts
 *   it in Apple Calendar once that sync is wired. One task owns at most one
 *   dated Kronos row (`kronosItemId`); changing the date moves that row rather
 *   than leaving a trail of copies behind.
 * • **Checking a task off** banks its credit in the Capability ledger that the
 *   MIDAS dashboard reads. Un-checking it takes the credit back — a counter
 *   that only goes up measures elapsed time, not capability.
 *
 * Ordering is the array's own order and is dragged by the grip on each row.
 * Note that `activeTasks` is a *filtered view*: a drop index in that list is
 * not an index into `tasks`, so every reorder resolves both ends by id.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronUp, CircleStop, Clock3, GripVertical, Plus, RotateCcw, TimerReset, Trash2, X } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import {
  addEntry, loadCapability, notifyCapabilityChanged, removeEntryForTask, saveCapability,
} from "@/lib/capabilityStore";
import {
  widgetRootStyle,
  useWidgetFit,
  useWidgetWheelScale,
  useWidgetYield,
  widgetYieldStyle,
  WidgetScaleHandle,
  WidgetPinButton,
  type FocusRect,
} from "./WidgetChrome";

interface FocusTimer {
  startedAt: number;
  durationSeconds: number;
  kronosAssignmentId: number | null;
}

interface StabilizerTask {
  id: string;
  title: string;
  createdAt: number;
  completedAt: number | null;
  timer: FocusTimer | null;
  /** "YYYY-MM-DD", or null for undated. Mirrored into Kronos when set. */
  dueDate: string | null;
  /** The Kronos assignment this task's due date owns, if any. */
  kronosItemId: number | null;
  /** What finishing this task is worth in the Capability ledger. */
  credit: number;
}

interface Props {
  pos: { x: number; y: number } | null;
  collapsed: boolean;
  onPosChange: (p: { x: number; y: number }) => void;
  onCollapsedChange: (c: boolean) => void;
  /** Uniform scale and the editor's resize affordances. See `WidgetChrome`. */
  scale?: number;
  editing?: boolean;
  onScaleChange?: (scale: number) => void;
  /** Set while the camera has flown to a node; `focus` is the space it claims. */
  zoomed?: boolean;
  focus?: FocusRect | null;
  /** Pinned widgets stay on screen away from the constellation. */
  pinned?: boolean;
  onPinnedChange?: (pinned: boolean) => void;
}

interface Calendar { id: number; name: string }

const W = 286;
const PRESETS = [5, 15, 25, 45, 60];
const DEFAULT_CREDIT = 10;

function storageKey(profileId: number | undefined) {
  return `rome_task_stabilizer_v1:${profileId ?? "default"}`;
}

/**
 * Read and normalise.
 *
 * Tasks written before due dates and credit existed are missing those fields
 * entirely, so every read backfills them. Without this, `task.credit` is
 * `undefined`, `clampCredit` turns that into 0, and every task you had before
 * today silently becomes worth nothing.
 */
function readTasks(profileId: number | undefined): StabilizerTask[] {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(profileId)) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.map((t: any): StabilizerTask => ({
      id: String(t?.id ?? crypto.randomUUID()),
      title: String(t?.title ?? ""),
      createdAt: Number(t?.createdAt) || Date.now(),
      completedAt: t?.completedAt ?? null,
      timer: t?.timer ?? null,
      dueDate: typeof t?.dueDate === "string" && t.dueDate ? t.dueDate : null,
      kronosItemId: typeof t?.kronosItemId === "number" ? t.kronosItemId : null,
      credit: Number.isFinite(Number(t?.credit)) ? Math.max(0, Math.round(Number(t.credit))) : DEFAULT_CREDIT,
    }));
  } catch {
    return [];
  }
}

function localDateStr(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localTimeStr(date = new Date()) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatRemaining(seconds: number) {
  const safe = Math.max(0, seconds);
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function Corner() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" style={{ opacity: 0.72, flexShrink: 0 }}>
      <path d="M2 13V2h11" stroke="hsl(var(--accent-h) var(--accent-s) var(--accent-l))" strokeWidth="1.4" />
      <circle cx="2" cy="2" r="1.2" fill="hsl(var(--accent-h) var(--accent-s) var(--accent-l))" />
    </svg>
  );
}

function Accelerator({ progress, active }: { progress: number; active: boolean }) {
  const radius = 31;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg width="82" height="82" viewBox="0 0 82 82" aria-hidden="true">
      <defs>
        <filter id="stabilizerGlow"><feGaussianBlur stdDeviation="2.6" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      {Array.from({ length: 16 }, (_, i) => {
        const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
        return <line key={i} x1={41 + Math.cos(a) * 35} y1={41 + Math.sin(a) * 35} x2={41 + Math.cos(a) * 38} y2={41 + Math.sin(a) * 38} stroke="hsl(var(--accent-h) 35% 34%)" strokeWidth="1" />;
      })}
      <circle cx="41" cy="41" r={radius} fill="none" stroke="hsl(var(--accent-h) 22% 17%)" strokeWidth="5" />
      <circle cx="41" cy="41" r={radius} fill="none" stroke="hsl(var(--accent-h) 88% 62%)" strokeWidth="2.6"
        strokeDasharray={circumference} strokeDashoffset={circumference * (1 - progress)} strokeLinecap="round"
        transform="rotate(-90 41 41)" filter="url(#stabilizerGlow)" style={{ transition: "stroke-dashoffset 0.8s linear" }} />
      <ellipse cx="41" cy="41" rx="21" ry="8" fill="none" stroke="hsl(195 82% 62% / .5)" strokeWidth="1" transform="rotate(-24 41 41)" />
      <ellipse cx="41" cy="41" rx="21" ry="8" fill="none" stroke="hsl(var(--accent-h) 82% 62% / .55)" strokeWidth="1" transform="rotate(24 41 41)" />
      <circle cx="41" cy="41" r={active ? 5 : 3.5} fill={active ? "hsl(var(--accent-h) 92% 72%)" : "hsl(var(--accent-h) 42% 42%)"}
        style={{ filter: active ? "drop-shadow(0 0 8px hsl(var(--accent-h) 90% 65%))" : undefined, transition: "all .25s" }} />
    </svg>
  );
}

export default function TaskStabilizerWidget({ pos, collapsed, onPosChange, onCollapsedChange, scale = 1, editing = false, onScaleChange, zoomed = false, focus = null, pinned = false, onPinnedChange }: Props) {
  const { data: activeProfile } = useQuery<{ id: number }>({ queryKey: ["/api/active-profile"] });
  const { data: calendars = [] } = useQuery<Calendar[]>({
    queryKey: ["/kronos/calendars"],
    queryFn: () => apiRequest("GET", "/api/kronos/calendars").then(r => r.json()),
  });
  const qc = useQueryClient();
  const profileId = activeProfile?.id;
  const [tasks, setTasks] = useState<StabilizerTask[]>(() => readTasks(profileId));
  const [title, setTitle] = useState("");
  const [credit, setCredit] = useState(DEFAULT_CREDIT);
  const [timerTaskId, setTimerTaskId] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(25);
  const [now, setNow] = useState(Date.now());
  const [syncing, setSyncing] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const skipNextPersist = useRef(false);

  const x = pos?.x ?? 24;
  const y = pos?.y ?? 80;

  // Editor sizing and keep-on-screen. Scale is a transform, not a re-layout —
  // see the note at the top of `WidgetChrome`. `useWidgetFit` is what stops a
  // widget saved on a larger display from sitting past the edge of this one.
  const rootRef = useRef<HTMLDivElement>(null);
  const onWheelScale = useWidgetWheelScale(editing, scale, onScaleChange);
  useWidgetFit(rootRef, x, y, onPosChange, [scale, collapsed]);
  // Selecting a node flies it to screen centre, straight under any widget
  // parked there. Yielding is a fade, not a move — see `useWidgetYield`.
  const yielding = useWidgetYield(rootRef, zoomed, focus, [x, y, scale, collapsed]);

  useEffect(() => {
    skipNextPersist.current = true;
    setTasks(readTasks(profileId));
  }, [profileId]);
  useEffect(() => {
    const refresh = () => {
      skipNextPersist.current = true;
      setTasks(readTasks(profileId));
    };
    window.addEventListener("rome:task-stabilizer:refresh", refresh);
    return () => window.removeEventListener("rome:task-stabilizer:refresh", refresh);
  }, [profileId]);
  useEffect(() => {
    if (profileId === undefined) return;
    if (skipNextPersist.current) {
      skipNextPersist.current = false;
      return;
    }
    localStorage.setItem(storageKey(profileId), JSON.stringify(tasks));
  }, [profileId, tasks]);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const running = tasks.find(task => task.timer && !task.completedAt) ?? null;
  const elapsed = running?.timer ? Math.max(0, Math.floor((now - running.timer.startedAt) / 1000)) : 0;
  const remaining = running?.timer ? Math.max(0, running.timer.durationSeconds - elapsed) : 0;
  const progress = running?.timer ? Math.min(1, elapsed / running.timer.durationSeconds) : 0;

  const patchTask = useCallback((id: string, patch: Partial<StabilizerTask>) => {
    setTasks(old => old.map(t => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const ensureCalendar = useCallback(async () => {
    if (calendars[0]) return calendars[0];
    const response = await apiRequest("POST", "/api/kronos/calendars", { name: "My Calendar" });
    const calendar = await response.json() as Calendar;
    await qc.invalidateQueries({ queryKey: ["/kronos/calendars"] });
    return calendar;
  }, [calendars, qc]);

  const refreshKronos = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["kronos-today"] });
    qc.invalidateQueries({ queryKey: ["/kronos"] });
  }, [qc]);

  // ── Capability ledger ────────────────────────────────────────────────────
  //
  // Read-modify-write against localStorage rather than holding the ledger in
  // React state: the MIDAS dashboard owns its own copy, and the event tells it
  // to re-read. Two writers, one file, no shared state to get out of step.
  const bankCredit = useCallback((task: StabilizerTask) => {
    const next = addEntry(loadCapability(profileId), task.title, task.credit, "stabilizer", task.id);
    saveCapability(profileId, next);
    notifyCapabilityChanged();
  }, [profileId]);

  const refundCredit = useCallback((taskId: string) => {
    const next = removeEntryForTask(loadCapability(profileId), taskId);
    saveCapability(profileId, next);
    notifyCapabilityChanged();
  }, [profileId]);

  // ── Due dates ────────────────────────────────────────────────────────────
  //
  // The task owns one Kronos row. Setting a date creates it, changing the date
  // moves it, clearing the date deletes it. Anything else and a task nudged
  // across three days leaves two ghosts on the calendar.
  const setDueDate = useCallback(async (task: StabilizerTask, value: string) => {
    const next = value || null;
    patchTask(task.id, { dueDate: next });
    try {
      if (!next) {
        if (task.kronosItemId) {
          await apiRequest("DELETE", `/api/kronos/assignments/${task.kronosItemId}`);
          patchTask(task.id, { kronosItemId: null });
        }
      } else if (task.kronosItemId) {
        await apiRequest("PATCH", `/api/kronos/assignments/${task.kronosItemId}`, { due_date: next });
      } else {
        const calendar = await ensureCalendar();
        const response = await apiRequest("POST", `/api/kronos/calendars/${calendar.id}/assignments`, {
          title: task.title,
          color: "hsl(195 60% 55%)",
          start_time: "09:00",
          duration_minutes: 30,
          due_date: next,
          instructions: "Planned from the Task Stabilizer",
          saved: false,
        });
        const created = await response.json();
        patchTask(task.id, { kronosItemId: created?.id ?? null });
      }
      refreshKronos();
    } catch {
      // The date stays set locally. Kronos catches up next time it is touched,
      // and a widget that refused to remember a date because the server blinked
      // would be worse than one that is briefly out of step with the calendar.
    }
  }, [ensureCalendar, patchTask, refreshKronos]);

  const completeTask = useCallback(async (task: StabilizerTask, actualSeconds?: number) => {
    const timer = task.timer;
    const seconds = actualSeconds ?? (timer ? Math.max(1, Math.floor((Date.now() - timer.startedAt) / 1000)) : 0);
    setTasks(old => old.map(item => item.id === task.id ? { ...item, completedAt: Date.now(), timer: null } : item));
    bankCredit(task);
    if (timer?.kronosAssignmentId) {
      try {
        await apiRequest("PATCH", `/api/kronos/assignments/${timer.kronosAssignmentId}`, {
          duration_minutes: Math.max(1, Math.ceil(seconds / 60)),
          instructions: `Completed through Task Stabilizer · ${Math.max(1, Math.ceil(seconds / 60))} minute focus cycle`,
        });
        refreshKronos();
      } catch { /* task completion remains local if calendar sync is temporarily unavailable */ }
    }
  }, [bankCredit, refreshKronos]);

  const restoreTask = useCallback((task: StabilizerTask) => {
    setTasks(old => old.map(item => item.id === task.id ? { ...item, completedAt: null } : item));
    refundCredit(task.id);
  }, [refundCredit]);

  const deleteTask = useCallback(async (task: StabilizerTask) => {
    setTasks(old => old.filter(item => item.id !== task.id));
    refundCredit(task.id);
    if (task.kronosItemId) {
      try {
        await apiRequest("DELETE", `/api/kronos/assignments/${task.kronosItemId}`);
        refreshKronos();
      } catch {}
    }
  }, [refundCredit, refreshKronos]);

  useEffect(() => {
    if (running?.timer && remaining === 0 && elapsed > 0) void completeTask(running, running.timer.durationSeconds);
  }, [running?.id, running?.timer?.startedAt, remaining, elapsed, completeTask]);

  const addTask = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setTasks(old => [{
      id: crypto.randomUUID(), title: trimmed, createdAt: Date.now(),
      completedAt: null, timer: null, dueDate: null, kronosItemId: null,
      credit: Math.max(0, Math.round(credit)),
    }, ...old]);
    setTitle("");
    setCredit(DEFAULT_CREDIT);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const launchTimer = async () => {
    const task = tasks.find(item => item.id === timerTaskId);
    if (!task || running || minutes < 1) return;
    setSyncing(true);
    let assignmentId: number | null = null;
    try {
      const calendar = await ensureCalendar();
      const response = await apiRequest("POST", `/api/kronos/calendars/${calendar.id}/assignments`, {
        title: task.title,
        color: "hsl(43 88% 60%)",
        start_time: localTimeStr(),
        duration_minutes: minutes,
        due_date: localDateStr(),
        instructions: `Task Stabilizer focus cycle · planned ${minutes} minutes`,
        saved: false,
      });
      const assignment = await response.json();
      assignmentId = assignment.id;
      refreshKronos();
    } catch { /* timer remains usable offline */ }
    setTasks(old => old.map(item => item.id === task.id ? {
      ...item,
      completedAt: null,
      timer: { startedAt: Date.now(), durationSeconds: minutes * 60, kronosAssignmentId: assignmentId },
    } : item));
    setTimerTaskId(null);
    setSyncing(false);
  };

  const cancelTimer = async () => {
    if (!running?.timer) return;
    const assignmentId = running.timer.kronosAssignmentId;
    setTasks(old => old.map(item => item.id === running.id ? { ...item, timer: null } : item));
    if (assignmentId) {
      try {
        await apiRequest("DELETE", `/api/kronos/assignments/${assignmentId}`);
        refreshKronos();
      } catch {}
    }
  };

  // ── Reorder ──────────────────────────────────────────────────────────────
  //
  // Both ends resolved by id against the full array, because the list on
  // screen is `activeTasks` — a filter — and its indices mean nothing here.
  const moveTask = useCallback((fromId: string, toId: string) => {
    if (fromId === toId) return;
    setTasks(old => {
      const from = old.findIndex(t => t.id === fromId);
      const to = old.findIndex(t => t.id === toId);
      if (from < 0 || to < 0 || from === to) return old;
      const next = old.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  const dragging = useRef(false);
  const dragOffset = useRef({ dx: 0, dy: 0 });
  const onMouseDown = useCallback((event: React.MouseEvent) => {
    if ((event.target as HTMLElement).closest("[data-nodrag]")) return;
    event.preventDefault();
    dragging.current = true;
    dragOffset.current = { dx: event.clientX - x, dy: event.clientY - y };
    const move = (e: MouseEvent) => {
      if (!dragging.current) return;
      onPosChange({
        x: Math.max(0, Math.min(window.innerWidth - W, e.clientX - dragOffset.current.dx)),
        y: Math.max(0, Math.min(window.innerHeight - 60, e.clientY - dragOffset.current.dy)),
      });
    };
    const up = () => { dragging.current = false; window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }, [x, y, onPosChange]);

  const activeTasks = useMemo(() => tasks.filter(task => !task.completedAt), [tasks]);
  const completedTasks = useMemo(() => tasks.filter(task => task.completedAt), [tasks]);
  const queuedCredit = useMemo(() => activeTasks.reduce((s, t) => s + t.credit, 0), [activeTasks]);

  return (
    <div
      ref={rootRef}
      onMouseDown={onMouseDown}
      onWheel={editing ? onWheelScale : undefined}
      style={widgetRootStyle(x, y, W, scale, widgetYieldStyle(yielding))}
    >
      {editing && <WidgetScaleHandle scale={scale} onScaleChange={onScaleChange} width={W} />}
      <div className={`rome-widget-shell${editing ? " is-editing" : ""}${zoomed ? " is-zoomed" : ""}`}>
        <div
          className={collapsed ? undefined : "rome-widget-rule"}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 10px" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <Corner />
            <span style={{ fontSize: 9, letterSpacing: ".2em", color: "hsl(var(--accent-h) 86% 66%)", textTransform: "uppercase" }}>Task Stabilizer</span>
            <span style={{ fontSize: 7, color: "hsl(var(--accent-h) 30% 40%)" }} title={`${queuedCredit} credit queued`}>{activeTasks.length} ACTIVE</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 1 }}>
          <WidgetPinButton pinned={pinned} onPinnedChange={onPinnedChange} />
          <button data-nodrag onClick={() => onCollapsedChange(!collapsed)} style={{ border: 0, background: "none", color: "hsl(var(--accent-h) 50% 50%)", cursor: "pointer", padding: 2 }}><ChevronUp size={13} style={{ transform: collapsed ? "rotate(180deg)" : undefined }} /></button>
          </div>
        </div>

        {!collapsed && <div style={{ padding: 10 }} data-nodrag>
          <div style={{ display: "grid", gridTemplateColumns: "82px 1fr", gap: 9, alignItems: "center", padding: "5px 4px 10px" }}>
            <Accelerator progress={progress} active={Boolean(running)} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 7, color: "hsl(var(--accent-h) 35% 43%)", letterSpacing: ".18em", textTransform: "uppercase" }}>{running ? "Beam locked" : "Accelerator idle"}</div>
              <div style={{ fontSize: running ? 22 : 11, color: "hsl(var(--accent-h) 85% 72%)", marginTop: 3, lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{running ? formatRemaining(remaining) : "Select a task"}</div>
              {running && <div title={running.title} style={{ fontSize: 9, color: "hsl(220 12% 62%)", marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{running.title}</div>}
              {running && <div style={{ display: "flex", gap: 5, marginTop: 7 }}>
                <button onClick={() => void completeTask(running)} style={miniButton("hsl(145 58% 54%)")}><Check size={11} /> Finish</button>
                <button onClick={() => void cancelTimer()} style={miniButton("hsl(0 58% 58%)")}><CircleStop size={11} /> Cancel</button>
              </div>}
            </div>
          </div>

          <div style={{ display: "flex", gap: 5, marginBottom: 8 }}>
            <input ref={inputRef} value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addTask(); }} placeholder="Add a stabilized task…" style={{ flex: 1, minWidth: 0, background: "hsl(222 20% 5%)", border: "1px solid hsl(var(--accent-h) 22% 20%)", color: "hsl(220 14% 78%)", borderRadius: 2, padding: "7px 8px", outline: "none", font: "9px DM Mono, monospace" }} />
            <input type="number" min={0} max={10000} value={credit} onChange={e => setCredit(Math.max(0, Math.min(10000, Number(e.target.value))))} onKeyDown={e => { if (e.key === "Enter") addTask(); }} title="Credit this task is worth when you check it off"
              style={{ width: 40, background: "hsl(222 20% 5%)", border: "1px solid hsl(var(--accent-h) 22% 20%)", color: "hsl(var(--accent-h) 70% 62%)", borderRadius: 2, padding: "7px 4px", outline: "none", font: "9px DM Mono, monospace", textAlign: "center" }} />
            <button onClick={addTask} disabled={!title.trim()} style={{ width: 30, borderRadius: 2, border: "1px solid hsl(var(--accent-h) 52% 36%)", background: "hsl(var(--accent-h) 42% 13%)", color: "hsl(var(--accent-h) 88% 70%)", opacity: title.trim() ? 1 : .35, cursor: "pointer" }}><Plus size={13} /></button>
          </div>

          <div style={{ maxHeight: 250, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
            {activeTasks.map(task => (
              <TaskRow key={task.id} task={task} running={running?.id === task.id}
                dragActive={dragId === task.id}
                onDragStart={() => setDragId(task.id)}
                onDragEnd={() => setDragId(null)}
                onDropOn={() => { if (dragId) moveTask(dragId, task.id); setDragId(null); }}
                onTimer={() => { setTimerTaskId(task.id); setMinutes(25); }}
                onComplete={() => void completeTask(task, 0)}
                onDelete={() => void deleteTask(task)}
                onDue={value => void setDueDate(task, value)}
                onCredit={value => patchTask(task.id, { credit: value })} />
            ))}
            {activeTasks.length === 0 && <div style={{ padding: "12px 8px", textAlign: "center", fontSize: 8, color: "hsl(var(--accent-h) 20% 34%)", letterSpacing: ".14em" }}>QUEUE STABLE · NO TASKS</div>}
            {completedTasks.slice(0, 4).map(task => (
              <TaskRow key={task.id} task={task} running={false}
                dragActive={false}
                onDragStart={() => {}} onDragEnd={() => {}} onDropOn={() => {}}
                onTimer={() => { restoreTask(task); setTimerTaskId(task.id); }}
                onComplete={() => restoreTask(task)}
                onDelete={() => void deleteTask(task)}
                onDue={value => void setDueDate(task, value)}
                onCredit={value => patchTask(task.id, { credit: value })} />
            ))}
          </div>
        </div>}
      </div>

      {timerTaskId && !running && (
        <div data-nodrag style={{ position: "absolute", left: 0, top: collapsed ? 34 : "calc(100% + 7px)", width: W, background: "hsl(222 20% 6% / .98)", border: "1px solid hsl(var(--accent-h) 45% 28%)", boxShadow: "0 12px 34px hsl(222 40% 2% / .8)", padding: 11, cursor: "default" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 9 }}><span style={{ fontSize: 8, letterSpacing: ".18em", color: "hsl(var(--accent-h) 75% 64%)" }}>FOCUS CYCLE</span><button onClick={() => setTimerTaskId(null)} style={iconButton}><X size={12} /></button></div>
          <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>{PRESETS.map(value => <button key={value} onClick={() => setMinutes(value)} style={{ flex: 1, padding: "5px 0", borderRadius: 2, border: `1px solid ${minutes === value ? "hsl(var(--accent-h) 65% 44%)" : "hsl(220 16% 17%)"}`, background: minutes === value ? "hsl(var(--accent-h) 40% 14%)" : "hsl(222 18% 8%)", color: minutes === value ? "hsl(var(--accent-h) 86% 70%)" : "hsl(220 12% 45%)", font: "8px DM Mono, monospace", cursor: "pointer" }}>{value}m</button>)}</div>
          <div style={{ display: "flex", gap: 6 }}><input type="number" min={1} max={480} value={minutes} onChange={e => setMinutes(Math.max(1, Math.min(480, Number(e.target.value))))} style={{ width: 58, background: "hsl(222 20% 5%)", border: "1px solid hsl(220 16% 18%)", color: "hsl(220 12% 72%)", padding: "6px", font: "9px DM Mono, monospace" }} /><button disabled={syncing} onClick={() => void launchTimer()} style={{ flex: 1, border: "1px solid hsl(var(--accent-h) 60% 38%)", background: "linear-gradient(90deg, hsl(var(--accent-h) 45% 13%), hsl(195 38% 12%))", color: "hsl(var(--accent-h) 88% 72%)", font: "9px DM Mono, monospace", letterSpacing: ".12em", cursor: "pointer" }}><TimerReset size={11} style={{ display: "inline", marginRight: 6 }} />{syncing ? "SYNCING…" : "LAUNCH & ADD TO KRONOS"}</button></div>
        </div>
      )}
    </div>
  );
}

function TaskRow({ task, running, dragActive, onDragStart, onDragEnd, onDropOn, onTimer, onComplete, onDelete, onDue, onCredit }: {
  task: StabilizerTask;
  running: boolean;
  dragActive: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropOn: () => void;
  onTimer: () => void;
  onComplete: () => void;
  onDelete: () => void;
  onDue: (value: string) => void;
  onCredit: (value: number) => void;
}) {
  const done = Boolean(task.completedAt);
  const [over, setOver] = useState(false);

  return (
    <div
      // `draggable` on the row, but the grip is the only thing that starts it —
      // otherwise selecting the title text drags the task instead.
      onDragOver={e => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); onDropOn(); }}
      style={{
        display: "flex", flexDirection: "column", gap: 3, padding: "6px 7px",
        background: running ? "hsl(var(--accent-h) 35% 11%)" : "hsl(222 18% 5% / .72)",
        border: `1px solid ${running ? "hsl(var(--accent-h) 48% 27%)" : "hsl(220 16% 13%)"}`,
        borderTop: over ? "2px solid hsl(var(--accent-h) 80% 60%)" : undefined,
        borderLeft: `2px solid ${done ? "hsl(145 50% 42%)" : running ? "hsl(var(--accent-h) 85% 60%)" : "hsl(195 55% 42%)"}`,
        opacity: dragActive ? 0.4 : 1,
      }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {!done && (
          <span draggable onDragStart={onDragStart} onDragEnd={onDragEnd}
            title="Drag to reorder"
            style={{ cursor: "grab", color: "hsl(220 12% 32%)", display: "inline-flex", flexShrink: 0 }}>
            <GripVertical size={11} />
          </span>
        )}
        <button onClick={onComplete} title={done ? "Restore task — takes its credit back" : "Complete task — banks its credit"}
          style={{ ...iconButton, color: done ? "hsl(145 58% 54%)" : "hsl(220 12% 38%)" }}>
          {done ? <RotateCcw size={11} /> : <Check size={11} />}
        </button>
        <span title={task.title} style={{ flex: 1, minWidth: 0, fontSize: 9.5, color: done ? "hsl(220 10% 38%)" : "hsl(220 13% 74%)", textDecoration: done ? "line-through" : undefined, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{task.title}</span>
        {!done && !running && <button onClick={onTimer} title="Set focus timer" style={{ ...iconButton, color: "hsl(var(--accent-h) 62% 57%)" }}><Clock3 size={11} /></button>}
        <button onClick={onDelete} title="Remove task" style={{ ...iconButton, color: "hsl(0 48% 48%)" }}><Trash2 size={10} /></button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 5, paddingLeft: done ? 0 : 17 }}>
        <input type="date" value={task.dueDate ?? ""} onChange={e => onDue(e.target.value)}
          title={task.dueDate ? `Planned in Kronos on ${task.dueDate}` : "Give this a day in Kronos Keep"}
          style={{
            flex: 1, minWidth: 0, background: "transparent",
            border: `1px solid ${task.dueDate ? "hsl(195 45% 26%)" : "hsl(220 16% 13%)"}`,
            color: task.dueDate ? "hsl(195 55% 62%)" : "hsl(220 12% 34%)",
            borderRadius: 2, padding: "2px 4px", outline: "none",
            font: "8px DM Mono, monospace", colorScheme: "dark",
          }} />
        <input type="number" min={0} max={10000} value={task.credit} onChange={e => onCredit(Math.max(0, Math.min(10000, Number(e.target.value))))}
          title="Credit banked when this is checked off"
          style={{
            width: 36, background: "transparent", border: "1px solid hsl(220 16% 13%)",
            color: "hsl(var(--accent-h) 60% 55%)", borderRadius: 2, padding: "2px 2px",
            outline: "none", font: "8px DM Mono, monospace", textAlign: "center",
          }} />
        <span style={{ fontSize: 7, color: "hsl(var(--accent-h) 25% 36%)", letterSpacing: ".1em" }}>CR</span>
      </div>
    </div>
  );
}

const iconButton: React.CSSProperties = { border: 0, background: "none", cursor: "pointer", padding: 2, display: "inline-flex", alignItems: "center", justifyContent: "center" };
function miniButton(color: string): React.CSSProperties { return { display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 5px", borderRadius: 2, border: `1px solid ${color.replace(")", " / .3)")}`, background: color.replace(")", " / .08)"), color, font: "7px DM Mono, monospace", cursor: "pointer" }; }
