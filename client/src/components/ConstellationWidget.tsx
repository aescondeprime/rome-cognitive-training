/**
 * ConstellationWidget — floating time/date + Kronos agenda widget
 * Draggable, collapsible, geometric/futuristic design.
 * Position & collapsed state persisted via constellationLayout.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Clock } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { kronosType, type ItemType } from "@/lib/kronosTypes";
import {
  clockFace, formatWallTime, zoneNow, zoneLabel, systemZone,
  CLOCK_ZONES, DEFAULT_CLOCK_FORMAT,
  type ClockFormat, type ClockZone,
} from "@/lib/clockSettings";
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

// ── Types ──────────────────────────────────────────────────────────────────
interface AgendaItem {
  type: ItemType;
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
  /** 12- or 24-hour, and which zone the clock reads. See `clockSettings`. */
  clockFormat?: ClockFormat;
  clockTimeZone?: ClockZone;
  onClockFormatChange?: (format: ClockFormat) => void;
  onClockTimeZoneChange?: (zone: ClockZone) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAY_SHORT = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
const MON_SHORT = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

/**
 * The date the agenda is fetched for.
 *
 * Deliberately this machine's date, not the widget's chosen zone's. The clock
 * can be set to Tokyo to keep an eye on a colleague's afternoon; that does not
 * mean today's schedule became tomorrow's. What you scheduled is anchored to
 * the day you are living in.
 */
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
function TypeDot({ type }: { type: ItemType | string }) {
  // The glyph and colour come from the shared registry rather than a pair of
  // objects local to this file. The old version looked the type up in a bare
  // `Record<string, string>` and passed `undefined` straight into `d` and
  // `stroke` for anything it did not know about, which is a silently blank dot
  // — exactly what a fourth item type would have produced here.
  const meta = kronosType(type);
  if (!meta) return null;
  return (
    <svg width="12" height="12" viewBox="0 0 18 18" fill="none" style={{ flexShrink: 0, opacity: 0.9 }}>
      <path d={meta.dotPath} stroke={meta.color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The clock's settings, folded into the widget.
 *
 * Inline rather than a popover: the widget is `position: fixed` and can be
 * dragged anywhere, so a floating panel would have to work out which side of
 * itself has room, on a surface that is already doing that for the hologram.
 * Pushing the agenda down for as long as the panel is open costs nothing —
 * the panel closes the moment you have made the two choices in it.
 *
 * `data-nodrag` on the root, because every control in here is a click on a
 * surface whose whole job is otherwise to be dragged.
 */
function ClockSettings({
  format, zone, onFormatChange, onZoneChange,
}: {
  format: ClockFormat;
  zone: ClockZone;
  onFormatChange?: (format: ClockFormat) => void;
  onZoneChange?: (zone: ClockZone) => void;
}) {
  const system = useMemo(systemZone, []);

  return (
    <div
      data-nodrag="1"
      style={{
        margin: "0 0 10px",
        padding: "8px 9px 9px",
        border: "1px solid hsl(var(--accent-h) 25% 18% / 0.8)",
        background: "hsl(222 22% 6% / 0.7)",
        display: "flex", flexDirection: "column", gap: 8,
      }}
    >
      {/* ── 12 / 24 ─────────────────────────────────────────────────── */}
      <div>
        <div style={{ fontSize: 7, letterSpacing: "0.22em", color: "hsl(var(--accent-h) 35% 42%)", textTransform: "uppercase", marginBottom: 4 }}>
          Format
        </div>
        <div style={{ display: "flex", gap: 3 }}>
          {([
            { value: "12" as ClockFormat, label: "12 HR" },
            { value: "24" as ClockFormat, label: "24 HR" },
          ]).map(option => {
            const on = format === option.value;
            return (
              <button
                key={option.value}
                onClick={() => onFormatChange?.(option.value)}
                style={{
                  flex: 1,
                  padding: "3px 0",
                  cursor: "pointer",
                  fontFamily: "DM Mono, monospace", fontSize: 8, letterSpacing: "0.16em",
                  color: on ? "hsl(var(--accent-h) 90% 72%)" : "hsl(var(--accent-h) 25% 42%)",
                  background: on ? "hsl(var(--accent-h) 40% 14% / 0.9)" : "transparent",
                  border: `1px solid ${on ? "hsl(var(--accent-h) 45% 32%)" : "hsl(var(--accent-h) 20% 16%)"}`,
                  transition: "all 140ms ease",
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Zone ────────────────────────────────────────────────────── */}
      <div>
        <div style={{ fontSize: 7, letterSpacing: "0.22em", color: "hsl(var(--accent-h) 35% 42%)", textTransform: "uppercase", marginBottom: 4 }}>
          Timezone
        </div>
        <select
          value={zone ?? ""}
          onChange={e => onZoneChange?.(e.target.value || null)}
          title={zone ? zone : `System — ${system}`}
          style={{
            width: "100%",
            background: "hsl(222 20% 4%)",
            color: "hsl(var(--accent-h) 60% 62%)",
            border: "1px solid hsl(var(--accent-h) 25% 20%)",
            fontFamily: "DM Mono, monospace", fontSize: 8.5, letterSpacing: "0.1em",
            padding: "3px 4px", outline: "none", cursor: "pointer",
          }}
        >
          {/* The machine's own zone is named on the option rather than left as
              a bare "System", so the list says what choosing it will do. */}
          <option value="">SYSTEM · {system.split("/").pop()!.replace(/_/g, " ").toUpperCase()}</option>
          {/* A stored zone that is not on the short list still has to appear,
              or opening this panel would silently reset it to System. */}
          {zone && !CLOCK_ZONES.some(z => z.id === zone) && (
            <option value={zone}>{zoneLabel(zone).toUpperCase()}</option>
          )}
          {CLOCK_ZONES.map(z => (
            <option key={z.id} value={z.id}>{z.label.toUpperCase()}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ── Main widget ────────────────────────────────────────────────────────────
export default function ConstellationWidget({ pos, collapsed, onPosChange, onCollapsedChange, scale = 1, editing = false, onScaleChange, zoomed = false, focus = null, pinned = false, onPinnedChange, clockFormat = DEFAULT_CLOCK_FORMAT, clockTimeZone = null, onClockFormatChange, onClockTimeZoneChange }: Props) {
  const W = 220;
  const DEFAULT_X = window.innerWidth  - W - 24;
  const DEFAULT_Y = 80;

  const x = pos?.x ?? DEFAULT_X;
  const y = pos?.y ?? DEFAULT_Y;

  // Editor sizing and keep-on-screen. Scale is a transform, not a re-layout —
  // see the note at the top of `WidgetChrome`. `useWidgetFit` is what stops a
  // widget saved on a larger display from sitting past the edge of this one.
  const rootRef = useRef<HTMLDivElement>(null);
  const onWheelScale = useWidgetWheelScale(editing, scale, onScaleChange);
  useWidgetFit(rootRef, x, y, onPosChange, [scale, collapsed]);
  // Selecting a node flies it to screen centre, straight under any widget
  // parked there. Yielding is a fade, not a move — see `useWidgetYield`.
  const yielding = useWidgetYield(rootRef, zoomed, focus, [x, y, scale, collapsed]);

  // Closed by default and never persisted: it is a two-decision panel, not a
  // mode, and a widget that reopens holding a settings form is one that wastes
  // a third of its height on something you already finished.
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ── Clock tick ──────────────────────────────────────────────────────────
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  /**
   * Every field on the face comes from the chosen zone, not from the `Date`'s
   * own accessors. `now.getHours()` is this machine's hours and nothing else,
   * so reading the clock through `zoneNow` is what makes the zone setting mean
   * anything at all — including the date line, which is the part that actually
   * changes when you look at Tokyo from California.
   */
  const zoned = useMemo(() => zoneNow(now, clockTimeZone), [now, clockTimeZone]);
  const face  = clockFace(zoned, clockFormat);

  const hours   = face.hours;
  const minutes = face.minutes;
  const seconds = face.seconds;
  const dateNum = zoned.day;
  const monName = MONTHS[zoned.month - 1];
  const year    = zoned.year;

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
  const secFraction  = zoned.second / 60;
  const arcR         = 28;
  const arcCirc      = 2 * Math.PI * arcR;
  const arcDash      = arcCirc * (1 - secFraction);

  return (
    <div
      ref={rootRef}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      onWheel={editing ? onWheelScale : undefined}
      style={widgetRootStyle(x, y, W, scale, widgetYieldStyle(yielding))}
    >
      {editing && <WidgetScaleHandle scale={scale} onScaleChange={onScaleChange} width={W} />}
      {/* ── Outer shell ─────────────────────────────────────────────────── */}
      <div className={`rome-widget-shell${editing ? " is-editing" : ""}${zoomed ? " is-zoomed" : ""}`}>

        {/* ── Header bar (always visible) ──────────────────────────────── */}
        <div
          className={collapsed ? undefined : "rome-widget-rule"}
          style={{
            display:      "flex",
            alignItems:   "center",
            justifyContent: "space-between",
            padding:      "6px 10px 5px",
          }}
        >
          {/* Corner accent + day label */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Corner />
            <span style={{
              fontSize: 9, letterSpacing: "0.22em", color: "hsl(var(--accent-h) var(--accent-s) var(--accent-l))",
              textTransform: "uppercase",
            }}>
              {DAY_SHORT[zoned.weekday]} · {MON_SHORT[zoned.month - 1]} {dateNum}
            </span>
          </div>

          {/* Pin + collapse. The pin is what makes this widget follow you
              off the map; see `WidgetPinButton`. */}
          <div style={{ display: "flex", alignItems: "center", gap: 1 }}>
          {/* Clock settings. Hidden while collapsed — the panel it opens lives
              in the body, and there would be nowhere for it to appear. */}
          {!collapsed && (onClockFormatChange || onClockTimeZoneChange) && (
            <button
              data-nodrag="1"
              onClick={() => setSettingsOpen(open => !open)}
              title="Clock format and timezone"
              style={{
                background: "none", border: 0, cursor: "pointer", padding: "2px 3px",
                lineHeight: 0,
                color: settingsOpen
                  ? "hsl(var(--accent-h) var(--accent-s) var(--accent-l))"
                  : "hsl(var(--accent-h) 30% 38%)",
                transition: "color 150ms ease",
              }}
            >
              <Clock size={11} />
            </button>
          )}
          <WidgetPinButton pinned={pinned} onPinnedChange={onPinnedChange} />
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
        </div>

        {/* ── Expanded body ────────────────────────────────────────────── */}
        {!collapsed && (
          <div style={{ padding: "10px 12px 12px" }}>

            {settingsOpen && (
              <ClockSettings
                format={clockFormat}
                zone={clockTimeZone}
                onFormatChange={onClockFormatChange}
                onZoneChange={onClockTimeZoneChange}
              />
            )}

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
                  {/* The meridiem rides at the cap height of the digits rather
                      than on the baseline, so 12-hour mode does not make the
                      clock a line taller than 24-hour mode. */}
                  {face.meridiem && (
                    <span style={{
                      fontSize: 10, letterSpacing: "0.14em", marginLeft: 4,
                      verticalAlign: "top", opacity: 0.75,
                    }}>
                      {face.meridiem}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 8.5, color: "hsl(var(--accent-h) 30% 40%)", letterSpacing: "0.18em", marginTop: 2 }}>
                  {seconds}s · {monName.toUpperCase()} {year}
                  {/* Only when the clock is somewhere other than here. A zone
                      label on a clock showing your own time is noise; on one
                      showing someone else's it is the whole point. */}
                  {clockTimeZone && <> · {zoned.abbreviation}</>}
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
                      {formatWallTime(item.start_time, clockFormat)}
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
