/**
 * ThreatsWidget — floating constellation widget for tracking threats/dangers.
 * Add, prioritize (1–3 ⚠), and resolve threats with a click.
 * Synced to Supabase per user. Draggable, collapsible, geometric/futuristic.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface Threat {
  id: number;
  title: string;
  priority: 1 | 2 | 3;
  resolved: boolean;
  created_at: number;
}

interface Props {
  pos: { x: number; y: number } | null;
  collapsed: boolean;
  onPosChange: (p: { x: number; y: number }) => void;
  onCollapsedChange: (c: boolean) => void;
}

const W = 230;

// ── Priority colors ────────────────────────────────────────────────────────
const PRIORITY_COLOR: Record<number, string> = {
  1: "hsl(45 95% 58%)",    // amber
  2: "hsl(22 90% 55%)",    // orange
  3: "hsl(0 75% 55%)",     // red
};
const PRIORITY_LABEL: Record<number, string> = { 1: "LOW", 2: "MED", 3: "HIGH" };

// ── Warning triangle icon ──────────────────────────────────────────────────
function WarnIcon({ color, size = 11 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <path d="M8 2 L14.5 13.5 L1.5 13.5 Z"
        stroke={color} strokeWidth="1.4" strokeLinejoin="round"
        fill={color.replace(")", " / 0.12)")} />
      <line x1="8" y1="6.5" x2="8" y2="10" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="12" r="0.9" fill={color} />
    </svg>
  );
}

// ── Corner bracket (same as other widgets) ─────────────────────────────────
function Corner({ deg = 0 }: { deg?: 0 | 90 | 180 | 270 }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
      style={{ transform: deg ? `rotate(${deg}deg)` : undefined, opacity: 0.65, flexShrink: 0 }}>
      <path d="M2 12 L2 2 L12 2"
        stroke="hsl(var(--accent-h) var(--accent-s) var(--accent-l))" strokeWidth="1.5" />
      <circle cx="2" cy="2" r="1.2"
        fill="hsl(var(--accent-h) var(--accent-s) var(--accent-l))" />
    </svg>
  );
}

// ── Priority selector (3 mini warn icons) ─────────────────────────────────
function PriorityPicker({ value, onChange }: { value: 1 | 2 | 3; onChange: (v: 1 | 2 | 3) => void }) {
  return (
    <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
      {([1, 2, 3] as const).map(p => (
        <button key={p} onClick={() => onChange(p)} title={PRIORITY_LABEL[p]}
          style={{
            background: "none", border: "none", cursor: "pointer", padding: 2,
            opacity: value >= p ? 1 : 0.2,
            transition: "opacity 0.15s",
          }}>
          <WarnIcon color={PRIORITY_COLOR[p]} size={10} />
        </button>
      ))}
    </div>
  );
}

export default function ThreatsWidget({ pos, collapsed, onPosChange, onCollapsedChange }: Props) {
  const DEFAULT_X = window.innerWidth - W - 24;
  const DEFAULT_Y = 560;
  const x = pos?.x ?? DEFAULT_X;
  const y = pos?.y ?? DEFAULT_Y;

  const qc = useQueryClient();
  const [newTitle, setNewTitle]     = useState("");
  const [newPriority, setNewPriority] = useState<1 | 2 | 3>(1);
  const [showAdd, setShowAdd]       = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (showAdd) inputRef.current?.focus(); }, [showAdd]);

  // ── Data ─────────────────────────────────────────────────────────────────
  const { data: threats = [], isLoading } = useQuery<Threat[]>({
    queryKey: ["threats"],
    queryFn:  () => apiRequest("GET", "/api/threats").then(r => r.json()),
    staleTime: 15_000,
  });

  const addThreat = useMutation({
    mutationFn: () => apiRequest("POST", "/api/threats", { title: newTitle.trim(), priority: newPriority }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["threats"] }); setNewTitle(""); setShowAdd(false); },
  });

  const toggleResolved = useMutation({
    mutationFn: ({ id, resolved }: { id: number; resolved: boolean }) =>
      apiRequest("PATCH", `/api/threats/${id}`, { resolved }).then(r => r.json()),
    onMutate: async ({ id, resolved }) => {
      await qc.cancelQueries({ queryKey: ["threats"] });
      const prev = qc.getQueryData<Threat[]>(["threats"]);
      qc.setQueryData<Threat[]>(["threats"], old => old?.map(t => t.id === id ? { ...t, resolved } : t) ?? []);
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(["threats"], ctx.prev); },
    onSettled: () => qc.invalidateQueries({ queryKey: ["threats"] }),
  });

  const deleteThreat = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/threats/${id}`).then(r => r.json()),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["threats"] });
      const prev = qc.getQueryData<Threat[]>(["threats"]);
      qc.setQueryData<Threat[]>(["threats"], old => old?.filter(t => t.id !== id) ?? []);
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(["threats"], ctx.prev); },
    onSettled: () => qc.invalidateQueries({ queryKey: ["threats"] }),
  });

  const changePriority = useMutation({
    mutationFn: ({ id, priority }: { id: number; priority: 1 | 2 | 3 }) =>
      apiRequest("PATCH", `/api/threats/${id}`, { priority }).then(r => r.json()),
    onMutate: async ({ id, priority }) => {
      const prev = qc.getQueryData<Threat[]>(["threats"]);
      qc.setQueryData<Threat[]>(["threats"], old => old?.map(t => t.id === id ? { ...t, priority } : t) ?? []);
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(["threats"], ctx.prev); },
    onSettled: () => qc.invalidateQueries({ queryKey: ["threats"] }),
  });

  // Sort: unresolved first, then by priority desc
  const sorted = [...threats].sort((a, b) => {
    if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
    return b.priority - a.priority;
  });
  const active   = sorted.filter(t => !t.resolved);
  const resolved = sorted.filter(t =>  t.resolved);

  // ── Drag ─────────────────────────────────────────────────────────────────
  const dragging   = useRef(false);
  const dragOffset = useRef({ dx: 0, dy: 0 });

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-nodrag]")) return;
    e.preventDefault();
    dragging.current   = true;
    dragOffset.current = { dx: e.clientX - x, dy: e.clientY - y };
    const onMove = (me: MouseEvent) => {
      if (!dragging.current) return;
      onPosChange({ x: Math.max(0, Math.min(window.innerWidth - W, me.clientX - dragOffset.current.dx)), y: Math.max(0, Math.min(window.innerHeight - 60, me.clientY - dragOffset.current.dy)) });
    };
    const onUp = () => { dragging.current = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [x, y, onPosChange]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest("[data-nodrag]")) return;
    const touch = e.touches[0];
    dragging.current   = true;
    dragOffset.current = { dx: touch.clientX - x, dy: touch.clientY - y };
    const onMove = (te: TouchEvent) => {
      if (!dragging.current) return;
      const t = te.touches[0];
      onPosChange({ x: Math.max(0, Math.min(window.innerWidth - W, t.clientX - dragOffset.current.dx)), y: Math.max(0, Math.min(window.innerHeight - 60, t.clientY - dragOffset.current.dy)) });
    };
    const onEnd = () => { dragging.current = false; window.removeEventListener("touchmove", onMove); window.removeEventListener("touchend", onEnd); };
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
  }, [x, y, onPosChange]);

  return (
    <div
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      style={{ position: "fixed", left: x, top: y, width: W, zIndex: 202, cursor: "grab", userSelect: "none", fontFamily: "DM Mono, monospace" }}
    >
      <div style={{
        background: "hsl(222 18% 7% / 0.90)", backdropFilter: "blur(14px)",
        border: "1px solid hsl(0 40% 25% / 0.4)",
        borderRadius: 2,
        boxShadow: "0 0 0 1px hsl(0 30% 10% / 0.6), 0 8px 32px hsl(0 30% 4% / 0.7), inset 0 1px 0 hsl(0 40% 30% / 0.06)",
        overflow: "hidden",
      }}>

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "6px 10px 5px",
          borderBottom: collapsed ? "none" : "1px solid hsl(0 25% 14% / 0.6)",
          background: "hsl(0 15% 5% / 0.7)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {/* Custom red corner bracket */}
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ opacity: 0.7 }}>
              <path d="M2 12 L2 2 L12 2" stroke="hsl(0 70% 55%)" strokeWidth="1.5" />
              <circle cx="2" cy="2" r="1.2" fill="hsl(0 70% 55%)" />
            </svg>
            <span style={{ fontSize: 9, letterSpacing: "0.22em", color: "hsl(0 65% 60%)", textTransform: "uppercase" }}>
              Threats
            </span>
            {!isLoading && active.length > 0 && (
              <span style={{
                fontSize: 7.5, letterSpacing: "0.1em",
                color: "hsl(0 65% 60%)", background: "hsl(0 40% 10% / 0.8)",
                border: "1px solid hsl(0 40% 22% / 0.6)", borderRadius: 2, padding: "1px 5px",
              }}>{active.length}</span>
            )}
          </div>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            {/* Add button */}
            {!collapsed && (
              <button data-nodrag="1" onClick={() => setShowAdd(s => !s)} title="Add threat"
                style={{
                  background: showAdd ? "hsl(0 40% 18% / 0.8)" : "none",
                  border: showAdd ? "1px solid hsl(0 50% 30%)" : "1px solid transparent",
                  borderRadius: 2, cursor: "pointer", padding: "2px 5px",
                  color: showAdd ? "hsl(0 65% 65%)" : "hsl(0 30% 45%)",
                  fontSize: 13, lineHeight: 1, transition: "all 0.15s",
                }}>+</button>
            )}
            {/* Collapse */}
            <button data-nodrag="1" onClick={() => onCollapsedChange(!collapsed)}
              style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 4px", color: "hsl(0 30% 42%)", lineHeight: 1, transition: "color 0.15s" }}
              onMouseEnter={e => (e.currentTarget.style.color = "hsl(0 60% 55%)")}
              onMouseLeave={e => (e.currentTarget.style.color = "hsl(0 30% 42%)")}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
                style={{ transform: collapsed ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
                <path d="M2 8 L6 4 L10 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* ── Body ───────────────────────────────────────────────────── */}
        {!collapsed && (
          <div style={{ padding: "8px 10px 10px" }}>

            {/* Add form */}
            {showAdd && (
              <div data-nodrag="1" style={{
                marginBottom: 8, padding: "8px 9px",
                background: "hsl(0 15% 5% / 0.8)",
                border: "1px solid hsl(0 30% 18% / 0.6)",
                borderRadius: 2,
              }}>
                <input
                  ref={inputRef}
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && newTitle.trim()) addThreat.mutate(); if (e.key === "Escape") { setShowAdd(false); setNewTitle(""); } }}
                  placeholder="Describe the threat..."
                  style={{
                    width: "100%", boxSizing: "border-box",
                    background: "transparent", border: "none", outline: "none",
                    color: "hsl(0 10% 80%)", fontFamily: "DM Mono, monospace",
                    fontSize: 10, letterSpacing: "0.04em",
                    marginBottom: 7,
                  }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ fontSize: 7, color: "hsl(0 20% 38%)", letterSpacing: "0.15em", textTransform: "uppercase" }}>Priority</span>
                    {([1, 2, 3] as const).map(p => (
                      <button key={p} data-nodrag="1" onClick={() => setNewPriority(p)} title={PRIORITY_LABEL[p]}
                        style={{ background: "none", border: "none", cursor: "pointer", padding: 2, opacity: newPriority >= p ? 1 : 0.22, transition: "opacity 0.15s" }}>
                        <WarnIcon color={PRIORITY_COLOR[p]} size={11} />
                      </button>
                    ))}
                  </div>
                  <button data-nodrag="1"
                    onClick={() => { if (newTitle.trim()) addThreat.mutate(); }}
                    disabled={!newTitle.trim() || addThreat.isPending}
                    style={{
                      fontFamily: "DM Mono, monospace", fontSize: 7.5, letterSpacing: "0.14em",
                      textTransform: "uppercase", padding: "3px 9px", borderRadius: 2, cursor: "pointer",
                      background: newTitle.trim() ? "hsl(0 50% 22% / 0.8)" : "hsl(0 15% 10%)",
                      border: `1px solid ${newTitle.trim() ? "hsl(0 50% 38%)" : "hsl(0 15% 18%)"}`,
                      color: newTitle.trim() ? "hsl(0 65% 65%)" : "hsl(0 15% 35%)",
                      transition: "all 0.15s",
                    }}>
                    {addThreat.isPending ? "…" : "Add"}
                  </button>
                </div>
              </div>
            )}

            {isLoading && (
              <div style={{ fontSize: 9, color: "hsl(0 20% 32%)", textAlign: "center", padding: "10px 0", letterSpacing: "0.15em" }}>LOADING…</div>
            )}

            {!isLoading && threats.length === 0 && !showAdd && (
              <div style={{ fontSize: 9, color: "hsl(0 15% 30%)", textAlign: "center", padding: "10px 0", letterSpacing: "0.13em", fontStyle: "italic" }}>
                No active threats
              </div>
            )}

            {/* Active threats */}
            <div data-nodrag="1" style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 200, overflowY: "auto" }}>
              {active.map(threat => (
                <ThreatRow key={threat.id} threat={threat}
                  onToggle={() => toggleResolved.mutate({ id: threat.id, resolved: true })}
                  onDelete={() => deleteThreat.mutate(threat.id)}
                  onPriority={p => changePriority.mutate({ id: threat.id, priority: p })}
                />
              ))}
            </div>

            {/* Divider + resolved */}
            {resolved.length > 0 && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 5, margin: "8px 0 5px" }}>
                  <div style={{ flex: 1, height: 1, background: "hsl(0 15% 13%)" }} />
                  <span style={{ fontSize: 7, color: "hsl(0 15% 28%)", letterSpacing: "0.18em", textTransform: "uppercase" }}>Neutralised</span>
                  <div style={{ flex: 1, height: 1, background: "hsl(0 15% 13%)" }} />
                </div>
                <div data-nodrag="1" style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 120, overflowY: "auto" }}>
                  {resolved.map(threat => (
                    <ThreatRow key={threat.id} threat={threat}
                      onToggle={() => toggleResolved.mutate({ id: threat.id, resolved: false })}
                      onDelete={() => deleteThreat.mutate(threat.id)}
                      onPriority={p => changePriority.mutate({ id: threat.id, priority: p })}
                    />
                  ))}
                </div>
              </>
            )}

            {/* Footer */}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 7 }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
                style={{ transform: "rotate(180deg)", opacity: 0.45 }}>
                <path d="M2 12 L2 2 L12 2" stroke="hsl(0 60% 45%)" strokeWidth="1.5" />
                <circle cx="2" cy="2" r="1.2" fill="hsl(0 60% 45%)" />
              </svg>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Single threat row ──────────────────────────────────────────────────────
function ThreatRow({ threat, onToggle, onDelete, onPriority }: {
  threat: Threat;
  onToggle: () => void;
  onDelete: () => void;
  onPriority: (p: 1 | 2 | 3) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const color = PRIORITY_COLOR[threat.priority];

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center", gap: 6, padding: "5px 7px",
        background: threat.resolved ? "hsl(0 10% 4% / 0.5)" : hovered ? "hsl(0 20% 8% / 0.8)" : "hsl(0 12% 5% / 0.6)",
        border: `1px solid ${threat.resolved ? "hsl(0 10% 11% / 0.4)" : hovered ? "hsl(0 35% 22% / 0.6)" : "hsl(0 20% 12% / 0.4)"}`,
        borderLeft: `2px solid ${threat.resolved ? "hsl(0 10% 20% / 0.4)" : color}`,
        borderRadius: 2, transition: "all 0.15s",
      }}
    >
      {/* Priority icons */}
      <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
        {([1, 2, 3] as const).map(p => (
          <button key={p} data-nodrag="1" onClick={() => onPriority(p)} title={PRIORITY_LABEL[p]}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 0, opacity: threat.resolved ? 0.25 : threat.priority >= p ? 0.9 : 0.18, transition: "opacity 0.12s" }}>
            <WarnIcon color={PRIORITY_COLOR[p]} size={9} />
          </button>
        ))}
      </div>

      {/* Title — click to resolve */}
      <button data-nodrag="1" onClick={onToggle}
        title={threat.resolved ? "Mark active" : "Mark neutralised"}
        style={{
          flex: 1, textAlign: "left", background: "none", border: "none", cursor: "pointer",
          fontFamily: "DM Mono, monospace", fontSize: 10,
          color: threat.resolved ? "hsl(0 10% 38%)" : "hsl(0 5% 78%)",
          textDecoration: threat.resolved ? "line-through" : "none",
          letterSpacing: "0.04em",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          transition: "color 0.15s",
        }}>
        {threat.title}
      </button>

      {/* Delete button — visible on hover */}
      {hovered && (
        <button data-nodrag="1" onClick={onDelete} title="Remove"
          style={{ background: "none", border: "none", cursor: "pointer", padding: "0 2px", flexShrink: 0, opacity: 0.5, transition: "opacity 0.15s" }}
          onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
          onMouseLeave={e => (e.currentTarget.style.opacity = "0.5")}>
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
            <path d="M1.5 1.5 L7.5 7.5 M7.5 1.5 L1.5 7.5" stroke="hsl(0 55% 52%)" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
