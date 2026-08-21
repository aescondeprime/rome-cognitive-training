/**
 * NanoTransition — the constellation assembling and disassembling itself.
 *
 * The map used to arrive on a 300ms opacity fade, which reads as a dissolve:
 * soft, atmospheric, and completely wrong for a machine. This draws it being
 * *built* instead — a field of small plates streaming in from the ⊕ trigger at
 * the bottom of the screen, snapping onto a grid, flaring as they land, and
 * then vanishing to reveal the map underneath. Leaving runs the same field in
 * reverse: the plates re-materialise over the map and collapse back toward the
 * point you pressed.
 *
 * Drawn on one canvas rather than as DOM nodes. A 30px grid over a large
 * display is well over a thousand cells, and a thousand elements being
 * transformed per frame would drop the very transition it was meant to sell.
 *
 * Timing is the whole trick. The delay on each plate comes from its distance to
 * the seed point, so the build sweeps outward from the button and the collapse
 * runs inward to it. Each plate's own travel is short — the sweep is what makes
 * it feel like a mechanism, not the individual animations.
 */

import { useEffect, useRef } from "react";

export type NanoMode = "build" | "deconstruct";

interface Props {
  mode: NanoMode;
  /** Total wall-clock for the sweep, ms. Should match the caller's timer. */
  duration: number;
  /** Sits above the map (200) so plates occlude it while they travel. */
  zIndex?: number;
}

/** Target grid pitch. Grows on big displays so the plate count stays sane. */
const BASE_CELL = 30;
const MAX_CELLS = 1500;
/** Share of the duration spent staggering; the rest is one plate's own travel. */
const SWEEP = 0.55;

interface Plate {
  /** Grid position — where the plate belongs when the map is whole. */
  tx: number;
  ty: number;
  /** Scatter offset it travels from (build) or to (deconstruct). */
  ox: number;
  oy: number;
  rot: number;
  delay: number;
  size: number;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export default function NanoTransition({ mode, duration, zIndex = 203 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.scale(dpr, dpr);

    // Read the accent once. The user retunes it live in the Constellation
    // editor, so it can never be hard-coded — but it also cannot change
    // mid-transition, and reading it per frame would cost a layout flush.
    const root = getComputedStyle(document.documentElement);
    const hue = root.getPropertyValue("--accent-h").trim() || "43";
    const sat = root.getPropertyValue("--accent-s").trim() || "88%";

    // Seed at the ⊕ trigger: the map grows out of the control you pressed.
    const sx = w / 2;
    const sy = h * 0.92;

    let cell = BASE_CELL;
    while ((Math.ceil(w / cell) * Math.ceil(h / cell)) > MAX_CELLS) cell += 4;
    const cols = Math.ceil(w / cell);
    const rows = Math.ceil(h / cell);

    const maxDist = Math.hypot(Math.max(sx, w - sx), Math.max(sy, h - sy)) || 1;
    const plates: Plate[] = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tx = c * cell + cell / 2;
        const ty = r * cell + cell / 2;
        const dist = Math.hypot(tx - sx, ty - sy) / maxDist;
        // Build sweeps outward from the seed; deconstruct collapses inward.
        const wave = mode === "build" ? dist : 1 - dist;
        const angle = Math.atan2(ty - sy, tx - sx) + (Math.random() - 0.5) * 1.1;
        const throw_ = cell * (1.6 + Math.random() * 2.6);
        plates.push({
          tx, ty,
          ox: Math.cos(angle) * throw_,
          oy: Math.sin(angle) * throw_ - cell * 0.8,
          rot: (Math.random() - 0.5) * 1.4,
          // A little jitter stops the sweep reading as a clean expanding ring.
          delay: Math.min(0.98, Math.max(0, wave * SWEEP + Math.random() * 0.07)),
          size: cell * (0.5 + Math.random() * 0.22),
        });
      }
    }

    const travel = 1 - SWEEP;
    const start = performance.now();
    let raf = 0;

    function frame(now: number) {
      const global = Math.min(1, (now - start) / duration);
      ctx!.clearRect(0, 0, w, h);

      for (const p of plates) {
        // Each plate's own 0→1 progress within its slice of the sweep.
        let u = (global - p.delay) / travel;
        if (u <= 0) {
          // Not started. On deconstruct the map is still whole here, so the
          // plate has to be drawn sitting in place or the field would appear
          // out of nothing.
          if (mode === "build") continue;
          u = 0;
        }
        if (u >= 1) {
          // Finished: built plates have handed off to the map beneath and
          // deconstructed ones have flown away. Either way, nothing to draw.
          continue;
        }

        const e = easeOutCubic(u);
        // Build travels scatter → grid; deconstruct travels grid → scatter.
        const k = mode === "build" ? 1 - e : e;
        const x = p.tx + p.ox * k;
        const y = p.ty + p.oy * k;

        // Fade in, flare on arrival, then clear out of the way.
        let alpha: number;
        if (mode === "build") {
          alpha = u < 0.7 ? (u / 0.7) * 0.85 : (1 - (u - 0.7) / 0.3) * 0.85;
        } else {
          alpha = u < 0.25 ? (u / 0.25) * 0.85 : (1 - (u - 0.25) / 0.75) * 0.85;
        }
        if (alpha <= 0.01) continue;

        const landing = mode === "build" && u > 0.62 && u < 0.82;
        const half = p.size / 2;

        ctx!.save();
        ctx!.translate(x, y);
        ctx!.rotate(p.rot * k);
        ctx!.lineWidth = 1;
        ctx!.strokeStyle = `hsl(${hue} ${sat} ${landing ? 82 : 62}% / ${alpha})`;
        ctx!.fillStyle = `hsl(${hue} ${sat} 58% / ${alpha * (landing ? 0.3 : 0.12)})`;
        ctx!.beginPath();
        ctx!.rect(-half, -half, p.size, p.size);
        ctx!.fill();
        ctx!.stroke();
        ctx!.restore();
      }

      if (global < 1) raf = requestAnimationFrame(frame);
      else ctx!.clearRect(0, 0, w, h);
    }

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [mode, duration]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        zIndex,
        pointerEvents: "none",
      }}
    />
  );
}
