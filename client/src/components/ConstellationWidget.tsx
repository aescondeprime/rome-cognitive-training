/**
 * ConstellationWidget — floating time/date + Kronos agenda widget
 * Draggable, collapsible, geometric/futuristic design.
 * Position & collapsed state persisted via constellationLayout.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

// ── Types ──────────────────────────────────────────────────────────────────
interface AgendaItem {
  type: "routine" | "assignment" | "event";
  id: number;
  title: string;
  color: string;
  start_time: string;
  duration_minutes: number;
}

interface Props {
  /** Current position (px from top-left of viewport), null = unset → default */
  pos: { x: number; y: number } | null;
  collapsed: boolean;
  onPosChange: (p: { x: number; y: number }) => void;
  onCollapsedChange: (c: boolean) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────
const DAYS   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAY_SHORT = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
const MON_SHORT = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

function fmtTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  const ampm = h < 12 ? "AM" : "PM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2,"0")} ${ampm}`;
}

function localDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

// ── SVG corner accent ──────────────────────────────────────────────────────
function Corner({ flip = false }: { flip?: boolean }) {
  return (
    <svg
      width="18" height="18" viewBox="0 0 18 18" fill="none"
      style={{ transform: flip ? "rotate(180deg)" : "none", opacity: 0.7 }}
    >
      <path d="M2 16 L2 2 L16 2" stroke="hsl(var(--accent-h) var(--accent-s) var(--accent-l))" strokeWidth="1.5" />
      <circle cx="2" cy="2" r="1.5" fill="hsl(var(--accent-h) var(--accent-s) var(--accent-l))" />
    </svg>
  );
}

// ── Type icon ─────────────────────────────────────────────────────────────
function TypeDot({ type }: { type: "routine" | "assignment" | "event" }) {
  const icons: Record<string, string> = {
    routine:    "M4 4 L4 14 M4 9 L14 9 M14 4 L14 14",   // grid-like refresh symbol
    assignment: "M5 3 L13 3 L13 15 L5 15 Z M7 7 L11 7 M7 10 L11 10",
    event:      "M3 6 L15 6 L15 15 L3 15 Z M7 3 L7 6 M11 3 L11 6",
  };
  const colors: Record<string, string> = {
    routine:    "hsl(var(--accent-h) 88% 60%)",
    assignment: "hsl(210 65% 62%)",
    event:      "hsl(270 60% 72%)",
  };
  return (
    <svg width="12" height="12" viewBox="0 0 18 18" fill="none" style={{ flexShrink: 0, opacity: 0.9 }}>
      <path d={icons[type]} stroke={colors[type]} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

// ── Main widget ────────────────────────────────────────────────────────────
export default function ConstellationWidget({ pos, collapsed, onPosChange, onCollapsedChange }: Props) {
  const W = 220;
  const DEFAULT_X = window.innerWidth  - W - 24;
  const DEFAULT_Y = 80;

  const x = pos?.x ?? DEFAULT_X;
  const y = pos?.y ?? DEFAULT_Y;

  // ── Clock tick ──────────────────────────────────────────────────────────
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const hours   = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  const dayName = DAYS[now.getDay()];
  const dateNum = now.getDate();
  const monName = MONTHS[now.getMonth()];
  const year    = now.getFullYear();

  // ── Agenda fetch ────────────────────────────────────────────────────────
  const dateStr = localDateStr();
  const { data: agenda = [], isLoading } = useQuery<AgendaItem[]>({
    queryKey: ["kronos-today", dateStr],
    queryFn:  () => apiRequest("GET", `/api/kronos/today?date=${dateStr}`).then(r => r.json()),
    staleTime: 60_000,
  });

  // ── Drag ────────────────────────────────────────────────────────────────
  const dragging   = useRef(false);
  const dragOffset = useRef({ dx: 0, dy: 0 });

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-nodrag]")) return;
    e.preventDefault();
    dragging.current   = true;
    dragOffset.current = { dx: e.clientX - x, dy: e.clientY - y };

    const onMove = (me: MouseEvent) => {
      if (!dragging.current) return;
      const nx = Math.max(0, Math.min(window.innerWidth  - W,      me.clientX - dragOffset.current.dx));
      const ny = Math.max(0, Math.min(window.innerHeight - 60,     me.clientY - dragOffset.current.dy));
      onPosChange({ x: nx, y: ny });
    };
    const onUp = () => { dragging.current = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [x, y, onPosChange]);

  // Touch drag
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest("[data-nodrag]")) return;
    const touch = e.touches[0];
    dragging.current   = true;
    dragOffset.current = { dx: touch.clientX - x, dy: touch.clientY - y };

    const onMove = (te: TouchEvent) => {
      if (!dragging.current) return;
      const t = te.touches[0];
      const nx = Math.max(0, Math.min(window.innerWidth  - W,      t.clientX - dragOffset.current.dx));
      const ny = Math.max(0, Math.min(window.innerHeight - 60,     t.clientY - dragOffset.current.dy));
      onPosChange({ x: nx, y: ny });
    };
    const onEnd = () => { dragging.current = false; window.removeEventListener("touchmove", onMove); window.removeEventListener("touchend", onEnd); };
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
  }, [x, y, onPosChange]);

  // ── Progress arc for the current minute ─────────────────────────────────
  const secFraction  = (now.getSeconds()) / 60;
  const arcR         = 28;
  const arcCirc      = 2 * Math.PI * arcR;
  const arcDash      = arcCirc * (1 - secFraction);

  return (
    <div
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      style={{
        position:  "fixed",
        left:      x,
        top:       y,
        width:     W,
        zIndex:    202,
        cursor:    "grab",
        userSelect: "none",
        fontFamily: "DM Mono, monospace",
      }}
    >
      {/* ── Outer shell ─────────────────────────────────────────────────── */}
      <div style={{
        background:   "hsl(222 18% 7% / 0.88)",
        backdropFilter: "blur(14px)",
        border:       "1px solid hsl(var(--accent-h) 30% 22% / 0.5)",
        borderRadius: 2,
        boxShadow:    "0 0 0 1px hsl(var(--accent-h) 20% 12% / 0.6), 0 8px 32px hsl(222 30% 4% / 0.7), inset 0 1px 0 hsl(var(--accent-h) 50% 40% / 0.08)",
        overflow:     "hidden",
      }}>

        {/* ── Header bar (always visible) ──────────────────────────────── */}
        <div style={{
          display:      "flex",
          alignItems:   "center",
          justifyContent: "space-between",
          padding:      "6px 10px 5px",
          borderBottom: collapsed ? "none" : "1px solid hsl(var(--accent-h) 20% 16% / 0.5)",
          background:   "hsl(222 20% 6% / 0.6)",
        }}>
          {/* Corner accent + day label */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Corner />
            <span style={{
              fontSize: 9, letterSpacing: "0.22em", color: "hsl(var(--accent-h) var(--accent-s) var(--accent-l))",
              textTransform: "uppercase",
            }}>
              {DAY_SHORT[now.getDay()]} · {MON_SHORT[now.getMonth()]} {dateNum}
            </span>
          </div>

          {/* Collapse toggle */}
          <button
            data-nodrag="1"
            onClick={() => onCollapsedChange(!collapsed)}
            title={collapsed ? "Expand" : "Collapse"}
            style={{
              background: "none", border: "none", cursor: "pointer", padding: "2px 4px",
              color: "hsl(var(--accent-h) 40% 45%)", lineHeight: 1,
              transition: "color 0.15s",
            }}
            onMouseEnter={e => (e.currentTarget.style.color = "hsl(var(--accent-h) var(--accent-s) var(--accent-l))")}
            onMouseLeave={e => (e.currentTarget.style.color = "hsl(var(--accent-h) 40% 45%)")}
          >
            {/* Chevron SVG */}
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
              style={{ transform: collapsed ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
              <path d="M2 8 L6 4 L10 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* ── Expanded body ────────────────────────────────────────────── */}
        {!collapsed && (
          <div style={{ padding: "10px 12px 12px" }}>

            {/* ── Clock display ─────────────────────────────────────── */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>

              {/* Digital clock */}
              <div>
                <div style={{
                  fontSize: 28, fontWeight: 300, letterSpacing: "0.06em",
                  color: "hsl(var(--accent-h) 90% 70%)",
                  lineHeight: 1,
                  textShadow: "0 0 18px hsl(var(--accent-h) 80% 55% / 0.45)",
                }}>
                  {hours}
                  <span style={{ opacity: 0.4, animation: "blink 1s step-end infinite" }}>:</span>
                  {minutes}
                </div>
                <div style={{ fontSize: 8.5, color: "hsl(var(--accent-h) 30% 40%)", letterSpacing: "0.18em", marginTop: 2 }}>
                  {seconds}s · {monName.toUpperCase()} {year}
                </div>
              </div>

              {/* Arc clock (seconds progress) */}
              <svg width={70} height={70} viewBox="0 0 70 70">
                {/* Tick marks */}
                {Array.from({ length: 12 }, (_, i) => {
                  const angle = (i / 12) * 2 * Math.PI - Math.PI / 2;
                  const r1 = 33, r2 = 36;
                  return (
                    <line key={i}
                      x1={35 + r1 * Math.cos(angle)} y1={35 + r1 * Math.sin(angle)}
                      x2={35 + r2 * Math.cos(angle)} y2={35 + r2 * Math.sin(angle)}
                      stroke="hsl(var(--accent-h) 30% 30%)" strokeWidth="1"
                    />
                  );
                })}
                {/* Track ring */}
                <circle cx="35" cy="35" r={arcR}
                  stroke="hsl(var(--accent-h) 20% 16%)" strokeWidth="3" fill="none" />
                {/* Progress arc */}
                <circle cx="35" cy="35" r={arcR}
                  stroke="hsl(var(--accent-h) var(--accent-s) var(--accent-l))"
                  strokeWidth="2.5" fill="none"
                  strokeDasharray={arcCirc}
                  strokeDashoffset={arcDash}
                  strokeLinecap="round"
                  transform="rotate(-90 35 35)"
                  style={{ transition: "stroke-dashoffset 0.9s linear", filter: "drop-shadow(0 0 4px hsl(var(--accent-h) 80% 50% / 0.5))" }}
                />
                {/* Center dot */}
                <circle cx="35" cy="35" r="3"
                  fill="hsl(var(--accent-h) var(--accent-s) var(--accent-l))" opacity="0.8" />
                {/* Second hand dot */}
                <circle
                  cx={35 + arcR * Math.cos((secFraction * 2 * Math.PI) - Math.PI / 2)}
                  cy={35 + arcR * Math.sin((secFraction * 2 * Math.PI) - Math.PI / 2)}
                  r="3"
                  fill="hsl(var(--accent-h) 90% 75%)"
                  style={{ filter: "drop-shadow(0 0 3px hsl(var(--accent-h) 80% 60% / 0.8))" }}
                />
              </svg>
            </div>

            {/* ── Divider ────────────────────────────────────────────── */}
            <div style={{
              display: "flex", alignItems: "center", gap: 6, marginBottom: 8,
            }}>
              <div style={{ flex: 1, height: 1, background: "hsl(var(--accent-h) 20% 16%)" }} />
              <span style={{ fontSize: 7.5, letterSpacing: "0.22em", color: "hsl(var(--accent-h) 40% 40%)", textTransform: "uppercase" }}>
                Today's Agenda
              </span>
              <div style={{ flex: 1, height: 1, background: "hsl(var(--accent-h) 20% 16%)" }} />
            </div>

            {/* ── Agenda list ────────────────────────────────────────── */}
            <div
              data-nodrag="1"
              style={{
                maxHeight: 180,
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              {isLoading && (
                <div style={{ fontSize: 9, color: "hsl(var(--accent-h) 25% 35%)", textAlign: "center", padding: "8px 0", letterSpacing: "0.15em" }}>
                  LOADING…
                </div>
              )}

              {!isLoading && agenda.length === 0 && (
                <div style={{
                  fontSize: 9, color: "hsl(var(--accent-h) 20% 32%)",
                  textAlign: "center", padding: "10px 0", letterSpacing: "0.14em",
                  fontStyle: "italic",
                }}>
                  No items scheduled
                </div>
              )}

              {agenda.map(item => (
                <div key={`${item.type}-${item.id}`} style={{
                  display:      "flex",
                  alignItems:   "flex-start",
                  gap:          7,
                  padding:      "5px 7px",
                  borderRadius: 2,
                  background:   "hsl(222 18% 5% / 0.7)",
                  border:       `1px solid ${item.color.replace(")", " / 0.18)").replace("hsl(", "hsl(")}`,
                  borderLeft:   `2px solid ${item.color}`,
                }}>
                  <TypeDot type={item.type} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 10, color: "hsl(220 15% 82%)",
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      letterSpacing: "0.04em",
                    }}>
                      {item.title}
                    </div>
                    <div style={{
                      fontSize: 8, color: "hsl(220 12% 45%)", marginTop: 1.5,
                      letterSpacing: "0.12em",
                    }}>
                      {fmtTime(item.start_time)}
                      {item.duration_minutes > 0 && ` · ${item.duration_minutes}min`}
                    </div>
                  </div>
                  {/* Type badge */}
                  <span style={{
                    fontSize: 6.5, letterSpacing: "0.16em", textTransform: "uppercase",
                    color: item.color, opacity: 0.75, marginTop: 1, flexShrink: 0,
                  }}>
                    {item.type}
                  </span>
                </div>
              ))}
            </div>

            {/* ── Footer corner ──────────────────────────────────────── */}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
              <Corner flip />
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes blink { 0%,100%{opacity:.4} 50%{opacity:1} }
      `}</style>
    </div>
  );
}
