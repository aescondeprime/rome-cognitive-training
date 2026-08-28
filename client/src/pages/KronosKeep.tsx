/**
 * Kronos Keep — the Strategic node's calendar.
 *
 * Views:
 *   • Month grid — each day shows its items as chips sized by duration
 *   • Day timeline — click a selected day again for a 24-hour linear view
 *
 * Four item types, defined once in `@/lib/kronosTypes`:
 *   Routine (gold) · Assignment (blue) · Event (violet) · General (green)
 *
 * ── Templates and placements ────────────────────────────────────────────────
 *
 * The thing to understand about this page is that a library entry and a thing
 * on a day are **different rows**, and `saved` is which:
 *
 *   saved = true    a template. Lives in the library. Never drawn on the grid.
 *   saved = false   a placement. Sits on exactly one day.
 *
 * They used to be one row, and that was the bug: `handleQuickAdd` could only
 * PATCH the date, and a row has one date, so pulling a library item onto
 * Tuesday took it off Monday. Placing a template now **clones** it, so one
 * template can sit on every day of the month and each copy is independently
 * editable and deletable.
 *
 * Ticking "save to library" on a form with a date fills both roles at once:
 * it writes the template *and* the first placement.
 *
 * ── Routines are placed by window, not by date ──────────────────────────────
 *
 * A routine has no date column. It has a recurrence and a **window**, and it
 * appears on every matching weekday inside that window. The window defaults to
 * the month you created it in — before this it had no bound at all and a
 * routine repeated in both directions forever, including across months you had
 * not thought about yet. When you page past a routine's window its row offers
 * `Extend to <Month>`; nothing carries itself forward silently.
 *
 * An empty bound means unbounded on that side, which is exactly the old
 * behaviour — rows written before windows existed keep doing what they did
 * until you edit them.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  ChevronLeft, ChevronRight, Plus, X, Check, Loader2,
  RefreshCw, BookOpen, CalendarDays, Clock, Trash2, Circle,
  CalendarPlus, Bookmark, CloudOff, Cloud,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import CalendarSyncPanel from "./kronos/CalendarSyncPanel";
import {
  KRONOS_TYPES, KRONOS_TYPE, type ItemType,
  GOLD, GREEN, BLUE, VIOLET,
  fmtDate as fmt, parseDate, daysInMonth, todayStr,
  monthWindow, withinWindow, windowLabel, placementBody,
} from "@/lib/kronosTypes";

// ── Types ──────────────────────────────────────────────────────────────────
interface KCalendar { id: number; name: string; }

/**
 * One row, whatever its table.
 *
 * The four tables differ only in which date column and which text column they
 * carry, so one shape with optional members beats four interfaces and the
 * casts that come with them. `KRONOS_TYPE[t].dateField` / `.detailField` say
 * which members are live for a given type.
 */
interface KItem {
  id: number;
  calendar_id: number;
  title: string;
  color: string;
  start_time: string;
  duration_minutes: number;
  saved: boolean;
  // routine
  recurrence?: "daily" | "weekly";
  days_of_week?: number[] | null;
  start_date?: string | null;
  end_date?: string | null;
  // text, one of these per type
  notes?: string;
  instructions?: string;
  preparations?: string;
  // dates, one of these per type
  due_date?: string;
  event_date?: string;
  item_date?: string;
}

type ItemsByType = Record<ItemType, KItem[]>;

/** A placement resolved onto a specific day, ready to draw. */
interface DayItem {
  id: string;          // `type-id`, unique across tables
  type: ItemType;
  title: string;
  color: string;
  start_time: string;
  duration_minutes: number;
  sourceId: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────
const CAVE = "hsl(222 14% 9%)";

const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

/** "HH:MM" → minutes from midnight. Total: a missing time sorts to 00:00. */
function toMins(t: string | undefined) {
  const [h, m] = String(t ?? "00:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
/** minutes → "H:MM AM/PM" */
function fmtTime(mins: number) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const ampm = h < 12 ? "AM" : "PM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, "0")} ${ampm}`;
}
function firstDow(y: number, m: number) {
  return new Date(y, m - 1, 1).getDay();
}
function dow(dateStr: string) {
  const { y, m, d } = parseDate(dateStr);
  return new Date(y, m - 1, d).getDay();
}

const inputCls = "w-full bg-[hsl(220_15%_6%)] border border-[hsl(220_15%_14%)] rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-[hsl(220_30%_28%)] transition-colors placeholder:text-muted-foreground/30";
const labelCls = "block text-[9px] font-mono tracking-widest uppercase text-muted-foreground/60 mb-1";

const emptyItems = (): ItemsByType =>
  ({ routine: [], assignment: [], event: [], general: [] });

// ── Which placements land on a given day ───────────────────────────────────

function itemsForDate(dateStr: string, items: ItemsByType): DayItem[] {
  const out: DayItem[] = [];
  const weekday = dow(dateStr);

  for (const type of KRONOS_TYPES) {
    const meta = KRONOS_TYPE[type];
    for (const row of items[type]) {
      // Templates live in the library and are never on the calendar.
      if (row.saved) continue;

      if (type === "routine") {
        if (!withinWindow(dateStr, row.start_date, row.end_date)) continue;
        const fits =
          row.recurrence === "daily" ||
          (row.recurrence === "weekly" && row.days_of_week?.includes(weekday));
        if (!fits) continue;
      } else {
        const field = meta.dateField!;
        if ((row as any)[field] !== dateStr) continue;
      }

      out.push({
        id: `${type}-${row.id}`,
        type,
        title: row.title,
        color: row.color,
        start_time: row.start_time,
        duration_minutes: row.duration_minutes,
        sourceId: row.id,
      });
    }
  }

  return out.sort((a, b) => toMins(a.start_time) - toMins(b.start_time));
}

const TOTAL_DAY_MINS = 24 * 60;

function scheduledMins(items: DayItem[]) {
  return items.reduce((s, i) => s + i.duration_minutes, 0);
}

function freeTime(items: DayItem[]) {
  const free = TOTAL_DAY_MINS - scheduledMins(items);
  if (free <= 0) return "Full";
  const h = Math.floor(free / 60);
  const m = free % 60;
  if (h === 0) return `${m}m free`;
  if (m === 0) return `${h}h free`;
  return `${h}h ${m}m free`;
}

// ══════════════════════════════════════════════════════════════════════════
// THE FORM
// ══════════════════════════════════════════════════════════════════════════
//
// One form for all four types. The type's metadata says which date field it
// carries and what its text field is called; only routines add anything
// structural, and that is the recurrence block plus the window.

const DOW_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const PLACEHOLDERS: Record<ItemType, { title: string; detail: string }> = {
  routine:    { title: "Morning workout…",  detail: "Optional notes…" },
  assignment: { title: "Chapter 5 review…", detail: "What needs to be done…" },
  event:      { title: "Team meeting…",     detail: "Things to prepare beforehand…" },
  general:    { title: "Pick up parcel…",   detail: "Optional notes…" },
};

const DEFAULT_TIMES: Record<ItemType, { start: string; minutes: number }> = {
  routine:    { start: "07:00", minutes: 60 },
  assignment: { start: "09:00", minutes: 90 },
  event:      { start: "10:00", minutes: 120 },
  general:    { start: "12:00", minutes: 30 },
};

export interface ItemDraft extends Record<string, unknown> {
  title: string;
  color: string;
  start_time: string;
  duration_minutes: number;
  saved: boolean;
}

function ItemForm({ type, initial, defaultDate, onSave, onCancel, saving }: {
  type: ItemType;
  initial?: KItem;
  defaultDate?: string;
  onSave: (d: ItemDraft) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const meta = KRONOS_TYPE[type];
  const anchor = defaultDate || todayStr();
  const defaults = DEFAULT_TIMES[type];

  const [f, setF] = useState<ItemDraft>(() => {
    const base: ItemDraft = {
      title: initial?.title ?? "",
      color: initial?.color ?? meta.color,
      start_time: initial?.start_time ?? defaults.start,
      duration_minutes: initial?.duration_minutes ?? defaults.minutes,
      [meta.detailField]: (initial as any)?.[meta.detailField] ?? "",
      saved: initial?.saved ?? false,
    };
    if (type === "routine") {
      const w = monthWindow(anchor);
      base.recurrence = initial?.recurrence ?? "daily";
      base.days_of_week = initial?.days_of_week ?? [];
      base.start_date = initial?.start_date ?? w.start;
      base.end_date = initial?.end_date ?? w.end;
    } else {
      base[meta.dateField!] = (initial as any)?.[meta.dateField!] ?? defaultDate ?? "";
    }
    return base;
  });

  const set = (patch: Partial<ItemDraft>) => setF(v => ({ ...v, ...patch }));
  const toggleDay = (d: number) => {
    const days = (f.days_of_week as number[]) ?? [];
    set({ days_of_week: days.includes(d) ? days.filter(x => x !== d) : [...days, d] });
  };

  const dateValue = meta.dateField ? String(f[meta.dateField] ?? "") : "";
  const canSave =
    Boolean(String(f.title).trim()) &&
    // A template needs no date — it is not on the calendar yet. A placement
    // does, or it would be written to a day that does not exist.
    (meta.dateField === null || Boolean(dateValue) || f.saved);

  return (
    <div className="space-y-3">
      <div>
        <label className={labelCls}>Title</label>
        <input value={f.title} onChange={e => set({ title: e.target.value })}
          className={inputCls} placeholder={PLACEHOLDERS[type].title} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Start time</label>
          <input type="time" value={f.start_time}
            onChange={e => set({ start_time: e.target.value })} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Duration (min)</label>
          <input type="number" min={5} step={5} value={f.duration_minutes}
            onChange={e => set({ duration_minutes: +e.target.value })} className={inputCls} />
        </div>
      </div>

      {type === "routine" ? (
        <>
          <div>
            <label className={labelCls}>Recurrence</label>
            <div className="flex gap-2">
              {(["daily", "weekly"] as const).map(r => (
                <button key={r} onClick={() => set({ recurrence: r })}
                  className={cn("px-3 py-1.5 rounded-lg text-xs font-mono capitalize transition-all border",
                    f.recurrence === r
                      ? "text-foreground border-[hsl(220_30%_28%)] bg-[hsl(220_20%_12%)]"
                      : "text-muted-foreground border-[hsl(220_15%_14%)] hover:border-[hsl(220_20%_22%)]")}>
                  {r}
                </button>
              ))}
            </div>
          </div>

          {f.recurrence === "weekly" && (
            <div>
              <label className={labelCls}>Days of week</label>
              <div className="flex gap-1.5 flex-wrap">
                {DOW_LABELS.map((d, i) => (
                  <button key={i} onClick={() => toggleDay(i)}
                    className={cn("w-8 h-8 rounded-lg text-[11px] font-mono transition-all border",
                      ((f.days_of_week as number[]) ?? []).includes(i)
                        ? "bg-[hsl(43_40%_14%)] border-[hsl(43_50%_30%)] text-[hsl(43_88%_60%)]"
                        : "text-muted-foreground border-[hsl(220_15%_14%)] hover:border-[hsl(220_20%_22%)]")}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* The window. Defaults to this month rather than forever, which is
              the whole point — a routine you set up in August should not still
              be filling your grid next March unless you said so. */}
          <div>
            <label className={labelCls}>Runs from → until</label>
            <div className="grid grid-cols-2 gap-3">
              <input type="date" value={String(f.start_date ?? "")}
                onChange={e => set({ start_date: e.target.value })} className={inputCls} />
              <input type="date" value={String(f.end_date ?? "")}
                onChange={e => set({ end_date: e.target.value })} className={inputCls} />
            </div>
            <p className="text-[9px] text-muted-foreground/40 mt-1 font-mono">
              Leave a side blank for no bound. Defaults to this month.
            </p>
          </div>
        </>
      ) : (
        <div>
          <label className={labelCls}>{type === "assignment" ? "Due date" : "Date"}</label>
          <input type="date" value={dateValue}
            onChange={e => set({ [meta.dateField!]: e.target.value })} className={inputCls} />
        </div>
      )}

      <div>
        <label className={labelCls}>Color</label>
        <ColorPicker value={String(f.color)} onChange={c => set({ color: c })} />
      </div>

      <div>
        <label className={labelCls}>{meta.detailLabel}</label>
        <textarea value={String(f[meta.detailField] ?? "")}
          onChange={e => set({ [meta.detailField]: e.target.value })}
          className={cn(inputCls, "resize-none")} rows={type === "routine" ? 2 : 3}
          placeholder={PLACEHOLDERS[type].detail} />
      </div>

      <label className="flex items-start gap-2 cursor-pointer">
        <input type="checkbox" checked={f.saved}
          onChange={e => set({ saved: e.target.checked })} className="rounded mt-0.5" />
        <span className="text-xs text-muted-foreground leading-snug">
          Keep in library for reuse
          <span className="block text-[9px] text-muted-foreground/40 font-mono mt-0.5">
            {dateValue || type === "routine"
              ? "Saves the template and places a copy"
              : "Saves the template only"}
          </span>
        </span>
      </label>

      <FormActions onCancel={onCancel} onSave={() => onSave(f)} disabled={!canSave} saving={saving} />
    </div>
  );
}

function FormActions({ onCancel, onSave, disabled, saving }: {
  onCancel: () => void; onSave: () => void; disabled: boolean; saving: boolean;
}) {
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
  GOLD, BLUE, VIOLET, GREEN, "hsl(0 55% 60%)", "hsl(195 60% 55%)",
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

// ── Icons ──────────────────────────────────────────────────────────────────

const TYPE_ICON: Record<ItemType, any> = {
  routine: RefreshCw,
  assignment: BookOpen,
  event: CalendarDays,
  general: Circle,
};

function ItemIcon({ type, size = "md", color }: { type: ItemType; size?: "sm" | "md"; color?: string }) {
  const cls = size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5";
  const Icon = TYPE_ICON[type] ?? Circle;
  return <Icon className={cls} style={{ color: color ?? KRONOS_TYPE[type]?.color ?? GOLD }} />;
}

// ══════════════════════════════════════════════════════════════════════════
// DAY TIMELINE
// ══════════════════════════════════════════════════════════════════════════
const TIMELINE_PX_PER_MIN = 1.0; // 60px/hr, 1440px total

function DayTimeline({ dateStr, items, all, onClose }: {
  dateStr: string;
  items: DayItem[];
  all: ItemsByType;
  onClose: () => void;
}) {
  const { y, m, d } = parseDate(dateStr);
  const dayLabel = new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const used = scheduledMins(items);

  const hourMarkers = Array.from({ length: 13 }, (_, i) => i * 2);
  const totalH = TOTAL_DAY_MINS * TIMELINE_PX_PER_MIN;

  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)" }} onClick={onClose}
    >
      <div className="relative rounded-2xl border border-[hsl(220_15%_14%)] w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
        style={{ background: CAVE }} onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between px-5 py-4 border-b border-[hsl(220_15%_12%)] shrink-0">
          <div>
            <h2 className="text-sm font-bold" style={{ fontFamily: "Cinzel, serif", color: GOLD }}>{dayLabel}</h2>
            <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
              {used > 0 ? `${Math.floor(used / 60)}h ${used % 60}m scheduled` : "Nothing scheduled"} · {freeTime(items)}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-2 shrink-0 border-b border-[hsl(220_15%_10%)]">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[9px] font-mono tracking-widest uppercase text-muted-foreground/50">Day utilization</span>
            <span className="text-[10px] font-mono text-muted-foreground ml-auto">{Math.round((used / TOTAL_DAY_MINS) * 100)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-[hsl(220_15%_12%)] overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, (used / TOTAL_DAY_MINS) * 100)}%`, background: GOLD + "99" }} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="relative mx-5 my-4" style={{ height: totalH }}>
            {hourMarkers.map(h => (
              <div key={h} className="absolute left-0 right-0 flex items-center gap-2" style={{ top: h * 60 * TIMELINE_PX_PER_MIN }}>
                <span className="text-[9px] font-mono text-muted-foreground/40 w-12 text-right shrink-0">
                  {h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`}
                </span>
                <div className="flex-1 h-px bg-[hsl(220_15%_12%)]" />
              </div>
            ))}

            {(() => {
              const now = new Date();
              if (todayStr(now) !== dateStr) return null;
              const minsNow = now.getHours() * 60 + now.getMinutes();
              return (
                <div className="absolute left-14 right-0 flex items-center gap-1.5 z-20" style={{ top: minsNow * TIMELINE_PX_PER_MIN }}>
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: "hsl(0 60% 60%)" }} />
                  <div className="flex-1 h-px" style={{ background: "hsl(0 60% 60%)" }} />
                  <span className="text-[9px] font-mono" style={{ color: "hsl(0 60% 60%)" }}>{fmtTime(minsNow)}</span>
                </div>
              );
            })()}

            {items.map(item => {
              const top = toMins(item.start_time) * TIMELINE_PX_PER_MIN;
              const h = Math.max(20, item.duration_minutes * TIMELINE_PX_PER_MIN);
              const meta = KRONOS_TYPE[item.type];
              const detail = all[item.type].find(r => r.id === item.sourceId);
              const text = detail ? (detail as any)[meta.detailField] : "";
              const isOpen = expanded === item.id;

              return (
                <div key={item.id}
                  className="absolute left-14 right-0 rounded-lg px-3 py-1.5 cursor-pointer transition-all"
                  style={{ top, height: isOpen ? undefined : h, minHeight: h, background: item.color + "22", borderLeft: `3px solid ${item.color}`, zIndex: 10 }}
                  onClick={() => setExpanded(isOpen ? null : item.id)}>
                  <div className="flex items-center gap-1.5">
                    <ItemIcon type={item.type} size="sm" color={item.color} />
                    <span className="text-xs font-semibold truncate" style={{ color: item.color }}>{item.title}</span>
                    <span className="text-[10px] font-mono text-muted-foreground ml-auto shrink-0">
                      {fmtTime(toMins(item.start_time))} · {item.duration_minutes}m
                    </span>
                  </div>
                  <AnimatePresence>
                    {isOpen && text && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                        <div className="pt-2 pb-1 text-xs text-muted-foreground">
                          <span className="font-mono text-[10px] uppercase opacity-60 mr-1">{meta.detailLabel}:</span>{text}
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

// ══════════════════════════════════════════════════════════════════════════
// CALENDAR GRID
// ══════════════════════════════════════════════════════════════════════════
function CalendarGrid({ year, month, items, onDayClick, selectedDate }: {
  year: number; month: number;
  items: ItemsByType;
  onDayClick: (dateStr: string) => void;
  selectedDate: string | null;
}) {
  const dim = daysInMonth(year, month);
  const startDow = firstDow(year, month);
  const today = todayStr();
  const cells: (number | null)[] = [...Array(startDow).fill(null), ...Array.from({ length: dim }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="grid grid-cols-7 mb-1">
        {DAYS_SHORT.map(d => (
          <div key={d} className="text-center text-[10px] font-mono tracking-widest uppercase text-muted-foreground/40 py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px" style={{ background: "hsl(220 15% 10%)" }}>
        {cells.map((day, idx) => {
          if (!day) return <div key={`empty-${idx}`} style={{ background: CAVE }} className="h-24" />;
          const dateStr = fmt(year, month, day);
          const dayItems = itemsForDate(dateStr, items);
          const isToday = dateStr === today;
          const isSelected = dateStr === selectedDate;

          return (
            <div key={dateStr} onClick={() => onDayClick(dateStr)}
              className={cn("h-24 p-1.5 cursor-pointer transition-colors flex flex-col gap-0.5 relative",
                isSelected ? "bg-[hsl(220_20%_11%)]" : "hover:bg-[hsl(220_15%_8%)]")}
              style={{ background: isSelected ? undefined : CAVE }}>
              <div className="flex items-start justify-between">
                <span className={cn("text-[11px] font-mono w-5 h-5 flex items-center justify-center rounded-full",
                  isToday ? "text-[hsl(222_14%_9%)] font-bold" : "text-muted-foreground")}
                  style={{ background: isToday ? GOLD : undefined }}>
                  {day}
                </span>
                {dayItems.length > 0 && (
                  <span className="text-[8px] font-mono text-muted-foreground/40 leading-none mt-0.5">{freeTime(dayItems)}</span>
                )}
              </div>
              <div className="flex flex-col gap-0.5 overflow-hidden flex-1">
                {dayItems.slice(0, 3).map(item => {
                  const chipH = Math.max(14, Math.min(28, Math.round(item.duration_minutes / 30) * 7));
                  return (
                    <div key={item.id} className="rounded px-1.5 flex items-center gap-1 overflow-hidden shrink-0"
                      style={{ height: chipH, background: item.color + "28", borderLeft: `2px solid ${item.color}` }}>
                      <span className="text-[9px] truncate" style={{ color: item.color }}>{item.title}</span>
                    </div>
                  );
                })}
                {dayItems.length > 3 && (
                  <span className="text-[8px] font-mono text-muted-foreground/40">+{dayItems.length - 3} more</span>
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
// RIGHT SIDEBAR
// ══════════════════════════════════════════════════════════════════════════

function AddPanel({
  items, selectedDate, viewYear, viewMonth, saving,
  onCreate, onDelete, onPlace, onExtend,
}: {
  items: ItemsByType;
  selectedDate: string | null;
  viewYear: number;
  viewMonth: number;
  saving: boolean;
  onCreate: (type: ItemType, draft: ItemDraft) => void;
  onDelete: (type: ItemType, id: number) => void;
  onPlace: (type: ItemType, id: number, date: string) => void;
  onExtend: (id: number) => void;
}) {
  const [tab, setTab] = useState<ItemType>("routine");
  const [showForm, setShowForm] = useState(false);

  const meta = KRONOS_TYPE[tab];
  const rows = items[tab];
  const templates = rows.filter(r => r.saved);
  const placements = rows.filter(r => !r.saved);

  // The last day of the month currently on screen — what "extend" extends to.
  const viewEnd = fmt(viewYear, viewMonth, daysInMonth(viewYear, viewMonth));

  return (
    <div className="w-72 border-l border-[hsl(220_15%_10%)] flex flex-col shrink-0 bg-[hsl(220_14%_7%)]">
      {/* Tabs */}
      <div className="flex border-b border-[hsl(220_15%_10%)]">
        {KRONOS_TYPES.map(t => {
          const m = KRONOS_TYPE[t];
          const active = tab === t;
          const Icon = TYPE_ICON[t];
          return (
            <button key={t} onClick={() => { setTab(t); setShowForm(false); }}
              className={cn("flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[8px] font-mono tracking-wide transition-all border-b-2",
                active ? "border-current" : "border-transparent text-muted-foreground hover:text-foreground")}
              style={{ color: active ? m.color : undefined }}
              title={m.hint}>
              <Icon className="w-3.5 h-3.5" />
              {m.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {!showForm ? (
          <button onClick={() => setShowForm(true)}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed text-xs text-muted-foreground hover:text-foreground transition-all"
            style={{ borderColor: "hsl(220 15% 20%)" }}>
            <Plus className="w-3.5 h-3.5" />
            New {meta.label}
          </button>
        ) : (
          <div className="rounded-xl border border-[hsl(220_15%_13%)] p-3 bg-[hsl(220_14%_8%)]">
            <div className="flex items-center gap-1.5 mb-3">
              <ItemIcon type={tab} color={meta.color} />
              <span className="text-[10px] font-mono tracking-widest uppercase" style={{ color: meta.color }}>
                New {meta.label}
              </span>
            </div>
            <ItemForm
              key={`${tab}-${selectedDate ?? "none"}`}
              type={tab}
              defaultDate={selectedDate ?? undefined}
              onSave={d => { onCreate(tab, d); setShowForm(false); }}
              onCancel={() => setShowForm(false)}
              saving={saving}
            />
          </div>
        )}

        {/* Library templates for this type */}
        {templates.length > 0 && (
          <div className="space-y-1">
            <p className="text-[9px] font-mono tracking-widest uppercase text-muted-foreground/40 flex items-center gap-1.5">
              <Bookmark className="w-2.5 h-2.5" /> Library
            </p>
            {templates.map(r => (
              <ItemRow key={r.id} type={tab} row={r} isTemplate
                selectedDate={selectedDate} viewEnd={viewEnd} viewLabel={MONTHS[viewMonth - 1]}
                onDelete={() => onDelete(tab, r.id)}
                onPlace={() => selectedDate && onPlace(tab, r.id, selectedDate)}
                onExtend={() => onExtend(r.id)} />
            ))}
          </div>
        )}

        {/* Everything of this type that is actually on the calendar */}
        <div className="space-y-1">
          {placements.length > 0 && (
            <p className="text-[9px] font-mono tracking-widest uppercase text-muted-foreground/40">
              On the calendar · {placements.length}
            </p>
          )}
          {placements.map(r => (
            <ItemRow key={r.id} type={tab} row={r} isTemplate={false}
              selectedDate={selectedDate} viewEnd={viewEnd} viewLabel={MONTHS[viewMonth - 1]}
              onDelete={() => onDelete(tab, r.id)}
              onPlace={() => selectedDate && onPlace(tab, r.id, selectedDate)}
              onExtend={() => onExtend(r.id)} />
          ))}
          {placements.length === 0 && templates.length === 0 && !showForm && (
            <p className="text-[10px] text-muted-foreground/30 italic pt-2">
              No {meta.label.toLowerCase()}s yet. {meta.hint}.
            </p>
          )}
        </div>
      </div>

      {!selectedDate && (
        <div className="border-t border-[hsl(220_15%_10%)] px-4 py-2.5">
          <p className="text-[10px] text-muted-foreground/30 italic">Click a day to enable placing</p>
        </div>
      )}
    </div>
  );
}

function ItemRow({ type, row, isTemplate, selectedDate, viewEnd, viewLabel, onDelete, onPlace, onExtend }: {
  type: ItemType;
  row: KItem;
  isTemplate: boolean;
  selectedDate: string | null;
  viewEnd: string;
  viewLabel: string;
  onDelete: () => void;
  onPlace: () => void;
  onExtend: () => void;
}) {
  const meta = KRONOS_TYPE[type];

  // The routine window is the reason this row can offer to carry itself
  // forward: a routine that ended in July is invisible in August, and without
  // this the only way back is editing a date field by hand.
  const expired =
    type === "routine" && !isTemplate &&
    Boolean(row.end_date) && String(row.end_date) < viewEnd;

  const sub =
    type === "routine"
      ? `${row.recurrence === "daily" ? "Daily" : (row.days_of_week ?? []).map(d => DOW_LABELS[d]).join(", ") || "No days"} · ${isTemplate ? "template" : windowLabel(row.start_date, row.end_date)}`
      : isTemplate
        ? "template"
        : (row as any)[meta.dateField!] || "No date";

  return (
    <div className={cn("group flex items-start gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-[hsl(220_14%_9%)]", expired && "opacity-55")}>
      <div className="mt-0.5"><ItemIcon type={type} size="sm" color={row.color} /></div>
      <div className="flex-1 min-w-0">
        <p className="text-xs truncate" style={{ color: row.color }}>{row.title}</p>
        <p className="text-[9px] font-mono text-muted-foreground/50 mt-0.5 truncate">{sub}</p>
        <p className="text-[9px] font-mono text-muted-foreground/40">
          {fmtTime(toMins(row.start_time))} · {row.duration_minutes}m
        </p>
        {expired && (
          <button onClick={onExtend}
            className="mt-1 flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded transition-all"
            style={{ color: GOLD, background: GOLD + "16", border: `1px solid ${GOLD}38` }}>
            <CalendarPlus className="w-2.5 h-2.5" /> Extend to {viewLabel}
          </button>
        )}
      </div>
      <div className="flex flex-col gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {selectedDate && (
          <button onClick={onPlace}
            className="text-[9px] font-mono px-1.5 py-0.5 rounded transition-all whitespace-nowrap"
            style={{ color: row.color, background: row.color + "18", border: `1px solid ${row.color}40` }}
            title={`Place a copy on ${selectedDate}`}>
            +Place
          </button>
        )}
        <button onClick={onDelete} className="p-0.5 rounded text-muted-foreground/30 hover:text-rose-400 transition-colors self-end"
          title={isTemplate ? "Delete template" : "Remove from calendar"}>
          <Trash2 className="w-2.5 h-2.5" />
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════════════════
export default function KronosKeep() {
  const qc = useQueryClient();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [timelineDate, setTimelineDate] = useState<string | null>(null);
  const [calendarId, setCalendarId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncConfig, setSyncConfig] = useState<RomeKronosConfig | null>(null);

  // The iCloud link, read once and again whenever the panel closes. Undefined
  // under `npm run dev` in a browser — there is no bridge there, and the
  // control is hidden rather than rendered inert.
  const kronosBridge = typeof window === "undefined" ? undefined : window.romeDesktop?.kronos;
  const refreshSyncConfig = useCallback(() => {
    if (!kronosBridge) return;
    void kronosBridge.getConfig().then(setSyncConfig).catch(() => undefined);
  }, [kronosBridge]);
  useEffect(refreshSyncConfig, [refreshSyncConfig]);

  const { data: calendars = [], isLoading: calLoading } = useQuery<KCalendar[]>({
    queryKey: ["/kronos/calendars"],
    queryFn: () => apiRequest("GET", "/api/kronos/calendars").then(r => r.json()),
  });

  const createCal = useMutation({
    mutationFn: (name: string) => apiRequest("POST", "/api/kronos/calendars", { name }).then(r => r.json()),
    onSuccess: (cal: KCalendar) => { qc.invalidateQueries({ queryKey: ["/kronos/calendars"] }); setCalendarId(cal.id); },
  });

  useEffect(() => {
    if (calLoading) return;
    if (calendars.length > 0 && !calendarId) setCalendarId(calendars[0].id);
    else if (calendars.length === 0 && !createCal.isPending) createCal.mutate("My Calendar");
  }, [calLoading, calendars]);

  const qk = useCallback((type: ItemType) => ["/kronos", calendarId, KRONOS_TYPE[type].plural], [calendarId]);

  // Four queries rather than a loop, because hooks cannot be called in one.
  const routines    = useQuery<KItem[]>({ queryKey: qk("routine"),    enabled: !!calendarId, queryFn: () => apiRequest("GET", `/api/kronos/calendars/${calendarId}/routines`).then(r => r.json()) });
  const assignments = useQuery<KItem[]>({ queryKey: qk("assignment"), enabled: !!calendarId, queryFn: () => apiRequest("GET", `/api/kronos/calendars/${calendarId}/assignments`).then(r => r.json()) });
  const events      = useQuery<KItem[]>({ queryKey: qk("event"),      enabled: !!calendarId, queryFn: () => apiRequest("GET", `/api/kronos/calendars/${calendarId}/events`).then(r => r.json()) });
  // `generals` is the newest table. If the migration has not been run it 404s,
  // and an empty array is the right answer — everything else still works.
  const generals    = useQuery<KItem[]>({ queryKey: qk("general"),    enabled: !!calendarId, retry: false, queryFn: () => apiRequest("GET", `/api/kronos/calendars/${calendarId}/generals`).then(r => r.json()).catch(() => []) });

  const items: ItemsByType = useMemo(() => ({
    routine: routines.data ?? [],
    assignment: assignments.data ?? [],
    event: events.data ?? [],
    general: generals.data ?? [],
  }), [routines.data, assignments.data, events.data, generals.data]);

  const invalidate = useCallback((type: ItemType) => {
    qc.invalidateQueries({ queryKey: qk(type) });
    qc.invalidateQueries({ queryKey: ["kronos-today"] });
  }, [qc, qk]);

  // ── Create ───────────────────────────────────────────────────────────────
  //
  // "Keep in library" plus a date is two rows, not one: the template you will
  // reuse, and the copy that sits on the day you just picked. Making the user
  // create the same thing twice to get both would be the old bug wearing a
  // different hat.
  const handleCreate = useCallback(async (type: ItemType, draft: ItemDraft) => {
    if (!calendarId) return;
    const meta = KRONOS_TYPE[type];
    const url = `/api/kronos/calendars/${calendarId}/${meta.plural}`;
    setSaving(true);
    try {
      if (draft.saved) {
        // The template carries no date, so it can never be drawn on the grid.
        const template: Record<string, unknown> = { ...draft, saved: true };
        if (meta.dateField) template[meta.dateField] = "";
        else { template.start_date = ""; template.end_date = ""; }
        await apiRequest("POST", url, template);

        const placedDate = meta.dateField
          ? String(draft[meta.dateField] ?? "")
          : String(draft.start_date ?? "");
        if (placedDate) {
          await apiRequest("POST", url, { ...draft, saved: false });
        }
      } else {
        await apiRequest("POST", url, { ...draft, saved: false });
      }
      invalidate(type);
    } finally {
      setSaving(false);
    }
  }, [calendarId, invalidate]);

  // ── Place a copy on a day ────────────────────────────────────────────────
  //
  // A POST, not a PATCH. This is the fix: the source row is untouched, so the
  // template stays in the library and any copy already sitting on another day
  // stays exactly where it is.
  const handlePlace = useCallback(async (type: ItemType, id: number, date: string) => {
    if (!calendarId) return;
    const source = items[type].find(r => r.id === id);
    if (!source) return;
    const meta = KRONOS_TYPE[type];
    await apiRequest("POST", `/api/kronos/calendars/${calendarId}/${meta.plural}`,
      placementBody(type, source as any, date));
    invalidate(type);
  }, [calendarId, items, invalidate]);

  const handleDelete = useCallback(async (type: ItemType, id: number) => {
    await apiRequest("DELETE", `/api/kronos/${KRONOS_TYPE[type].plural}/${id}`);
    invalidate(type);
  }, [invalidate]);

  /** Push a routine's window out to the end of the month currently on screen. */
  const handleExtend = useCallback(async (id: number) => {
    await apiRequest("PATCH", `/api/kronos/routines/${id}`, {
      end_date: fmt(year, month, daysInMonth(year, month)),
    });
    invalidate("routine");
  }, [year, month, invalidate]);

  const prevMonth = () => { if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1); };
  const goToday = () => { setYear(now.getFullYear()); setMonth(now.getMonth() + 1); };

  const handleDayClick = (dateStr: string) => {
    if (selectedDate === dateStr) setTimelineDate(dateStr);
    else setSelectedDate(dateStr);
  };

  const timelineItems = timelineDate ? itemsForDate(timelineDate, items) : [];

  if (calLoading || !calendarId) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground opacity-30" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[calc(100vh-120px)] relative">
      <div className="flex-1 flex flex-col overflow-hidden">
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
          <div className="flex items-center gap-2 ml-auto">
            {selectedDate ? (
              <>
                <span className="text-[10px] font-mono text-muted-foreground/50">{selectedDate} selected</span>
                <button onClick={() => setTimelineDate(selectedDate)}
                  className="flex items-center gap-1.5 text-[10px] font-mono px-2.5 py-1 rounded-lg transition-all"
                  style={{ color: GOLD, background: GOLD + "14", border: `1px solid ${GOLD}30` }}>
                  <Clock className="w-3 h-3" />
                  Open Timeline
                </button>
                <button onClick={() => setSelectedDate(null)} className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded">
                  <X className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              <p className="text-[10px] font-mono text-muted-foreground/30">Click a day to select · click again for timeline</p>
            )}

            {kronosBridge && (
              <button
                onClick={() => setSyncOpen(true)}
                title={syncConfig?.enabled
                  ? `Linked to ${syncConfig.calendarName} on iCloud — nothing syncs yet`
                  : "Connect an iCloud calendar"}
                className="flex items-center gap-1.5 text-[10px] font-mono px-2.5 py-1 rounded-lg transition-all"
                style={syncConfig?.enabled
                  ? { color: "hsl(195 60% 62%)", background: "hsl(195 60% 20% / .18)", border: "1px solid hsl(195 45% 34% / .6)" }
                  : { color: "hsl(220 8% 42%)", background: "transparent", border: "1px solid hsl(220 15% 16%)" }}
              >
                {syncConfig?.enabled ? <Cloud className="w-3 h-3" /> : <CloudOff className="w-3 h-3" />}
                {syncConfig?.enabled ? syncConfig.calendarName || "iCloud" : "iCloud"}
              </button>
            )}
          </div>
        </div>

        <CalendarGrid year={year} month={month} items={items}
          onDayClick={handleDayClick} selectedDate={selectedDate} />
      </div>

      <AddPanel
        items={items}
        selectedDate={selectedDate}
        viewYear={year}
        viewMonth={month}
        saving={saving}
        onCreate={handleCreate}
        onDelete={handleDelete}
        onPlace={handlePlace}
        onExtend={handleExtend}
      />

      <AnimatePresence>
        {timelineDate && (
          <DayTimeline dateStr={timelineDate} items={timelineItems} all={items}
            onClose={() => setTimelineDate(null)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {syncOpen && (
          <CalendarSyncPanel onClose={() => { setSyncOpen(false); refreshSyncConfig(); }} />
        )}
      </AnimatePresence>
    </div>
  );
}
