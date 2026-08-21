/**
 * The Contingency Garden's canvas.
 *
 * Branches are laid out by `layoutGarden` and drawn as cards joined by bezier
 * edges. Dragging a card pins it: the tidy layout keeps its opinion about
 * everything else, so moving one branch never rearranges the rest. A layout
 * that re-flowed on every drag would fight you, and a layout you had to build
 * by hand would stop you sketching.
 *
 * Two click modes. Normally a click selects a branch for the inspector. While a
 * Plan tracer is armed, a click instead tags or untags that branch in the plan,
 * and every tagged branch glows in the plan's colour — which is the whole point
 * of the tracer: you trace a route through a tree you have already grown.
 */

import { useCallback, useRef, useState } from "react";
import { CornerDownRight, Flag, ListChecks, Plus } from "lucide-react";
import type { LaidOut, Plan } from "@/lib/gardenStore";
import { isTerminal } from "@/lib/gardenStore";

export const CARD_W = 236;
export const CARD_H = 84;
const PAD = 40;

const mono = "DM Mono, monospace";

interface Props {
  laid: LaidOut[];
  plans: Plan[];
  selectedId: string | null;
  /** Plan letter currently armed, or null. */
  tracer: string | null;
  onSelect: (id: string | null) => void;
  onTrace: (id: string) => void;
  onMove: (id: string, pos: { x: number; y: number }) => void;
  onSprout: (id: string) => void;
}

export default function GardenCanvas({
  laid, plans, selectedId, tracer, onSelect, onTrace, onMove, onSprout,
}: Props) {
  // Live drag position lives here rather than in the store: committing on every
  // pointermove would write to localStorage sixty times a second.
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const origin = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  const colorOf = useCallback((letters: string[]): string | null => {
    for (const plan of plans) if (letters.includes(plan.letter)) return plan.color;
    return null;
  }, [plans]);

  const position = (item: LaidOut) =>
    drag && drag.id === item.branch.id ? { x: drag.x, y: drag.y } : { x: item.x, y: item.y };

  const width = Math.max(...laid.map(l => position(l).x), 0) + CARD_W + PAD * 2;
  const height = Math.max(...laid.map(l => position(l).y), 0) + CARD_H + PAD * 2;

  function startDrag(e: React.PointerEvent, item: LaidOut) {
    if (tracer) return; // tracing is a click gesture, not a drag one
    const pos = position(item);
    origin.current = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y };
    setDrag({ id: item.branch.id, x: pos.x, y: pos.y });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function moveDrag(e: React.PointerEvent) {
    if (!drag || !origin.current) return;
    setDrag({
      id: drag.id,
      x: Math.max(0, origin.current.x + (e.clientX - origin.current.px)),
      y: Math.max(0, origin.current.y + (e.clientY - origin.current.py)),
    });
  }

  function endDrag(e: React.PointerEvent) {
    if (!drag || !origin.current) return;
    const moved = Math.abs(e.clientX - origin.current.px) + Math.abs(e.clientY - origin.current.py);
    // Under a few pixels this was a click, not a drag. Committing a position
    // here would pin every branch you ever selected.
    if (moved > 4) onMove(drag.id, { x: drag.x, y: drag.y });
    else onSelect(drag.id);
    setDrag(null);
    origin.current = null;
  }

  if (!laid.length) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border"
        style={{ minHeight: "50vh", borderColor: "hsl(var(--accent-h) 15% 14%)", borderStyle: "dashed" }}
      >
        <p className="text-[10px] tracking-[0.14em] uppercase" style={{ fontFamily: mono, color: "hsl(var(--accent-h) 25% 36%)" }}>
          Empty garden — plant a first action to begin
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border overflow-auto"
      style={{
        minHeight: "50vh", maxHeight: "68vh",
        background: "hsl(222 20% 5% / 0.55)",
        borderColor: "hsl(var(--accent-h) 15% 12%)",
        cursor: tracer ? "crosshair" : "default",
      }}
      onClick={e => { if (e.target === e.currentTarget) onSelect(null); }}
    >
      <div style={{ position: "relative", width, height, padding: PAD }}>
        {/* Edges sit behind the cards and ignore the pointer entirely. */}
        <svg
          width={width} height={height}
          style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        >
          {laid.map(item => {
            const parent = laid.find(p => p.branch.id === item.branch.parentId);
            if (!parent) return null;
            const a = position(parent);
            const b = position(item);
            const x1 = a.x + CARD_W + PAD;
            const y1 = a.y + CARD_H / 2 + PAD;
            const x2 = b.x + PAD;
            const y2 = b.y + CARD_H / 2 + PAD;
            const bend = Math.max(28, (x2 - x1) / 2);
            // An edge is "live" when parent and child are both on the same plan,
            // which makes a traced route legible as a line rather than as a set
            // of glowing boxes.
            const shared = item.branch.plans.find(l => parent.branch.plans.includes(l));
            const color = shared ? colorOf([shared]) : null;
            return (
              <path
                key={`edge-${item.branch.id}`}
                d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke={color ? `hsl(${color})` : "hsl(var(--accent-h) 30% 40%)"}
                strokeOpacity={color ? 0.55 : 0.22}
                strokeWidth={color ? 1.6 : 1}
              />
            );
          })}
        </svg>

        {laid.map(item => {
          const b = item.branch;
          const pos = position(item);
          const planColor = colorOf(b.plans);
          const selected = selectedId === b.id;
          const terminal = isTerminal(b);
          const done = b.checklist.filter(i => i.done).length;

          return (
            <div
              key={b.id}
              onPointerDown={e => {
                if (tracer) return;
                startDrag(e, item);
              }}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onClick={e => {
                e.stopPropagation();
                if (tracer) onTrace(b.id);
              }}
              style={{
                position: "absolute",
                left: pos.x + PAD,
                top: pos.y + PAD,
                width: CARD_W,
                minHeight: CARD_H,
                padding: "9px 11px",
                borderRadius: 10,
                background: "hsl(222 22% 8% / 0.95)",
                border: `1px solid ${
                  selected ? "hsl(var(--accent-h) 60% 46%)"
                  : planColor ? `hsl(${planColor} / 0.5)`
                  : "hsl(var(--accent-h) 15% 16%)"
                }`,
                boxShadow: planColor ? `0 0 14px hsl(${planColor} / 0.28)` : "none",
                cursor: tracer ? "crosshair" : drag?.id === b.id ? "grabbing" : "grab",
                userSelect: "none",
                touchAction: "none",
                zIndex: selected ? 3 : 2,
              }}
            >
              {/* Label — the reason you would take this branch. */}
              {b.label && (
                <p
                  className="truncate"
                  style={{
                    fontFamily: mono, fontSize: 7.5, letterSpacing: "0.14em", textTransform: "uppercase",
                    color: planColor ? `hsl(${planColor})` : "hsl(var(--accent-h) 45% 48%)",
                    margin: "0 0 3px",
                  }}
                >
                  {b.label}
                </p>
              )}

              <p
                style={{
                  fontSize: 11, lineHeight: 1.35,
                  color: b.action ? "hsl(214 20% 70%)" : "hsl(214 14% 34%)",
                  margin: 0,
                  display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
                }}
              >
                {b.action || "Untitled action"}
              </p>

              <div className="flex items-center gap-2.5 mt-2" style={{ fontFamily: mono, fontSize: 8 }}>
                <span style={{ color: "hsl(var(--accent-h) 40% 48%)" }}>{formatMinutes(b.durationMinutes)}</span>
                {terminal && (
                  <span className="flex items-center gap-1" style={{ color: "hsl(146 60% 52%)" }} title={b.goal}>
                    <Flag className="w-2.5 h-2.5" /> goal
                  </span>
                )}
                {b.checklist.length > 0 && (
                  <span className="flex items-center gap-1" style={{ color: "hsl(214 16% 42%)" }}>
                    <ListChecks className="w-2.5 h-2.5" /> {done}/{b.checklist.length}
                  </span>
                )}
                {b.plans.length > 0 && (
                  <span className="ml-auto" style={{ color: planColor ? `hsl(${planColor})` : undefined }}>
                    {b.plans.slice().sort().join("")}
                  </span>
                )}
              </div>

              {/* Sprout — hidden on a terminal branch, because a goal is where
                  the reasoning stops. */}
              {!terminal && !tracer && (
                <button
                  onPointerDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); onSprout(b.id); }}
                  title="Add a contingency"
                  className="absolute flex items-center justify-center transition-opacity"
                  style={{
                    right: -11, top: CARD_H / 2 - 11,
                    width: 22, height: 22, borderRadius: "50%",
                    background: "hsl(222 22% 10%)",
                    border: "1px solid hsl(var(--accent-h) 30% 26%)",
                    color: "hsl(var(--accent-h) 60% 60%)",
                    opacity: 0.75,
                    zIndex: 4,
                  }}
                >
                  <Plus className="w-3 h-3" />
                </button>
              )}

              {item.pinned && (
                <CornerDownRight
                  className="absolute w-2.5 h-2.5"
                  style={{ left: 4, bottom: 4, color: "hsl(var(--accent-h) 30% 30%)" }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}
