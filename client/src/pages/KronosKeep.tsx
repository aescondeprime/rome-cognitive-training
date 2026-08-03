/**
 * Kronos Keep — Strategic node calendar
 *
 * Views:
 *   • Month grid — standard calendar, each day shows scheduled chips sized by duration
 *   • Day timeline — click a day to expand into 24-hour linear view
 *
 * Item types:
 *   • Routine   — repeating (daily or specific weekdays), color: gold
 *   • Assignment — one-shot with due date + instructions, color: blue
 *   • Event     — one-shot with preparations, color: violet
 *
 * Routines are placed automatically on every matching day.
 * Saved items appear in a side library for quick one-click scheduling.
 */

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  ChevronLeft, ChevronRight, Plus, X, Check, Loader2,
  RefreshCw, BookOpen, CalendarDays, Clock, Trash2,
  PenLine, ChevronDown, Star, StarOff, Timer,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

// ── Types ──────────────────────────────────────────────────────────────────
interface KCalendar { id: number; name: string; }

interface KRoutine {
  id: number; calendar_id: number; title: string; color: string;
  start_time: string; duration_minutes: number;
  recurrence: "daily" | "weekly"; days_of_week: number[] | null;
  notes: string; saved: boolean;
}
interface KAssignment {
  id: number; calendar_id: number; title: string; color: string;
  start_time: string; duration_minutes: number;
  due_date: string; instructions: string; saved: boolean;
}
interface KEvent {
  id: number; calendar_id: number; title: string; color: string;
  start_time: string; duration_minutes: number;
  event_date: string; preparations: string; saved: boolean;
}

type ItemType = "routine" | "assignment" | "event";

// Unified scheduled item on a day
interface DayItem {
  id: string;          // `type-id`
  type: ItemType;
  title: string;
  color: string;
  start_time: string;  // "HH:MM"
  duration_minutes: number;
  sourceId: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────
const GOLD   = "hsl(var(--accent-h) 88% 60%)";
const BLUE   = "hsl(210 65% 62%)";
const VIOLET = "hsl(270 60% 72%)";
const CAVE   = "hsl(222 14% 9%)";

const DAYS_SHORT  = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MONTHS      = ["January","February","March","April","May","June","July","August","September","October","November","December"];

/** "2024-07-15" → { y, m, d } */
function parseDate(s: string) {
  const [y,m,d] = s.split("-").map(Number);
  return { y, m, d };
}
/** { y, m, d } → "2024-07-15" */
function fmt(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}
/** "HH:MM" → total minutes from midnight */
function toMins(t: string) {
  const [h,m] = t.split(":").map(Number);
  return h * 60 + m;
}
/** total minutes → "H:MM AM/PM" */
function fmtTime(mins: number) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const ampm = h < 12 ? "AM" : "PM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2,"0")} ${ampm}`;
}
/** Days in a month */
function daysInMonth(y: number, m: number) {
  return new Date(y, m, 0).getDate();
}
/** Day-of-week (0=Sun) for 1st of month */
function firstDow(y: number, m: number) {
  return new Date(y, m - 1, 1).getDay();
}
/** weekday index for a date string */
function dow(dateStr: string) {
  const { y, m, d } = parseDate(dateStr);
  return new Date(y, m - 1, d).getDay();
}

const inputCls = "w-full bg-[hsl(220_15%_6%)] border border-[hsl(220_15%_14%)] rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-[hsl(220_30%_28%)] transition-colors placeholder:text-muted-foreground/30";
const labelCls = "block text-[9px] font-mono tracking-widest uppercase text-muted-foreground/60 mb-1";

// ── Compute items for a specific date string ──────────────────────────────
function itemsForDate(
  dateStr: string,
  routines: KRoutine[],
  assignments: KAssignment[],
  events: KEvent[]
): DayItem[] {
  const items: DayItem[] = [];
  const weekday = dow(dateStr);

  for (const r of routines) {
    const fits =
      r.recurrence === "daily" ||
      (r.recurrence === "weekly" && r.days_of_week?.includes(weekday));
    if (fits) items.push({ id: `routine-${r.id}`, type: "routine", title: r.title, color: r.color, start_time: r.start_time, duration_minutes: r.duration_minutes, sourceId: r.id });
  }
  for (const a of assignments) {
    if (a.due_date === dateStr) items.push({ id: `assignment-${a.id}`, type: "assignment", title: a.title, color: a.color, start_time: a.start_time, duration_minutes: a.duration_minutes, sourceId: a.id });
  }
  for (const e of events) {
    if (e.event_date === dateStr) items.push({ id: `event-${e.id}`, type: "event", title: e.title, color: e.color, start_time: e.start_time, duration_minutes: e.duration_minutes, sourceId: e.id });
  }

  return items.sort((a, b) => toMins(a.start_time) - toMins(b.start_time));
}

// Total scheduled minutes on a date
function scheduledMins(items: DayItem[]) {
  return items.reduce((s, i) => s + i.duration_minutes, 0);
}

const TOTAL_DAY_MINS = 24 * 60;

function freeTime(items: DayItem[]) {
  const used = scheduledMins(items);
  const free = TOTAL_DAY_MINS - used;
  if (free <= 0) return "Full";
  const h = Math.floor(free / 60);
  const m = free % 60;
  if (h === 0) return `${m}m free`;
  if (m === 0) return `${h}h free`;
  return `${h}h ${m}m free`;
}

// ══════════════════════════════════════════════════════════════════════════
// ITEM FORMS
// ══════════════════════════════════════════════════════════════════════════

const DOW_LABELS = ["Su","Mo","Tu","We","Th","Fr","Sa"];

function RoutineForm({ calendarId, initial, defaultDate, onSave, onCancel, saving }: {
  calendarId: number; initial?: KRoutine; defaultDate?: string;
  onSave: (d: Omit<KRoutine,"id"|"calendar_id">) => void;
  onCancel: () => void; saving: boolean;
}) {
  const [f, setF] = useState({
    title: initial?.title ?? "",
    color: initial?.color ?? GOLD,
    start_time: initial?.start_time ?? "07:00",
    duration_minutes: initial?.duration_minutes ?? 60,
    recurrence: initial?.recurrence ?? "daily" as "daily"|"weekly",
    days_of_week: initial?.days_of_week ?? [] as number[],
    notes: initial?.notes ?? "",
    saved: initial?.saved ?? false,
  });
  const toggleDay = (d: number) => setF(v => ({ ...v, days_of_week: v.days_of_week.includes(d) ? v.days_of_week.filter(x => x !== d) : [...v.days_of_week, d] }));

  return (
    <div className="space-y-3">
      <div>
        <label className={labelCls}>Title</label>
        <input value={f.title} onChange={e => setF(v => ({...v,title:e.target.value}))} className={inputCls} placeholder="Morning workout…" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Start time</label>
          <input type="time" value={f.start_time} onChange={e => setF(v => ({...v,start_time:e.target.value}))} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Duration (min)</label>
          <input type="number" min={5} step={5} value={f.duration_minutes} onChange={e => setF(v => ({...v,duration_minutes:+e.target.value}))} className={inputCls} />
        </div>
      </div>
      <div>
        <label className={labelCls}>Recurrence</label>
        <div className="flex gap-2">
          {(["daily","weekly"] as const).map(r => (
            <button key={r} onClick={() => setF(v=>({...v,recurrence:r}))}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-mono capitalize transition-all border", f.recurrence===r ? "text-foreground border-[hsl(220_30%_28%)] bg-[hsl(220_20%_12%)]" : "text-muted-foreground border-[hsl(220_15%_14%)] hover:border-[hsl(220_20%_22%)]")}>
              {r}
            </button>
          ))}
        </div>
      </div>
      {f.recurrence === "weekly" && (
        <div>
          <label className={labelCls}>Days of week</label>
          <div className="flex gap-1.5 flex-wrap">
            {DOW_LABELS.map((d,i) => (
              <button key={i} onClick={() => toggleDay(i)}
                className={cn("w-8 h-8 rounded-lg text-[11px] font-mono transition-all border", f.days_of_week.includes(i) ? "bg-[hsl(43_40%_14%)] border-[hsl(43_50%_30%)] text-[hsl(43_88%_60%)]" : "text-muted-foreground border-[hsl(220_15%_14%)] hover:border-[hsl(220_20%_22%)]")}>
                {d}
              </button>
            ))}
          </div>
        </div>
      )}
      <div>
        <label className={labelCls}>Color</label>
        <ColorPicker value={f.color} onChange={c => setF(v => ({...v,color:c}))} />
      </div>
      <div>
        <label className={labelCls}>Notes</label>
        <textarea value={f.notes} onChange={e => setF(v=>({...v,notes:e.target.value}))} className={cn(inputCls,"resize-none")} rows={2} placeholder="Optional notes…" />
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={f.saved} onChange={e => setF(v=>({...v,saved:e.target.checked}))} className="rounded" />
        <span className="text-xs text-muted-foreground">Save to library for quick reuse</span>
      </label>
      <FormActions onCancel={onCancel} onSave={() => onSave(f)} disabled={!f.title.trim()} saving={saving} />
    </div>
  );
}

function AssignmentForm({ calendarId, initial, defaultDate, onSave, onCancel, saving }: {
  calendarId: number; initial?: KAssignment; defaultDate?: string;
  onSave: (d: Omit<KAssignment,"id"|"calendar_id">) => void;
  onCancel: () => void; saving: boolean;
}) {
  const [f, setF] = useState({
    title: initial?.title ?? "",
    color: initial?.color ?? BLUE,
    start_time: initial?.start_time ?? "09:00",
    duration_minutes: initial?.duration_minutes ?? 90,
    due_date: initial?.due_date ?? defaultDate ?? "",
    instructions: initial?.instructions ?? "",
    saved: initial?.saved ?? false,
  });
  return (
    <div className="space-y-3">
      <div>
        <label className={labelCls}>Title</label>
        <input value={f.title} onChange={e => setF(v=>({...v,title:e.target.value}))} className={inputCls} placeholder="Chapter 5 review…" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Start time</label>
          <input type="time" value={f.start_time} onChange={e => setF(v=>({...v,start_time:e.target.value}))} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Duration (min)</label>
          <input type="number" min={5} step={5} value={f.duration_minutes} onChange={e => setF(v=>({...v,duration_minutes:+e.target.value}))} className={inputCls} />
        </div>
      </div>
      <div>
        <label className={labelCls}>Due date</label>
        <input type="date" value={f.due_date} onChange={e => setF(v=>({...v,due_date:e.target.value}))} className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>Color</label>
        <ColorPicker value={f.color} onChange={c => setF(v=>({...v,color:c}))} />
      </div>
      <div>
        <label className={labelCls}>Instructions</label>
        <textarea value={f.instructions} onChange={e => setF(v=>({...v,instructions:e.target.value}))} className={cn(inputCls,"resize-none")} rows={3} placeholder="What needs to be done…" />
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={f.saved} onChange={e => setF(v=>({...v,saved:e.target.checked}))} className="rounded" />
        <span className="text-xs text-muted-foreground">Save to library for quick reuse</span>
      </label>
      <FormActions onCancel={onCancel} onSave={() => onSave(f)} disabled={!f.title.trim() || !f.due_date} saving={saving} />
    </div>
  );
}

function EventForm({ calendarId, initial, defaultDate, onSave, onCancel, saving }: {
  calendarId: number; initial?: KEvent; defaultDate?: string;
  onSave: (d: Omit<KEvent,"id"|"calendar_id">) => void;
  onCancel: () => void; saving: boolean;
}) {
  const [f, setF] = useState({
    title: initial?.title ?? "",
    color: initial?.color ?? VIOLET,
    start_time: initial?.start_time ?? "10:00",
    duration_minutes: initial?.duration_minutes ?? 120,
    event_date: initial?.event_date ?? defaultDate ?? "",
    preparations: initial?.preparations ?? "",
    saved: initial?.saved ?? false,
  });
  return (
    <div className="space-y-3">
      <div>
        <label className={labelCls}>Title</label>
        <input value={f.title} onChange={e => setF(v=>({...v,title:e.target.value}))} className={inputCls} placeholder="Team meeting…" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Start time</label>
          <input type="time" value={f.start_time} onChange={e => setF(v=>({...v,start_time:e.target.value}))} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Duration (min)</label>
          <input type="number" min={5} step={5} value={f.duration_minutes} onChange={e => setF(v=>({...v,duration_minutes:+e.target.value}))} className={inputCls} />
        </div>
      </div>
      <div>
        <label className={labelCls}>Date</label>
        <input type="date" value={f.event_date} onChange={e => setF(v=>({...v,event_date:e.target.value}))} className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>Color</label>
        <ColorPicker value={f.color} onChange={c => setF(v=>({...v,color:c}))} />
      </div>
      <div>
        <label className={labelCls}>Preparations</label>
        <textarea value={f.preparations} onChange={e => setF(v=>({...v,preparations:e.target.value}))} className={cn(inputCls,"resize-none")} rows={3} placeholder="Things to prepare beforehand…" />
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={f.saved} onChange={e => setF(v=>({...v,saved:e.target.checked}))} className="rounded" />
        <span className="text-xs text-muted-foreground">Save to library for quick reuse</span>
      </label>
      <FormActions onCancel={onCancel} onSave={() => onSave(f)} disabled={!f.title.trim() || !f.event_date} saving={saving} />
    </div>
  );
}

function FormActions({ onCancel, onSave, disabled, saving }: { onCancel:()=>void; onSave:()=>void; disabled:boolean; saving:boolean; }) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
      <button onClick={onSave} disabled={disabled || saving}
        className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-mono transition-all disabled:opacity-40 bg-[hsl(220_20%_12%)] text-foreground border border-[hsl(220_20%_22%)] hover:border-[hsl(220_30%_35%)]">
        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
        Save
      </button>
    </div>
  );
}

const COLOR_PRESETS = [
  GOLD, BLUE, VIOLET, "hsl(0 55% 60%)", "hsl(145 55% 50%)", "hsl(195 60% 55%)",
  "hsl(20 65% 58%)", "hsl(175 50% 52%)", "hsl(300 45% 62%)", "hsl(240 50% 68%)",
];

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {COLOR_PRESETS.map(c => (
        <button key={c} onClick={() => onChange(c)}
          className={cn("w-6 h-6 rounded-full transition-all border-2", value === c ? "border-white scale-110" : "border-transparent hover:scale-105")}
          style={{ background: c }} />
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// DAY TIMELINE
// ══════════════════════════════════════════════════════════════════════════
const TIMELINE_PX_PER_MIN = 1.0; // px per minute → 60px/hr, 1440px total

function DayTimeline({ dateStr, items, routines, assignments, events, onClose }: {
  dateStr: string;
  items: DayItem[];
  routines: KRoutine[];
  assignments: KAssignment[];
  events: KEvent[];
  onClose: () => void;
}) {
  const { y, m, d } = parseDate(dateStr);
  const dayLabel = new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const used = scheduledMins(items);
  const free = TOTAL_DAY_MINS - used;

  // 24 hour markers (every 2 hours = 120 min)
  const hourMarkers = Array.from({ length: 13 }, (_, i) => i * 2); // 0,2,4,...,24
  const totalH = TOTAL_DAY_MINS * TIMELINE_PX_PER_MIN;

  // Find source detail
  const getDetail = (item: DayItem) => {
    if (item.type === "routine") return routines.find(r => r.id === item.sourceId);
    if (item.type === "assignment") return assignments.find(a => a.id === item.sourceId);
    if (item.type === "event") return events.find(e => e.id === item.sourceId);
  };

  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)" }}
      onClick={onClose}
    >
      <div
        className="relative rounded-2xl border border-[hsl(220_15%_14%)] w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
        style={{ background: "hsl(222 14% 9%)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[hsl(220_15%_12%)] shrink-0">
          <div>
            <h2 className="text-sm font-bold" style={{ fontFamily: "Cinzel, serif", color: GOLD }}>{dayLabel}</h2>
            <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
              {used > 0 ? `${Math.floor(used/60)}h ${used%60}m scheduled` : "Nothing scheduled"} · {freeTime(items)}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Free time bar */}
        <div className="px-5 py-2 shrink-0 border-b border-[hsl(220_15%_10%)]">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[9px] font-mono tracking-widest uppercase text-muted-foreground/50">Day utilization</span>
            <span className="text-[10px] font-mono text-muted-foreground ml-auto">{Math.round((used/TOTAL_DAY_MINS)*100)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-[hsl(220_15%_12%)] overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${Math.min(100,(used/TOTAL_DAY_MINS)*100)}%`, background: GOLD + "99" }} />
          </div>
        </div>

        {/* Timeline */}
        <div className="flex-1 overflow-y-auto">
          <div className="relative mx-5 my-4" style={{ height: totalH }}>
            {/* Hour grid lines */}
            {hourMarkers.map(h => (
              <div key={h} className="absolute left-0 right-0 flex items-center gap-2" style={{ top: h * 60 * TIMELINE_PX_PER_MIN }}>
                <span className="text-[9px] font-mono text-muted-foreground/40 w-12 text-right shrink-0">
                  {h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h-12} PM`}
                </span>
                <div className="flex-1 h-px bg-[hsl(220_15%_12%)]" />
              </div>
            ))}

            {/* Current time marker */}
            {(() => {
              const now = new Date();
              const todayStr = fmt(now.getFullYear(), now.getMonth()+1, now.getDate());
              if (todayStr !== dateStr) return null;
              const minsNow = now.getHours()*60 + now.getMinutes();
              return (
                <div className="absolute left-14 right-0 flex items-center gap-1.5 z-20" style={{ top: minsNow * TIMELINE_PX_PER_MIN }}>
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: "hsl(0 60% 60%)" }} />
                  <div className="flex-1 h-px" style={{ background: "hsl(0 60% 60%)" }} />
                  <span className="text-[9px] font-mono" style={{ color: "hsl(0 60% 60%)" }}>{fmtTime(minsNow)}</span>
                </div>
              );
            })()}

            {/* Scheduled items */}
            {items.map(item => {
              const top = toMins(item.start_time) * TIMELINE_PX_PER_MIN;
              const h = Math.max(20, item.duration_minutes * TIMELINE_PX_PER_MIN);
              const detail = getDetail(item);
              const isOpen = expanded === item.id;

              return (
                <div
                  key={item.id}
                  className="absolute left-14 right-0 rounded-lg px-3 py-1.5 cursor-pointer transition-all"
                  style={{ top, height: isOpen ? undefined : h, minHeight: h, background: item.color + "22", borderLeft: `3px solid ${item.color}`, zIndex: 10 }}
                  onClick={() => setExpanded(isOpen ? null : item.id)}
                >
                  <div className="flex items-center gap-1.5">
                    <ItemIcon type={item.type} size="sm" color={item.color} />
                    <span className="text-xs font-semibold truncate" style={{ color: item.color }}>{item.title}</span>
                    <span className="text-[10px] font-mono text-muted-foreground ml-auto shrink-0">
                      {fmtTime(toMins(item.start_time))} · {item.duration_minutes}m
                    </span>
                  </div>
                  <AnimatePresence>
                    {isOpen && detail && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                        <div className="pt-2 pb-1 space-y-1 text-xs text-muted-foreground">
                          {item.type === "routine" && (detail as KRoutine).notes && <p>{(detail as KRoutine).notes}</p>}
                          {item.type === "assignment" && (detail as KAssignment).instructions && <p>{(detail as KAssignment).instructions}</p>}
                          {item.type === "event" && (detail as KEvent).preparations && <p><span className="font-mono text-[10px] uppercase opacity-60 mr-1">Prep:</span>{(detail as KEvent).preparations}</p>}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}

            {items.length === 0 && (
              <div className="absolute inset-0 left-14 flex items-center justify-center">
                <p className="text-sm text-muted-foreground opacity-30">No items scheduled</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function ItemIcon({ type, size="md", color }: { type: ItemType; size?: "sm"|"md"; color?: string }) {
  const cls = size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5";
  const c = color ?? (type === "routine" ? GOLD : type === "assignment" ? BLUE : VIOLET);
  if (type === "routine")    return <RefreshCw className={cls} style={{ color: c }} />;
  if (type === "assignment") return <BookOpen className={cls} style={{ color: c }} />;
  return <CalendarDays className={cls} style={{ color: c }} />;
}

// ══════════════════════════════════════════════════════════════════════════
// SAVED LIBRARY PANEL
// ══════════════════════════════════════════════════════════════════════════
function LibraryPanel({ routines, assignments, events, onQuickAdd, selectedDate }: {
  routines: KRoutine[];
  assignments: KAssignment[];
  events: KEvent[];
  onQuickAdd: (type: ItemType, id: number, date: string) => void;
  selectedDate: string | null;
}) {
  const saved = [
    ...routines.filter(r => r.saved).map(r => ({ type: "routine" as ItemType, item: r, label: r.title, color: r.color, id: r.id })),
    ...assignments.filter(a => a.saved).map(a => ({ type: "assignment" as ItemType, item: a, label: a.title, color: a.color, id: a.id })),
    ...events.filter(e => e.saved).map(e => ({ type: "event" as ItemType, item: e, label: e.title, color: e.color, id: e.id })),
  ];
  if (saved.length === 0) return null;

  return (
    <div className="border-t border-[hsl(220_15%_10%)] px-4 py-3">
      <p className="text-[9px] font-mono tracking-widest uppercase text-muted-foreground/40 mb-2">Saved Library</p>
      <div className="flex flex-col gap-1">
        {saved.map(s => (
          <div key={`${s.type}-${s.id}`} className="flex items-center gap-2 group">
            <ItemIcon type={s.type} size="sm" color={s.color} />
            <span className="flex-1 text-xs truncate text-muted-foreground">{s.label}</span>
            <button
              onClick={() => selectedDate && onQuickAdd(s.type, s.id, selectedDate)}
              disabled={!selectedDate}
              className="opacity-0 group-hover:opacity-100 text-[10px] font-mono px-2 py-0.5 rounded transition-all disabled:opacity-0"
              style={{ color: s.color, background: s.color + "18", border: `1px solid ${s.color}40` }}
              title={selectedDate ? `Add to ${selectedDate}` : "Select a day first"}
            >
              + Add
            </button>
          </div>
        ))}
      </div>
      {!selectedDate && (
        <p className="text-[10px] text-muted-foreground/30 mt-2 italic">Click a day to enable quick-add</p>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// CALENDAR GRID
// ══════════════════════════════════════════════════════════════════════════
function CalendarGrid({ year, month, routines, assignments, events, onDayClick, selectedDate }: {
  year: number; month: number;
  routines: KRoutine[]; assignments: KAssignment[]; events: KEvent[];
  onDayClick: (dateStr: string) => void;
  selectedDate: string | null;
}) {
  const dim = daysInMonth(year, month);
  const startDow = firstDow(year, month);
  const today = fmt(new Date().getFullYear(), new Date().getMonth()+1, new Date().getDate());
  const cells: (number|null)[] = [...Array(startDow).fill(null), ...Array.from({length: dim}, (_,i) => i+1)];
  // pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="flex-1 overflow-auto p-4">
      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {DAYS_SHORT.map(d => (
          <div key={d} className="text-center text-[10px] font-mono tracking-widest uppercase text-muted-foreground/40 py-1">{d}</div>
        ))}
      </div>
      {/* Weeks */}
      <div className="grid grid-cols-7 gap-px" style={{ background: "hsl(220 15% 10%)" }}>
        {cells.map((day, idx) => {
          if (!day) return <div key={`empty-${idx}`} style={{ background: CAVE }} className="h-24" />;
          const dateStr = fmt(year, month, day);
          const items = itemsForDate(dateStr, routines, assignments, events);
          const isToday = dateStr === today;
          const isSelected = dateStr === selectedDate;

          return (
            <div
              key={dateStr}
              onClick={() => onDayClick(dateStr)}
              className={cn(
                "h-24 p-1.5 cursor-pointer transition-colors flex flex-col gap-0.5 relative",
                isSelected ? "bg-[hsl(220_20%_11%)]" : "hover:bg-[hsl(220_15%_8%)]"
              )}
              style={{ background: isSelected ? undefined : CAVE }}
            >
              {/* Day number */}
              <div className="flex items-start justify-between">
                <span
                  className={cn(
                    "text-[11px] font-mono w-5 h-5 flex items-center justify-center rounded-full",
                    isToday ? "text-[hsl(222_14%_9%)] font-bold" : "text-muted-foreground"
                  )}
                  style={{ background: isToday ? GOLD : undefined }}
                >
                  {day}
                </span>
                {items.length > 0 && (
                  <span className="text-[8px] font-mono text-muted-foreground/40 leading-none mt-0.5">{freeTime(items)}</span>
                )}
              </div>
              {/* Item chips */}
              <div className="flex flex-col gap-0.5 overflow-hidden flex-1">
                {items.slice(0, 3).map(item => {
                  // chip height proportional to duration, clamped
                  const chipH = Math.max(14, Math.min(28, Math.round(item.duration_minutes / 30) * 7));
                  return (
                    <div
                      key={item.id}
                      className="rounded px-1.5 flex items-center gap-1 overflow-hidden shrink-0"
                      style={{ height: chipH, background: item.color + "28", borderLeft: `2px solid ${item.color}` }}
                    >
                      <span className="text-[9px] truncate" style={{ color: item.color }}>{item.title}</span>
                    </div>
                  );
                })}
                {items.length > 3 && (
                  <span className="text-[8px] font-mono text-muted-foreground/40">+{items.length - 3} more</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// ADD PANEL (right sidebar)
// ══════════════════════════════════════════════════════════════════════════
type AddTab = "routine" | "assignment" | "event";

function AddPanel({ calendarId, selectedDate, routines, assignments, events, onCreatedRoutine, onCreatedAssignment, onCreatedEvent, onDeleteRoutine, onDeleteAssignment, onDeleteEvent, onQuickAdd }: {
  calendarId: number;
  selectedDate: string | null;
  routines: KRoutine[];
  assignments: KAssignment[];
  events: KEvent[];
  onCreatedRoutine: () => void;
  onCreatedAssignment: () => void;
  onCreatedEvent: () => void;
  onDeleteRoutine: (id: number) => void;
  onDeleteAssignment: (id: number) => void;
  onDeleteEvent: (id: number) => void;
  onQuickAdd: (type: ItemType, id: number, date: string) => void;
}) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<AddTab>("routine");
  const [showForm, setShowForm] = useState(false);

  const rQK  = ["/kronos", calendarId, "routines"];
  const aQK  = ["/kronos", calendarId, "assignments"];
  const eQK  = ["/kronos", calendarId, "events"];

  const createRoutine = useMutation({
    mutationFn: (b: object) => apiRequest("POST", `/api/kronos/calendars/${calendarId}/routines`, b).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: rQK }); setShowForm(false); onCreatedRoutine(); },
  });
  const createAssignment = useMutation({
    mutationFn: (b: object) => apiRequest("POST", `/api/kronos/calendars/${calendarId}/assignments`, b).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: aQK }); setShowForm(false); onCreatedAssignment(); },
  });
  const createEvent = useMutation({
    mutationFn: (b: object) => apiRequest("POST", `/api/kronos/calendars/${calendarId}/events`, b).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: eQK }); setShowForm(false); onCreatedEvent(); },
  });

  const tabConfig: Record<AddTab, { label: string; color: string; Icon: any }> = {
    routine:    { label: "Routine",    color: GOLD,   Icon: RefreshCw },
    assignment: { label: "Assignment", color: BLUE,   Icon: BookOpen },
    event:      { label: "Event",      color: VIOLET, Icon: CalendarDays },
  };

  return (
    <div className="w-72 border-l border-[hsl(220_15%_10%)] flex flex-col shrink-0 bg-[hsl(220_14%_7%)]">
      {/* Tabs */}
      <div className="flex border-b border-[hsl(220_15%_10%)]">
        {(["routine","assignment","event"] as AddTab[]).map(t => {
          const { label, color, Icon } = tabConfig[t];
          const active = tab === t;
          return (
            <button key={t} onClick={() => { setTab(t); setShowForm(false); }}
              className={cn("flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[9px] font-mono tracking-wide transition-all border-b-2", active ? "border-current" : "border-transparent text-muted-foreground hover:text-foreground")}
              style={{ color: active ? color : undefined }}>
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Create form toggle */}
        {!showForm ? (
          <button
            onClick={() => setShowForm(true)}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed text-xs text-muted-foreground hover:text-foreground transition-all"
            style={{ borderColor: "hsl(220 15% 20%)" }}
          >
            <Plus className="w-3.5 h-3.5" />
            New {tabConfig[tab].label}
          </button>
        ) : (
          <div className="rounded-xl border border-[hsl(220_15%_13%)] p-3 bg-[hsl(220_14%_8%)]">
            <div className="flex items-center gap-1.5 mb-3">
              <ItemIcon type={tab} color={tabConfig[tab].color} />
              <span className="text-[10px] font-mono tracking-widest uppercase" style={{ color: tabConfig[tab].color }}>
                New {tabConfig[tab].label}
              </span>
            </div>
            {tab === "routine" && (
              <RoutineForm calendarId={calendarId} defaultDate={selectedDate ?? undefined}
                onSave={d => createRoutine.mutate(d)} onCancel={() => setShowForm(false)} saving={createRoutine.isPending} />
            )}
            {tab === "assignment" && (
              <AssignmentForm calendarId={calendarId} defaultDate={selectedDate ?? undefined}
                onSave={d => createAssignment.mutate(d)} onCancel={() => setShowForm(false)} saving={createAssignment.isPending} />
            )}
            {tab === "event" && (
              <EventForm calendarId={calendarId} defaultDate={selectedDate ?? undefined}
                onSave={d => createEvent.mutate(d)} onCancel={() => setShowForm(false)} saving={createEvent.isPending} />
            )}
          </div>
        )}

        {/* Existing items list */}
        <div className="space-y-1">
          {tab === "routine" && routines.map(r => (
            <LibraryRow key={r.id} type="routine" id={r.id} title={r.title} color={r.color} saved={r.saved}
              sub={r.recurrence === "daily" ? "Daily" : r.days_of_week?.map(d => DOW_LABELS[d]).join(", ")}
              time={`${fmtTime(toMins(r.start_time))} · ${r.duration_minutes}m`}
              onDelete={() => onDeleteRoutine(r.id)}
              onQuickAdd={() => selectedDate && onQuickAdd("routine", r.id, selectedDate)}
              selectedDate={selectedDate}
            />
          ))}
          {tab === "assignment" && assignments.map(a => (
            <LibraryRow key={a.id} type="assignment" id={a.id} title={a.title} color={a.color} saved={a.saved}
              sub={a.due_date ? `Due ${a.due_date}` : "No due date"}
              time={`${fmtTime(toMins(a.start_time))} · ${a.duration_minutes}m`}
              onDelete={() => onDeleteAssignment(a.id)}
              onQuickAdd={() => selectedDate && onQuickAdd("assignment", a.id, selectedDate)}
              selectedDate={selectedDate}
            />
          ))}
          {tab === "event" && events.map(e => (
            <LibraryRow key={e.id} type="event" id={e.id} title={e.title} color={e.color} saved={e.saved}
              sub={e.event_date || "No date"}
              time={`${fmtTime(toMins(e.start_time))} · ${e.duration_minutes}m`}
              onDelete={() => onDeleteEvent(e.id)}
              onQuickAdd={() => selectedDate && onQuickAdd("event", e.id, selectedDate)}
              selectedDate={selectedDate}
            />
          ))}
        </div>
      </div>

      {/* Saved library */}
      <LibraryPanel routines={routines} assignments={assignments} events={events} onQuickAdd={onQuickAdd} selectedDate={selectedDate} />
    </div>
  );
}

function LibraryRow({ type, id, title, color, saved, sub, time, onDelete, onQuickAdd, selectedDate }: {
  type: ItemType; id: number; title: string; color: string; saved: boolean;
  sub?: string; time: string; onDelete: () => void; onQuickAdd: () => void; selectedDate: string | null;
}) {
  return (
    <div className="group flex items-start gap-2 rounded-lg px-2 py-2 hover:bg-[hsl(220_14%_9%)] transition-colors">
      <div className="mt-0.5"><ItemIcon type={type} size="sm" color={color} /></div>
      <div className="flex-1 min-w-0">
        <p className="text-xs truncate" style={{ color }}>{title}</p>
        {sub && <p className="text-[9px] font-mono text-muted-foreground/50 mt-0.5">{sub}</p>}
        <p className="text-[9px] font-mono text-muted-foreground/40">{time}</p>
      </div>
      <div className="flex flex-col gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {selectedDate && (
          <button onClick={onQuickAdd}
            className="text-[9px] font-mono px-1.5 py-0.5 rounded transition-all"
            style={{ color, background: color + "18", border: `1px solid ${color}40` }}
            title={`Schedule on ${selectedDate}`}>
            +Add
          </button>
        )}
        <button onClick={onDelete} className="p-0.5 rounded text-muted-foreground/30 hover:text-rose-400 transition-colors self-end">
          <Trash2 className="w-2.5 h-2.5" />
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════���═══════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════════════════
export default function KronosKeep() {
  const qc = useQueryClient();
  const now = new Date();
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [timelineDate, setTimelineDate] = useState<string | null>(null);
  const [calendarId, setCalendarId] = useState<number | null>(null);

  // Calendars
  const { data: calendars = [], isLoading: calLoading } = useQuery<KCalendar[]>({
    queryKey: ["/kronos/calendars"],
    queryFn: () => apiRequest("GET", "/api/kronos/calendars").then(r => r.json()),
  });

  // Auto-create default calendar
  const createCal = useMutation({
    mutationFn: (name: string) => apiRequest("POST", "/api/kronos/calendars", { name }).then(r => r.json()),
    onSuccess: (cal: KCalendar) => { qc.invalidateQueries({ queryKey: ["/kronos/calendars"] }); setCalendarId(cal.id); },
  });

  useEffect(() => {
    if (!calLoading) {
      if (calendars.length > 0 && !calendarId) setCalendarId(calendars[0].id);
      else if (calendars.length === 0 && !createCal.isPending) createCal.mutate("My Calendar");
    }
  }, [calLoading, calendars]);

  const rQK = ["/kronos", calendarId, "routines"];
  const aQK = ["/kronos", calendarId, "assignments"];
  const eQK = ["/kronos", calendarId, "events"];

  const { data: routines = [] } = useQuery<KRoutine[]>({
    queryKey: rQK, enabled: !!calendarId,
    queryFn: () => apiRequest("GET", `/api/kronos/calendars/${calendarId}/routines`).then(r => r.json()),
  });
  const { data: assignments = [] } = useQuery<KAssignment[]>({
    queryKey: aQK, enabled: !!calendarId,
    queryFn: () => apiRequest("GET", `/api/kronos/calendars/${calendarId}/assignments`).then(r => r.json()),
  });
  const { data: events = [] } = useQuery<KEvent[]>({
    queryKey: eQK, enabled: !!calendarId,
    queryFn: () => apiRequest("GET", `/api/kronos/calendars/${calendarId}/events`).then(r => r.json()),
  });

  const deleteRoutine    = useMutation({ mutationFn: (id: number) => apiRequest("DELETE", `/api/kronos/routines/${id}`),    onSuccess: () => qc.invalidateQueries({ queryKey: rQK }) });
  const deleteAssignment = useMutation({ mutationFn: (id: number) => apiRequest("DELETE", `/api/kronos/assignments/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: aQK }) });
  const deleteEvent      = useMutation({ mutationFn: (id: number) => apiRequest("DELETE", `/api/kronos/events/${id}`),      onSuccess: () => qc.invalidateQueries({ queryKey: eQK }) });

  // "Quick add" — just updates the item's date/recurrence so it shows on that day
  // For assignments: set due_date. For events: set event_date. For routines: handled by recurrence.
  const handleQuickAdd = useCallback((type: ItemType, id: number, date: string) => {
    if (type === "assignment") apiRequest("PATCH", `/api/kronos/assignments/${id}`, { due_date: date }).then(() => qc.invalidateQueries({ queryKey: aQK }));
    if (type === "event")      apiRequest("PATCH", `/api/kronos/events/${id}`,      { event_date: date }).then(() => qc.invalidateQueries({ queryKey: eQK }));
    // routine: already appears by recurrence; show user a toast or just no-op
  }, [calendarId]);

  const prevMonth = () => { if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1); };
  const goToday   = () => { setYear(now.getFullYear()); setMonth(now.getMonth()+1); };

  const handleDayClick = (dateStr: string) => {
    if (selectedDate === dateStr) {
      // second click → open timeline
      setTimelineDate(dateStr);
    } else {
      setSelectedDate(dateStr);
    }
  };

  const timelineItems = timelineDate
    ? itemsForDate(timelineDate, routines, assignments, events)
    : [];

  if (calLoading || !calendarId) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground opacity-30" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[calc(100vh-120px)] relative">
      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-[hsl(220_15%_10%)] shrink-0">
          <div className="flex items-center gap-1">
            <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-[hsl(220_15%_10%)] text-muted-foreground hover:text-foreground transition-colors">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <h2 className="text-base font-bold min-w-[160px] text-center" style={{ fontFamily: "Cinzel, serif", color: GOLD }}>
              {MONTHS[month - 1]} {year}
            </h2>
            <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-[hsl(220_15%_10%)] text-muted-foreground hover:text-foreground transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <button onClick={goToday} className="text-[10px] font-mono px-2.5 py-1 rounded-lg border border-[hsl(220_15%_16%)] text-muted-foreground hover:text-foreground hover:border-[hsl(220_15%_24%)] transition-all">
            Today
          </button>
          {selectedDate && (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-[10px] font-mono text-muted-foreground/50">{selectedDate} selected</span>
              <button
                onClick={() => setTimelineDate(selectedDate)}
                className="flex items-center gap-1.5 text-[10px] font-mono px-2.5 py-1 rounded-lg transition-all"
                style={{ color: GOLD, background: GOLD + "14", border: `1px solid ${GOLD}30` }}
              >
                <Clock className="w-3 h-3" />
                Open Timeline
              </button>
              <button onClick={() => setSelectedDate(null)} className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          {!selectedDate && (
            <p className="ml-auto text-[10px] font-mono text-muted-foreground/30">Click a day to select · click again for timeline</p>
          )}
        </div>

        <CalendarGrid
          year={year} month={month}
          routines={routines} assignments={assignments} events={events}
          onDayClick={handleDayClick}
          selectedDate={selectedDate}
        />
      </div>

      {/* Right panel */}
      {calendarId && (
        <AddPanel
          calendarId={calendarId}
          selectedDate={selectedDate}
          routines={routines}
          assignments={assignments}
          events={events}
          onCreatedRoutine={() => qc.invalidateQueries({ queryKey: rQK })}
          onCreatedAssignment={() => qc.invalidateQueries({ queryKey: aQK })}
          onCreatedEvent={() => qc.invalidateQueries({ queryKey: eQK })}
          onDeleteRoutine={id => deleteRoutine.mutate(id)}
          onDeleteAssignment={id => deleteAssignment.mutate(id)}
          onDeleteEvent={id => deleteEvent.mutate(id)}
          onQuickAdd={handleQuickAdd}
        />
      )}

      {/* Day timeline modal */}
      <AnimatePresence>
        {timelineDate && (
          <DayTimeline
            dateStr={timelineDate}
            items={timelineItems}
            routines={routines}
            assignments={assignments}
            events={events}
            onClose={() => setTimelineDate(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
