/**
 * LightRay — a single, seamless beam of gold light from the top edge.
 *
 * Rendered as ONE smooth conic gradient + radial falloff so there are
 * zero visible gradient triangle seams. Narrow, elegant, Robinhood-style.
 *
 * Source drifts slowly left↔right along the top (60s cycle).
 * All instances share lightRayState.ts — perfectly synced everywhere.
 */

import { useEffect, useRef } from "react";
import { getRayState, startRayClock, computeSourcePos } from "@/lib/lightRayState";

interface Props {
  zIndex?: number;
}

const BEAM_HALF_DEG = 9;   // narrow beam — elegant, not a floodlight
const BASE_ALPHA    = 0.11; // subtle — light, not paint
const MOTE_COUNT    = 7;

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

    // ── Card glow ────────────────────────────────────────────────────────
    function updateCardGlow(srcXpx: number, srcYpx: number) {
      const cards = document.querySelectorAll<HTMLElement>(".rome-card");
      cards.forEach(card => {
        const rect = card.getBoundingClientRect();
        if (rect.width === 0) return;

        const cx = (rect.left + rect.right) / 2;
        const cy = (rect.top  + rect.bottom) / 2;
        const dx = cx - srcXpx;
        const dy = cy - srcYpx;
        const dist = Math.sqrt(dx * dx + dy * dy) / Math.max(w, h);

        const falloff   = Math.max(0, 1 - dist * 1.2);
        const intensity = falloff * falloff * falloff;

        const rayAngle   = Math.atan2(dy, dx);
        const glowOffX   = -Math.cos(rayAngle) * 14 * intensity;
        const glowOffY   = -Math.sin(rayAngle) * 14 * intensity;
        const glowBlur   = 14 + intensity * 22;
        const glowAlpha  = (intensity * 0.32 + 0.02).toFixed(3);
        const innerAlpha = (intensity * 0.24 + 0.04).toFixed(3);
        const borderAlpha= (intensity * 0.55 + 0.14).toFixed(2);

        card.style.borderColor = `hsl(43 65% 42% / ${borderAlpha})`;
        card.style.boxShadow = [
          `3px 6px 28px hsl(220 25% 2% / 0.7)`,
          `inset ${(-glowOffX * 0.12).toFixed(1)}px ${(-glowOffY * 0.12).toFixed(1)}px 0 hsl(43 75% 60% / ${innerAlpha})`,
          `${glowOffX.toFixed(1)}px ${glowOffY.toFixed(1)}px ${glowBlur.toFixed(0)}px hsl(43 88% 55% / ${glowAlpha})`,
        ].join(", ");
      });
    }

    // ── Draw ─────────────────────────────────────────────────────────────
    function draw() {
      const rs = getRayState();
      const { sx, sy } = computeSourcePos(rs.t);

      const srcX = sx * w;
      const srcY = sy * h; // slightly negative — above screen

      ctx.clearRect(0, 0, w, h);

      // Beam direction: straight down toward center-bottom
      const targetX  = srcX * 0.6 + w * 0.5 * 0.4; // slightly biased toward center
      const targetY  = h * 0.9;
      const baseAngle = Math.atan2(targetY - srcY, targetX - srcX);
      const farDist  = Math.sqrt(w * w + h * h) * 1.4;

      const halfAngle = (BEAM_HALF_DEG * Math.PI) / 180;

      // ── Single smooth beam — ONE gradient shape, no seams ────────────
      // The trick: draw a single triangle but use a linear gradient that
      // has a smooth bell-curve falloff across the width using multiple stops.
      // We achieve the "no visible edges" look by:
      //   1. Making the outer stops fully transparent
      //   2. Using a perpendicular gradient (across the beam width, not along it)
      //   3. Multiplying by a longitudinal radial falloff overlay

      const spread = halfAngle * 2.8; // total beam width angle
      const leftAngle  = baseAngle - spread;
      const rightAngle = baseAngle + spread;

      const x1 = srcX + Math.cos(leftAngle)  * farDist;
      const y1 = srcY + Math.sin(leftAngle)  * farDist;
      const x2 = srcX + Math.cos(rightAngle) * farDist;
      const y2 = srcY + Math.sin(rightAngle) * farDist;

      // Midpoint of the far edge for perpendicular gradient
      const midFarX = (x1 + x2) / 2;
      const midFarY = (y1 + y2) / 2;

      // Perpendicular to beam axis — for the cross-beam gradient
      const perpAngle = baseAngle + Math.PI / 2;
      const perpDist  = Math.tan(spread) * farDist * 0.5;
      const perpLx = midFarX - Math.cos(perpAngle) * perpDist;
      const perpLy = midFarY - Math.sin(perpAngle) * perpDist;
      const perpRx = midFarX + Math.cos(perpAngle) * perpDist;
      const perpRy = midFarY + Math.sin(perpAngle) * perpDist;

      // Cross-beam gradient: transparent → gold-core → transparent
      // Bell-curve via many stops — no hard edges visible
      const crossGrad = ctx.createLinearGradient(perpLx, perpLy, perpRx, perpRy);
      crossGrad.addColorStop(0.00, `hsla(43, 90%, 70%, 0)`);
      crossGrad.addColorStop(0.12, `hsla(43, 90%, 74%, ${(BASE_ALPHA * 0.15).toFixed(3)})`);
      crossGrad.addColorStop(0.28, `hsla(43, 92%, 76%, ${(BASE_ALPHA * 0.55).toFixed(3)})`);
      crossGrad.addColorStop(0.42, `hsla(42, 95%, 80%, ${(BASE_ALPHA * 0.88).toFixed(3)})`);
      crossGrad.addColorStop(0.50, `hsla(42, 98%, 84%, ${BASE_ALPHA.toFixed(3)})`);
      crossGrad.addColorStop(0.58, `hsla(42, 95%, 80%, ${(BASE_ALPHA * 0.88).toFixed(3)})`);
      crossGrad.addColorStop(0.72, `hsla(43, 92%, 76%, ${(BASE_ALPHA * 0.55).toFixed(3)})`);
      crossGrad.addColorStop(0.88, `hsla(43, 90%, 74%, ${(BASE_ALPHA * 0.15).toFixed(3)})`);
      crossGrad.addColorStop(1.00, `hsla(43, 90%, 70%, 0)`);

      ctx.beginPath();
      ctx.moveTo(srcX, srcY);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.closePath();
      ctx.fillStyle = crossGrad;
      ctx.fill();

      // ── Longitudinal fade overlay — bright at entry, fades to nothing ─
      // Drawn as a radial gradient centered at source, large enough to cover scene
      const longFade = ctx.createRadialGradient(srcX, srcY, 0, srcX, srcY, farDist * 0.85);
      longFade.addColorStop(0.00, `hsla(42, 100%, 90%, ${(BASE_ALPHA * 0.55).toFixed(3)})`);
      longFade.addColorStop(0.08, `hsla(43,  96%, 80%, ${(BASE_ALPHA * 1.0).toFixed(3)})`);
      longFade.addColorStop(0.25, `hsla(43,  90%, 70%, ${(BASE_ALPHA * 0.72).toFixed(3)})`);
      longFade.addColorStop(0.55, `hsla(44,  82%, 58%, ${(BASE_ALPHA * 0.30).toFixed(3)})`);
      longFade.addColorStop(0.80, `hsla(44,  72%, 46%, ${(BASE_ALPHA * 0.08).toFixed(3)})`);
      longFade.addColorStop(1.00, `hsla(44,  60%, 36%, 0)`);

      // Clip to beam shape to apply longitudinal fade within beam only
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(srcX, srcY);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.closePath();
      ctx.clip();
      ctx.fillStyle = longFade;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();

      // ── Entry bloom — soft halo at very top where beam enters ─────────
      const bloomX = Math.max(30, Math.min(w - 30, srcX));
      const bloomY = 2; // just inside top edge
      const bloomR = Math.min(w, h) * 0.14;
      const bloom  = ctx.createRadialGradient(bloomX, bloomY, 0, bloomX, bloomY, bloomR);
      bloom.addColorStop(0,    "hsla(42, 100%, 94%, 0.22)");
      bloom.addColorStop(0.20, "hsla(43,  95%, 80%, 0.12)");
      bloom.addColorStop(0.55, "hsla(43,  88%, 68%, 0.04)");
      bloom.addColorStop(1,    "hsla(44,  70%, 50%, 0)");
      ctx.beginPath();
      ctx.arc(bloomX, bloomY, bloomR, 0, Math.PI * 2);
      ctx.fillStyle = bloom;
      ctx.fill();

      // ── Dust motes — slow, gentle drift ──────────────────────────────
      const t = rs.t;
      for (let m = 0; m < MOTE_COUNT; m++) {
        const mt    = t * 0.18 + m * 1.91; // slower than before
        const along = (Math.sin(mt * 0.45 + m) * 0.5 + 0.5) * 0.75;
        const perp  = Math.sin(mt * 0.28 + m * 2.1) * halfAngle * 0.5 * along;
        const mAngle= baseAngle + perp;
        const mx    = srcX + Math.cos(mAngle) * along * farDist * 0.5;
        const my    = srcY + Math.sin(mAngle) * along * farDist * 0.5;
        const a     = (Math.sin(mt * 0.9 + m) * 0.3 + 0.55) * BASE_ALPHA * 2.5;
        ctx.beginPath();
        ctx.arc(mx, my, 1.2, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(43, 85%, 84%, ${a.toFixed(3)})`;
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
