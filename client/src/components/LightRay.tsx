/**
 * LightRay — physics light beam from the top edge of the screen.
 *
 * Source drifts left↔right along the top (just off-screen).
 * The beam fans downward, hits cards and nodes with directional gold glow.
 * All instances share lightRayState.ts so the ray is perfectly synced.
 */

import { useEffect, useRef } from "react";
import { getRayState, startRayClock, computeSourcePos } from "@/lib/lightRayState";

interface Props {
  zIndex?: number;
}

const RAY_HALF_ANGLE_DEG = 18;  // wider fan — light from above spreads across the scene
const BEAM_LAYERS        = 6;
const BASE_ALPHA         = 0.13; // peak opacity of core beam
const MOTE_COUNT         = 10;

export default function LightRay({ zIndex = 2 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);

  useEffect(() => {
    startRayClock();

    const canvas = canvasRef.current;
    if (!canvas) return;

    let w = window.innerWidth;
    let h = window.innerHeight;
    canvas.width  = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d")!;

    // ── Card glow ─────────────────────────────────────────────────────────
    function updateCardGlow(srcXpx: number, srcYpx: number) {
      const cards = document.querySelectorAll<HTMLElement>(".rome-card");
      cards.forEach(card => {
        const rect = card.getBoundingClientRect();
        if (rect.width === 0) return;

        const cardCx = (rect.left + rect.right) / 2;
        const cardCy = (rect.top  + rect.bottom) / 2;

        const dx   = cardCx - srcXpx;
        const dy   = cardCy - srcYpx;
        const dist = Math.sqrt(dx * dx + dy * dy) / Math.max(w, h);

        const falloff   = Math.max(0, 1 - dist * 1.3);
        const intensity = falloff * falloff * falloff;

        const rayAngle  = Math.atan2(dy, dx);
        const glowOffX  = -Math.cos(rayAngle) * 18 * intensity;
        const glowOffY  = -Math.sin(rayAngle) * 18 * intensity;
        const glowBlur  = 16 + intensity * 26;
        const glowAlpha = (intensity * 0.38 + 0.02).toFixed(3);
        const innerAlpha= (intensity * 0.30 + 0.05).toFixed(3);

        const borderAlpha = (intensity * 0.65 + 0.16).toFixed(2);
        card.style.borderColor = `hsl(43 65% 42% / ${borderAlpha})`;

        card.style.boxShadow = [
          `3px 6px 28px hsl(220 25% 2% / 0.7)`,
          `inset ${(-glowOffX * 0.15).toFixed(1)}px ${(-glowOffY * 0.15).toFixed(1)}px 0 hsl(43 75% 60% / ${innerAlpha})`,
          `${glowOffX.toFixed(1)}px ${glowOffY.toFixed(1)}px ${glowBlur.toFixed(0)}px hsl(43 88% 55% / ${glowAlpha})`,
        ].join(", ");
      });
    }

    // ── Draw loop ──────────────────────────────────────────────────────────
    function draw() {
      const state = getRayState();
      const { sx, sy } = computeSourcePos(state.t);

      const srcX = sx * w;
      const srcY = sy * h; // will be slightly negative (above screen)

      ctx.clearRect(0, 0, w, h);

      const halfAngle = (RAY_HALF_ANGLE_DEG * Math.PI) / 180;

      // Beam aims straight down toward lower-center of screen
      const targetX  = w * 0.5;
      const targetY  = h * 0.65;
      const baseAngle = Math.atan2(targetY - srcY, targetX - srcX);
      const farDist  = Math.sqrt(w * w + h * h) * 1.5;

      // ── Layered beam fan ───────────────────────────────────────────────
      for (let layer = BEAM_LAYERS; layer >= 1; layer--) {
        const frac   = layer / BEAM_LAYERS;
        const spread = halfAngle * frac * 2.4;
        const alpha  = BASE_ALPHA * (1 - frac * 0.42);

        const leftAngle  = baseAngle - spread;
        const rightAngle = baseAngle + spread;

        const x1 = srcX + Math.cos(leftAngle)  * farDist;
        const y1 = srcY + Math.sin(leftAngle)  * farDist;
        const x2 = srcX + Math.cos(rightAngle) * farDist;
        const y2 = srcY + Math.sin(rightAngle) * farDist;

        const gx = srcX + Math.cos(baseAngle) * farDist;
        const gy = srcY + Math.sin(baseAngle) * farDist;
        const grad = ctx.createLinearGradient(srcX, srcY, gx, gy);

        // Rich gold — slightly cooler (more white) near entry, warm deeper in
        grad.addColorStop(0,    `hsla(42,  98%, 92%, ${(alpha * 0.6).toFixed(3)})`);
        grad.addColorStop(0.03, `hsla(43,  95%, 80%, ${alpha.toFixed(3)})`);
        grad.addColorStop(0.15, `hsla(43,  90%, 70%, ${(alpha * 0.78).toFixed(3)})`);
        grad.addColorStop(0.40, `hsla(44,  82%, 60%, ${(alpha * 0.40).toFixed(3)})`);
        grad.addColorStop(0.72, `hsla(45,  72%, 48%, ${(alpha * 0.14).toFixed(3)})`);
        grad.addColorStop(1,    `hsla(45,  60%, 36%, 0)`);

        ctx.beginPath();
        ctx.moveTo(srcX, srcY);
        ctx.lineTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // ── Entry bloom — white-gold halo at the top edge where beam enters ─
      // Source is above screen; bloom sits just inside the top edge
      const bloomY   = Math.max(0, srcY + Math.abs(srcY) + 4); // just inside top
      const bloomX   = Math.max(20, Math.min(w - 20, srcX));
      const bloomR   = Math.min(w, h) * 0.18;
      const bloom    = ctx.createRadialGradient(bloomX, bloomY, 0, bloomX, bloomY, bloomR);
      bloom.addColorStop(0,    "hsla(42, 100%, 96%, 0.30)");
      bloom.addColorStop(0.18, "hsla(43,  96%, 82%, 0.18)");
      bloom.addColorStop(0.50, "hsla(43,  88%, 68%, 0.08)");
      bloom.addColorStop(1,    "hsla(44,  70%, 50%, 0)");
      ctx.beginPath();
      ctx.arc(bloomX, bloomY, bloomR, 0, Math.PI * 2);
      ctx.fillStyle = bloom;
      ctx.fill();

      // ── Dust motes drifting down the beam column ───────────────────────
      const t = state.t;
      for (let m = 0; m < MOTE_COUNT; m++) {
        const mt    = t * 0.28 + m * 1.73;
        const along = ((Math.sin(mt * 0.5 + m) * 0.5 + 0.5) * 0.8);
        const perp  = Math.sin(mt * 0.33 + m * 2.1) * halfAngle * 0.55 * along;
        const mAngle = baseAngle + perp;
        const mx    = srcX + Math.cos(mAngle) * along * farDist * 0.52;
        const my    = srcY + Math.sin(mAngle) * along * farDist * 0.52;
        const a     = (Math.sin(mt * 1.0 + m) * 0.35 + 0.55) * BASE_ALPHA * 3.0;
        ctx.beginPath();
        ctx.arc(mx, my, 1.3, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(43, 85%, 82%, ${a.toFixed(3)})`;
        ctx.fill();
      }

      updateCardGlow(srcX, srcY);

      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);

    function onResize() {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width  = w;
      canvas.height = h;
    }
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        inset: 0,
        zIndex,
        pointerEvents: "none",
        mixBlendMode: "screen",
      }}
    />
  );
}
