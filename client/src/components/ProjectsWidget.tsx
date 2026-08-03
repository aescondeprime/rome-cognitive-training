/**
 * ProjectsWidget — floating constellation widget listing Idea Workshop boards.
 * Clicking a project navigates to /idea-workshop?board=ID.
 * Draggable, collapsible, futuristic geometric design matching ConstellationWidget.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";

interface Board {
  id: number;
  type: string;
  title: string;
  created_at: number;
  updated_at: number;
}

interface Props {
  pos: { x: number; y: number } | null;
  collapsed: boolean;
  onPosChange: (p: { x: number; y: number }) => void;
  onCollapsedChange: (c: boolean) => void;
}

const W = 210;

// ── Corner bracket ─────────────────────────────────────────────────────────
function Corner({ flip = false, rotate90 = false }: { flip?: boolean; rotate90?: boolean }) {
  let transform = "";
  if (flip && rotate90) transform = "rotate(270deg)";
  else if (flip)    transform = "rotate(180deg)";
  else if (rotate90) transform = "rotate(90deg)";
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
      style={{ transform, opacity: 0.65, flexShrink: 0 }}>
      <path d="M2 12 L2 2 L12 2" stroke="hsl(var(--accent-h) var(--accent-s) var(--accent-l))" strokeWidth="1.5" />
      <circle cx="2" cy="2" r="1.2" fill="hsl(var(--accent-h) var(--accent-s) var(--accent-l))" />
    </svg>
  );
}

// ── Hex bullet ─────────────────────────────────────────────────────────────
function HexIcon({ active }: { active?: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0 }}>
      <polygon
        points="6,1 10.5,3.5 10.5,8.5 6,11 1.5,8.5 1.5,3.5"
        stroke={active ? "hsl(var(--accent-h) var(--accent-s) var(--accent-l))" : "hsl(var(--accent-h) 30% 35%)"}
        strokeWidth="1.2"
        fill={active ? "hsl(var(--accent-h) 50% 20% / 0.5)" : "none"}
      />
    </svg>
  );
}

export default function ProjectsWidget({ pos, collapsed, onPosChange, onCollapsedChange }: Props) {
  const DEFAULT_X = window.innerWidth - W - 24;
  const DEFAULT_Y = 340; // below the clock widget
  const x = pos?.x ?? DEFAULT_X;
  const y = pos?.y ?? DEFAULT_Y;

  const [, navigate] = useLocation();
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  // ── Fetch idea_workshop boards ──────────────────────────────────────────
  const { data: boards = [], isLoading } = useQuery<Board[]>({
    queryKey: ["/boards", "idea_workshop"],
    queryFn:  () => apiRequest("GET", "/api/boards?type=idea_workshop").then(r => r.json()),
    staleTime: 30_000,
  });

  // Sort: most recently updated first
  const sorted = [...boards].sort((a, b) => b.updated_at - a.updated_at);

  // ── Navigate to workshop and open board ────────────────────────────────
  const openBoard = useCallback((board: Board) => {
    // Navigate to the idea-workshop page, encoding board id in hash query
    navigate(`/idea-workshop?board=${board.id}`);
  }, [navigate]);

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
      const nx = Math.max(0, Math.min(window.innerWidth  - W,   me.clientX - dragOffset.current.dx));
      const ny = Math.max(0, Math.min(window.innerHeight - 60,  me.clientY - dragOffset.current.dy));
      onPosChange({ x: nx, y: ny });
    };
    const onUp = () => { dragging.current = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",  onUp);
  }, [x, y, onPosChange]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest("[data-nodrag]")) return;
    const touch = e.touches[0];
    dragging.current   = true;
    dragOffset.current = { dx: touch.clientX - x, dy: touch.clientY - y };
    const onMove = (te: TouchEvent) => {
      if (!dragging.current) return;
      const t = te.touches[0];
      const nx = Math.max(0, Math.min(window.innerWidth  - W,   t.clientX - dragOffset.current.dx));
      const ny = Math.max(0, Math.min(window.innerHeight - 60,  t.clientY - dragOffset.current.dy));
      onPosChange({ x: nx, y: ny });
    };
    const onEnd = () => { dragging.current = false; window.removeEventListener("touchmove", onMove); window.removeEventListener("touchend", onEnd); };
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend",  onEnd);
  }, [x, y, onPosChange]);

  // Format relative time
  function relTime(ts: number) {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 2)   return "just now";
    if (mins < 60)  return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs  < 24)  return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7)   return `${days}d ago`;
    return `${Math.floor(days / 7)}w ago`;
  }

  return (
    <div
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      style={{
        position:   "fixed",
        left:       x,
        top:        y,
        width:      W,
        zIndex:     202,
        cursor:     "grab",
        userSelect: "none",
        fontFamily: "DM Mono, monospace",
      }}
    >
      {/* ── Shell ──────────────────────────────────────────────────────── */}
      <div style={{
        background:     "hsl(222 18% 7% / 0.88)",
        backdropFilter: "blur(14px)",
        border:         "1px solid hsl(var(--accent-h) 30% 22% / 0.5)",
        borderRadius:   2,
        boxShadow:      "0 0 0 1px hsl(var(--accent-h) 20% 12% / 0.6), 0 8px 32px hsl(222 30% 4% / 0.7), inset 0 1px 0 hsl(var(--accent-h) 50% 40% / 0.08)",
        overflow:       "hidden",
      }}>

        {/* ── Header ───────────────────────────────────────────────────── */}
        <div style={{
          display:        "flex",
          alignItems:     "center",
          justifyContent: "space-between",
          padding:        "6px 10px 5px",
          borderBottom:   collapsed ? "none" : "1px solid hsl(var(--accent-h) 20% 16% / 0.5)",
          background:     "hsl(222 20% 6% / 0.6)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Corner />
            <span style={{
              fontSize: 9, letterSpacing: "0.22em",
              color: "hsl(var(--accent-h) var(--accent-s) var(--accent-l))",
              textTransform: "uppercase",
            }}>
              Projects
            </span>
            {!isLoading && (
              <span style={{
                fontSize: 7.5, letterSpacing: "0.1em",
                color: "hsl(var(--accent-h) 30% 38%)",
                background: "hsl(var(--accent-h) 20% 10% / 0.6)",
                border: "1px solid hsl(var(--accent-h) 25% 20% / 0.5)",
                borderRadius: 2,
                padding: "1px 5px",
              }}>
                {sorted.length}
              </span>
            )}
          </div>

          {/* Collapse toggle */}
          <button
            data-nodrag="1"
            onClick={() => onCollapsedChange(!collapsed)}
            title={collapsed ? "Expand" : "Collapse"}
            style={{
              background: "none", border: "none", cursor: "pointer", padding: "2px 4px",
              color: "hsl(var(--accent-h) 40% 45%)", lineHeight: 1, transition: "color 0.15s",
            }}
            onMouseEnter={e => (e.currentTarget.style.color = "hsl(var(--accent-h) var(--accent-s) var(--accent-l))")}
            onMouseLeave={e => (e.currentTarget.style.color = "hsl(var(--accent-h) 40% 45%)")}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
              style={{ transform: collapsed ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
              <path d="M2 8 L6 4 L10 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* ── Body ─────────────────────────────────────────────────────── */}
        {!collapsed && (
          <div style={{ padding: "8px 10px 10px" }}>

            {isLoading && (
              <div style={{ fontSize: 9, color: "hsl(var(--accent-h) 25% 35%)", textAlign: "center", padding: "10px 0", letterSpacing: "0.15em" }}>
                LOADING…
              </div>
            )}

            {!isLoading && sorted.length === 0 && (
              <div style={{ fontSize: 9, color: "hsl(var(--accent-h) 20% 32%)", textAlign: "center", padding: "10px 0", letterSpacing: "0.13em", fontStyle: "italic" }}>
                No workshops yet
              </div>
            )}

            <div data-nodrag="1" style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 220, overflowY: "auto" }}>
              {sorted.map((board, i) => {
                const isHovered = hoveredId === board.id;
                return (
                  <button
                    key={board.id}
                    data-nodrag="1"
                    onClick={() => openBoard(board)}
                    onMouseEnter={() => setHoveredId(board.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    style={{
                      display:        "flex",
                      alignItems:     "center",
                      gap:            8,
                      width:          "100%",
                      textAlign:      "left",
                      padding:        "6px 8px",
                      background:     isHovered
                        ? "hsl(var(--accent-h) 30% 14% / 0.7)"
                        : "hsl(222 18% 5% / 0.5)",
                      border:         `1px solid ${isHovered
                        ? "hsl(var(--accent-h) 50% 30% / 0.6)"
                        : "hsl(var(--accent-h) 20% 14% / 0.4)"}`,
                      borderLeft:     `2px solid ${isHovered
                        ? "hsl(var(--accent-h) var(--accent-s) var(--accent-l))"
                        : "hsl(var(--accent-h) 40% 30% / 0.5)"}`,
                      borderRadius:   2,
                      cursor:         "pointer",
                      transition:     "background 0.15s, border 0.15s",
                    }}
                  >
                    <HexIcon active={isHovered} />

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize:      10.5,
                        color:         isHovered
                          ? "hsl(var(--accent-h) 90% 72%)"
                          : "hsl(220 15% 75%)",
                        letterSpacing: "0.04em",
                        whiteSpace:    "nowrap",
                        overflow:      "hidden",
                        textOverflow:  "ellipsis",
                        transition:    "color 0.15s",
                      }}>
                        {board.title}
                      </div>
                      <div style={{
                        fontSize:      7.5,
                        color:         "hsl(var(--accent-h) 20% 38%)",
                        letterSpacing: "0.12em",
                        marginTop:     1.5,
                      }}>
                        {relTime(board.updated_at)}
                      </div>
                    </div>

                    {/* Arrow indicator */}
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
                      style={{ opacity: isHovered ? 0.8 : 0.2, transition: "opacity 0.15s", flexShrink: 0 }}>
                      <path d="M2 5 L8 5 M5 2 L8 5 L5 8" stroke="hsl(var(--accent-h) var(--accent-s) var(--accent-l))" strokeWidth="1.3" strokeLinecap="round" />
                    </svg>
                  </button>
                );
              })}
            </div>

            {/* Footer */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 7 }}>
              <span style={{ fontSize: 7, color: "hsl(var(--accent-h) 20% 28%)", letterSpacing: "0.14em", textTransform: "uppercase" }}>
                Idea Workshop
              </span>
              <Corner flip rotate90 />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
