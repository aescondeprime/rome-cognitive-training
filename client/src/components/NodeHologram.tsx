/**
 * NodeHologram — the projected dossier that materialises when a node is flown to.
 *
 * Geometry
 * ────────
 * When a node is selected the camera translates it to the exact centre of the
 * viewport, and `NodeBranchMenu` fans its labels along the direction from the
 * node's *layout* position toward the layout centre. That direction is a pure
 * translation away from what you see on screen, so the branch fan always points
 * along `preferredAngle` and the free half of the screen is always the opposite
 * one. The panel is placed there, at a fixed radius from the centre, then
 * clamped into the viewport — which is what keeps a node parked in a corner
 * from projecting its dossier off the edge.
 *
 * The panel is a plain DOM overlay rather than SVG inside the camera layer:
 * text at 2.2× camera zoom would be resampled, and this needs to stay crisp.
 * It is `pointer-events: none` throughout, so clicking "through" it to dismiss
 * the node still works.
 *
 * Look
 * ────
 * Translucent fill over a blurred backdrop, fixed scanlines with one brighter
 * band sweeping down them, a chromatic split on the glyph and title, a
 * flicker-in built from an opacity keyframe array, a light that traces the
 * border, corner brackets, and a faint beam polygon running back to the node —
 * the projector, made visible.
 */

import { motion } from "framer-motion";
import type { ConstellationNode } from "@/lib/constellationData";

const PANEL_W = 272;
const PANEL_H = 210;   // estimate, used only for edge clamping
const RADIUS  = 268;   // distance from screen centre to panel centre
const EDGE    = 20;    // minimum gap to the viewport edge

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Same rule NodeBranchMenu uses to aim its fan. */
function preferredAngle(sx: number, sy: number, w: number, h: number) {
  return Math.atan2(h / 2 - sy, w / 2 - sx);
}

interface Props {
  node: ConstellationNode;
  /** Node position in layout (pre-camera) coordinates. */
  nodeX: number;
  nodeY: number;
  width: number;
  height: number;
  reduced?: boolean;
}

export default function NodeHologram({ node, nodeX, nodeY, width, height, reduced = false }: Props) {
  const branchA = preferredAngle(nodeX, nodeY, width, height);
  // Away from the branches, never into them.
  const dirX = -Math.cos(branchA);
  const dirY = -Math.sin(branchA);

  const cx = width / 2;
  const cy = height / 2;
  const px = clamp(cx + dirX * RADIUS, PANEL_W / 2 + EDGE, Math.max(PANEL_W / 2 + EDGE, width  - PANEL_W / 2 - EDGE));
  const py = clamp(cy + dirY * RADIUS, PANEL_H / 2 + EDGE, Math.max(PANEL_H / 2 + EDGE, height - PANEL_H / 2 - EDGE));

  // Beam runs from just outside the node out to the panel's near edge.
  const bdx = px - cx, bdy = py - cy;
  const blen = Math.hypot(bdx, bdy) || 1;
  const ux = bdx / blen, uy = bdy / blen;
  const nx = -uy, ny = ux;                      // unit normal
  const b0 = 58;                                // clear of the node's rings
  const b1 = Math.max(b0 + 8, blen - PANEL_W * 0.34);
  const beam = [
    [cx + ux * b0 + nx * 5,  cy + uy * b0 + ny * 5],
    [cx + ux * b0 - nx * 5,  cy + uy * b0 - ny * 5],
    [cx + ux * b1 - nx * 74, cy + uy * b1 - ny * 74],
    [cx + ux * b1 + nx * 74, cy + uy * b1 + ny * 74],
  ].map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");

  const accent = "hsl(var(--accent-h) var(--accent-s) var(--accent-l))";
  const subCount = node.subnodes.length;
  const pad = (n: number) => String(n).padStart(2, "0");

  const flickerIn = reduced
    ? { opacity: 1 }
    : { opacity: [0, 0.75, 0.12, 0.95, 0.4, 1] };
  const flickerTransition = reduced
    ? { duration: 0.2, delay: 0.2 }
    : { duration: 0.44, delay: 0.2, ease: "linear" as const, times: [0, 0.18, 0.3, 0.5, 0.66, 1] };

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 12, pointerEvents: "none" }}>
      {/* Projector beam */}
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <linearGradient id="holo-beam" gradientUnits="userSpaceOnUse" x1={cx} y1={cy} x2={px} y2={py}>
            <stop offset="0"    stopColor={accent} stopOpacity="0.16" />
            <stop offset="0.55" stopColor={accent} stopOpacity="0.05" />
            <stop offset="1"    stopColor={accent} stopOpacity="0.015" />
          </linearGradient>
        </defs>
        <motion.polygon
          points={beam}
          fill="url(#holo-beam)"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, delay: reduced ? 0.1 : 0.16 }}
        />
      </svg>

      {/* Panel */}
      <div style={{ position: "absolute", left: px, top: py, transform: "translate(-50%, -50%)" }}>
        <motion.div
          className="holo-panel"
          initial={{ opacity: 0, scaleY: reduced ? 1 : 0.82, y: reduced ? 0 : 6 }}
          animate={{ ...flickerIn, scaleY: 1, y: 0 }}
          exit={{ opacity: reduced ? 0 : [1, 0.35, 0.7, 0], scaleY: reduced ? 1 : 0.9 }}
          transition={flickerTransition}
          style={{ width: PANEL_W }}
        >
          {/* Scanlines + sweeping band */}
          <div className="holo-scan" />
          {!reduced && <div className="holo-sweep" />}

          {/* Border trace + corner brackets */}
          <svg className="holo-frame" viewBox="0 0 100 100" preserveAspectRatio="none">
            <rect
              x="0.4" y="0.4" width="99.2" height="99.2"
              fill="none" stroke={accent} strokeWidth="0.5"
              pathLength={1} strokeDasharray="0.13 0.87"
              className={reduced ? undefined : "holo-trace"}
              opacity="0.85" vectorEffect="non-scaling-stroke"
            />
          </svg>
          <span className="holo-corner holo-corner-tl" />
          <span className="holo-corner holo-corner-tr" />
          <span className="holo-corner holo-corner-bl" />
          <span className="holo-corner holo-corner-br" />

          {/* Content */}
          <div style={{ position: "relative", zIndex: 2, padding: "13px 15px 12px" }}>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "baseline",
              fontFamily: "DM Mono, monospace", fontSize: 6.5, letterSpacing: "0.24em",
              textTransform: "uppercase", color: "hsl(var(--accent-h) 40% 44%)",
            }}>
              <span>Projection</span>
              <span>{node.id.slice(0, 3).toUpperCase()}·{pad(Math.round(node.depth * 100))}</span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 11, marginTop: 9 }}>
              <span className="holo-chroma" style={{
                fontFamily: "'Cinzel', serif", fontSize: 30, lineHeight: 1,
                color: node.accent, opacity: 0.92,
              }}>{node.symbol}</span>
              <h2 className="holo-chroma" style={{
                fontFamily: "'Cinzel', serif", fontSize: 14, fontWeight: 600,
                letterSpacing: "0.13em", textTransform: "uppercase", margin: 0,
                color: "hsl(var(--accent-h) 70% 76%)",
              }}>{node.label}</h2>
            </div>

            <div className="holo-rule" />

            <p style={{
              fontFamily: "DM Mono, monospace", fontSize: 8, lineHeight: 1.7, margin: 0,
              letterSpacing: "0.05em", color: "hsl(var(--accent-h) 26% 62%)", opacity: 0.82,
            }}>{node.tagline}</p>

            <div style={{ display: "flex", gap: 16, marginTop: 12 }}>
              {[
                { k: "Sub-nodes", v: pad(subCount) },
                { k: "Links",     v: pad(node.connections.length) },
                { k: "Depth",     v: node.depth.toFixed(2) },
              ].map(stat => (
                <div key={stat.k}>
                  <div style={{
                    fontFamily: "DM Mono, monospace", fontSize: 6.5, letterSpacing: "0.2em",
                    textTransform: "uppercase", color: "hsl(var(--accent-h) 28% 38%)",
                  }}>{stat.k}</div>
                  <div style={{
                    fontFamily: "DM Mono, monospace", fontSize: 13, marginTop: 2,
                    letterSpacing: "0.04em", color: "hsl(var(--accent-h) 72% 68%)",
                    textShadow: `0 0 9px hsl(var(--accent-h) 90% 60% / 0.4)`,
                  }}>{stat.v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Projection base — the panel sits on a lit plate */}
          <div className="holo-base" />
        </motion.div>
      </div>
    </div>
  );
}
