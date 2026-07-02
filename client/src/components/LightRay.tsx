/**
 * LightRay — original physics-accurate animated light ray (Mark VII).
 *
 * Source drifts on a slow Lissajous path via the shared lightRayState clock
 * so the ray stays perfectly in sync across constellation and domain pages.
 */

import { useEffect, useRef } from "react";
import { getRayState, startRayClock, computeSourcePos } from "@/lib/lightRayState";

interface Props {
  zIndex?: number;
}

const RAY_HALF_ANGLE_DEG = 11;
const BEAM_STEPS         = 4;
const BASE_ALPHA         = 0.055;

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

    function updateCardGlow(sx: number, sy: number) {
      const cards = document.querySelectorAll<HTMLElement>(".rome-card");
      cards.forEach(card => {
        const rect = card.getBoundingClientRect();
        const cardCx = (rect.left + rect.right) / 2 / w;
        const cardCy = (rect.top  + rect.bottom) / 2 / h;

        const dx   = cardCx - sx;
        const dy   = cardCy - sy;
        const dist = Math.sqrt(dx * dx + dy * dy);

        const falloff   = Math.max(0, 1 - dist * 1.6);
        const intensity = falloff * falloff;

        card.style.setProperty("--card-ray-intensity", (intensity * 0.55 + 0.14).toFixed(3));

        const borderAlpha = (intensity * 0.55 + 0.22).toFixed(2);
        card.style.borderColor = `hsl(43 55% 35% / ${borderAlpha})`;

        const glowStrength = (intensity * 28).toFixed(0);
        const glowAlpha    = (intensity * 0.22 + 0.04).toFixed(2);
        const offX = (-dx * 12 * intensity).toFixed(1);
        const offY = (-dy * 12 * intensity).toFixed(1);
        card.style.boxShadow = [
          `4px 8px 32px hsl(220 25% 2% / 0.65)`,
          `inset 1px 1px 0 hsl(43 60% 50% / ${(intensity * 0.22 + 0.08).toFixed(2)})`,
          `${offX}px ${offY}px ${glowStrength}px hsl(43 70% 52% / ${glowAlpha})`,
        ].join(", ");
      });
    }

    function draw() {
      const rs = getRayState();
      const { sx, sy } = computeSourcePos(rs.t);
      const srcX = sx * w;
      const srcY = sy * h;

      ctx.clearRect(0, 0, w, h);

      const halfAngle = (RAY_HALF_ANGLE_DEG * Math.PI) / 180;

      const cxDir     = w * 0.5 - srcX;
      const cyDir     = h * 0.65 - srcY;
      const baseAngle = Math.atan2(cyDir, cxDir);

      // ── Layered beam ─────────────────────────────────────────────────
      for (let layer = BEAM_STEPS; layer >= 1; layer--) {
        const layerFrac  = layer / BEAM_STEPS;
        const spread     = halfAngle * layerFrac * 1.8;
        const layerAlpha = BASE_ALPHA * (1 - layerFrac * 0.5);
        const farDist    = Math.sqrt(w * w + h * h) * 1.2;

        const left  = baseAngle - spread;
        const right = baseAngle + spread;

        const x1 = srcX + Math.cos(left)  * farDist;
        const y1 = srcY + Math.sin(left)  * farDist;
        const x2 = srcX + Math.cos(right) * farDist;
        const y2 = srcY + Math.sin(right) * farDist;

        const grad = ctx.createLinearGradient(
          srcX, srcY,
          srcX + Math.cos(baseAngle) * farDist,
          srcY + Math.sin(baseAngle) * farDist,
        );
        grad.addColorStop(0,    `hsla(43, 80%, 72%, ${(layerAlpha * 0.6).toFixed(3)})`);
        grad.addColorStop(0.08, `hsla(43, 75%, 68%, ${layerAlpha.toFixed(3)})`);
        grad.addColorStop(0.4,  `hsla(43, 65%, 60%, ${(layerAlpha * 0.55).toFixed(3)})`);
        grad.addColorStop(0.75, `hsla(43, 55%, 50%, ${(layerAlpha * 0.18).toFixed(3)})`);
        grad.addColorStop(1,    `hsla(43, 45%, 40%, 0)`);

        ctx.beginPath();
        ctx.moveTo(srcX, srcY);
        ctx.lineTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // ── Source halo ───────────────────────────────────────────────────
      const halo = ctx.createRadialGradient(srcX, srcY, 0, srcX, srcY, w * 0.14);
      halo.addColorStop(0,    "hsla(43, 90%, 78%, 0.14)");
      halo.addColorStop(0.35, "hsla(43, 75%, 65%, 0.07)");
      halo.addColorStop(1,    "hsla(43, 60%, 50%, 0)");
      ctx.beginPath();
      ctx.arc(srcX, srcY, w * 0.14, 0, Math.PI * 2);
      ctx.fillStyle = halo;
      ctx.fill();

      // ── Dust motes ────────────────────────────────────────────────────
      const t = rs.t;
      for (let m = 0; m < 6; m++) {
        const moteT = t * 0.4 + m * 1.3;
        const along = (Math.sin(moteT * 0.7 + m) * 0.5 + 0.5) * 0.7;
        const perp  = (Math.sin(moteT * 0.4 + m * 2.1) * 0.5) * halfAngle * along;
        const angle = baseAngle + perp;
        const mx    = srcX + Math.cos(angle) * along * w * 0.9;
        const my    = srcY + Math.sin(angle) * along * w * 0.9;
        const moteA = (Math.sin(moteT * 1.1 + m) * 0.3 + 0.5) * BASE_ALPHA * 3;
        ctx.beginPath();
        ctx.arc(mx, my, 1.2, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(43, 90%, 82%, ${moteA.toFixed(3)})`;
        ctx.fill();
      }

      updateCardGlow(sx, sy);
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
