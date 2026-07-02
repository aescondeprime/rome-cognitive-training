/**
 * LightRay — renders the physics light beam onto a canvas.
 *
 * All instances share the same global time/position via lightRayState.ts
 * so the ray stays perfectly synced whether the constellation is open or not.
 *
 * Source is always just off the screen edge — never visible to the user,
 * only the beam entering the scene is seen.
 */

import { useEffect, useRef } from "react";
import { getRayState, startRayClock, computeSourcePos } from "@/lib/lightRayState";

interface Props {
  zIndex?: number;
}

// ── Beam config ────────────────────────────────────────────────────────────
const RAY_HALF_ANGLE_DEG = 13;   // half-width of the main beam
const BEAM_LAYERS = 5;            // opacity layers — soft penumbra feel
const BASE_ALPHA  = 0.10;         // peak opacity of the core beam (richer gold)
const MOTE_COUNT  = 8;            // dust motes floating in the column

export default function LightRay({ zIndex = 2 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);

  useEffect(() => {
    // Start the shared clock (no-op if already running)
    startRayClock();

    const canvas = canvasRef.current;
    if (!canvas) return;

    let w = window.innerWidth;
    let h = window.innerHeight;
    canvas.width  = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d")!;

    // ── Card glow updater ────────────────────────────────────────────────
    // Runs each frame — updates .rome-card border/shadow based on ray angle.
    // Directional: the border FACING the source gets the shine.
    function updateCardGlow(srcXpx: number, srcYpx: number) {
      const cards = document.querySelectorAll<HTMLElement>(".rome-card");
      cards.forEach(card => {
        const rect = card.getBoundingClientRect();
        if (rect.width === 0) return;

        const cardCx = (rect.left + rect.right) / 2;
        const cardCy = (rect.top  + rect.bottom) / 2;

        // Vector from SOURCE to card center
        const dx = cardCx - srcXpx;
        const dy = cardCy - srcYpx;
        const dist = Math.sqrt(dx * dx + dy * dy) / Math.max(w, h);

        // Intensity — closer cards on the beam path are brighter
        const falloff = Math.max(0, 1 - dist * 1.4);
        const intensity = falloff * falloff * falloff;

        // Direction the ray hits the card face — the border on that side shines
        // angle: 0 = right face lit, PI/2 = bottom, PI = left, -PI/2 = top
        const rayAngle = Math.atan2(dy, dx); // angle from source → card

        // Offset the outer glow shadow toward the SOURCE (opposite of ray dir)
        const glowOffX = -Math.cos(rayAngle) * 18 * intensity;
        const glowOffY = -Math.sin(rayAngle) * 18 * intensity;
        const glowBlur  = 14 + intensity * 22;
        const glowAlpha = (intensity * 0.35 + 0.03).toFixed(3);
        const innerAlpha = (intensity * 0.28 + 0.06).toFixed(3);

        // Border color: richer gold when hit, dim when in shadow
        const borderAlpha = (intensity * 0.6 + 0.18).toFixed(2);
        card.style.borderColor = `hsl(43 65% 42% / ${borderAlpha})`;

        card.style.boxShadow = [
          // Ambient depth
          `3px 6px 28px hsl(220 25% 2% / 0.7)`,
          // Inner catch-light on the ray-facing surface
          `inset ${(-glowOffX * 0.15).toFixed(1)}px ${(-glowOffY * 0.15).toFixed(1)}px 0 hsl(43 75% 60% / ${innerAlpha})`,
          // External glow bloom from ray direction
          `${glowOffX.toFixed(1)}px ${glowOffY.toFixed(1)}px ${glowBlur.toFixed(0)}px hsl(43 85% 55% / ${glowAlpha})`,
        ].join(", ");
      });
    }

    // ── Draw loop ────────────────────────────────────────────────────────
    function draw() {
      const state = getRayState();
      const { sx, sy } = computeSourcePos(state.t);

      const srcX = sx * w;
      const srcY = sy * h;

      ctx.clearRect(0, 0, w, h);

      const halfAngle = (RAY_HALF_ANGLE_DEG * Math.PI) / 180;

      // Beam aims from the off-screen source toward the screen center
      // (physically: the light enters the scene and spreads across it)
      const targetX = w * 0.5;
      const targetY = h * 0.52;
      const baseAngle = Math.atan2(targetY - srcY, targetX - srcX);
      const farDist = Math.sqrt(w * w + h * h) * 1.4;

      // ── Layered beam fan ────────────────────────────────────────────────
      // Outer layers: wide spread, low alpha (penumbra / atmospheric scatter)
      // Inner layers: tight, brighter core (umbra)
      for (let layer = BEAM_LAYERS; layer >= 1; layer--) {
        const frac   = layer / BEAM_LAYERS;
        const spread = halfAngle * frac * 2.2;          // outer = wide, inner = tight
        const alpha  = BASE_ALPHA * (1 - frac * 0.45);  // inner = brightest

        const leftAngle  = baseAngle - spread;
        const rightAngle = baseAngle + spread;

        const x1 = srcX + Math.cos(leftAngle)  * farDist;
        const y1 = srcY + Math.sin(leftAngle)  * farDist;
        const x2 = srcX + Math.cos(rightAngle) * farDist;
        const y2 = srcY + Math.sin(rightAngle) * farDist;

        // Gradient along beam axis: bright at source entry, tapers to 0
        const gx = srcX + Math.cos(baseAngle) * farDist;
        const gy = srcY + Math.sin(baseAngle) * farDist;
        const grad = ctx.createLinearGradient(srcX, srcY, gx, gy);

        // Rich gold stops — more saturated than before
        grad.addColorStop(0,    `hsla(42, 95%, 78%, ${(alpha * 0.55).toFixed(3)})`);
        grad.addColorStop(0.04, `hsla(42, 92%, 72%, ${alpha.toFixed(3)})`);
        grad.addColorStop(0.18, `hsla(43, 88%, 65%, ${(alpha * 0.75).toFixed(3)})`);
        grad.addColorStop(0.45, `hsla(44, 80%, 58%, ${(alpha * 0.38).toFixed(3)})`);
        grad.addColorStop(0.78, `hsla(44, 70%, 48%, ${(alpha * 0.12).toFixed(3)})`);
        grad.addColorStop(1,    `hsla(44, 60%, 38%, 0)`);

        ctx.beginPath();
        ctx.moveTo(srcX, srcY);
        ctx.lineTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // ── Entry bloom — bright spot where beam enters the screen ──────────
      // This is visible near the edge the source is on, not the source itself.
      // Find the intersection of the beam axis with the viewport edge.
      // Approximate: just draw a bloom inside the screen, close to the edge.
      const edgeBloomDist = Math.min(w, h) * 0.08;
      const bloomX = srcX + Math.cos(baseAngle) * edgeBloomDist;
      const bloomY = srcY + Math.sin(baseAngle) * edgeBloomDist;

      // Clamp bloom center to be inside the viewport
      const bx = Math.max(0, Math.min(w, bloomX));
      const by = Math.max(0, Math.min(h, bloomY));

      const bloomR = Math.min(w, h) * 0.12;
      const bloom  = ctx.createRadialGradient(bx, by, 0, bx, by, bloomR);
      bloom.addColorStop(0,    "hsla(42, 100%, 85%, 0.22)");
      bloom.addColorStop(0.25, "hsla(43, 95%,  75%, 0.12)");
      bloom.addColorStop(0.6,  "hsla(43, 85%,  65%, 0.05)");
      bloom.addColorStop(1,    "hsla(43, 70%,  50%, 0)");
      ctx.beginPath();
      ctx.arc(bx, by, bloomR, 0, Math.PI * 2);
      ctx.fillStyle = bloom;
      ctx.fill();

      // ── Dust motes in the beam column ───────────────────────────────────
      const t = state.t;
      for (let m = 0; m < MOTE_COUNT; m++) {
        const mt = t * 0.35 + m * 1.57;
        const along = (Math.sin(mt * 0.6 + m) * 0.5 + 0.5) * 0.72;
        const perp  = Math.sin(mt * 0.38 + m * 2.3) * halfAngle * 0.6 * along;
        const mAngle = baseAngle + perp;
        const mx = srcX + Math.cos(mAngle) * along * farDist * 0.55;
        const my = srcY + Math.sin(mAngle) * along * farDist * 0.55;
        const alpha = (Math.sin(mt * 1.1 + m) * 0.35 + 0.55) * BASE_ALPHA * 2.8;
        ctx.beginPath();
        ctx.arc(mx, my, 1.4, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(43, 88%, 80%, ${alpha.toFixed(3)})`;
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
