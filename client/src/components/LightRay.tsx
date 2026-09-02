/**
 * LightRay — single canvas, no blend mode, no accumulation.
 * Draws on a fully transparent canvas each frame.
 * No mixBlendMode — avoids GPU compositing layer stacking artifacts.
 */

import { useEffect, useRef } from "react";
import { getRayState, startRayClock, getRayHSL, getRayBrightness } from "@/lib/lightRayState";

interface Props { zIndex?: number; }

const RAY_HALF_ANGLE_DEG = 13;
const BASE_ALPHA         = 0.11;   // dimmed per feedback

export default function LightRay({ zIndex = 5 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    startRayClock();

    const canvas = canvasRef.current;
    if (!canvas) return;

    let w = window.innerWidth;
    let h = window.innerHeight;
    canvas.width  = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d")!;
    let cancelled = false;

    function draw() {
      if (cancelled) return;

      const rs  = getRayState();
      // Something opaque is on screen that the ray would sit on top of. Clear
      // once and keep the loop alive, so it comes straight back when it lifts.
      if (rs.suppressors > 0) {
        ctx.clearRect(0, 0, w, h);
        requestAnimationFrame(draw);
        return;
      }
      const col = getRayHSL();
      const { h: hue, s, l } = col;
      const bright = getRayBrightness();

      const srcX = rs.srcX * w;
      const srcY = rs.srcY * h;

      // Hard clear — source-over on a cleared canvas = true transparency
      ctx.clearRect(0, 0, w, h);

      const halfAngle = (RAY_HALF_ANGLE_DEG * Math.PI) / 180;
      const baseAngle = rs.dirAngle !== null
        ? rs.dirAngle
        : Math.atan2(h * 0.65 - srcY, w * 0.5 - srcX);
      const farDist = Math.sqrt(w * w + h * h) * 1.2;

      // ── 3 layered beam passes, wide → narrow, low → higher alpha ───
      const layers = [
        { spread: 2.2, alpha: BASE_ALPHA * 0.45 * bright },
        { spread: 1.4, alpha: BASE_ALPHA * 0.70 * bright },
        { spread: 0.7, alpha: BASE_ALPHA * 1.00 * bright },
      ];

      for (const layer of layers) {
        const spread = halfAngle * layer.spread;
        const alpha  = layer.alpha;

        const left  = baseAngle - spread;
        const right = baseAngle + spread;

        const x1 = srcX + Math.cos(left)  * farDist;
        const y1 = srcY + Math.sin(left)  * farDist;
        const x2 = srcX + Math.cos(right) * farDist;
        const y2 = srcY + Math.sin(right) * farDist;

        const lHi = Math.min(99, l + 20);
        const lMd = Math.min(99, l + 8);

        const grad = ctx.createLinearGradient(
          srcX, srcY,
          srcX + Math.cos(baseAngle) * farDist,
          srcY + Math.sin(baseAngle) * farDist,
        );
        grad.addColorStop(0,    `hsla(${hue},${s}%,${lHi}%,${(alpha * 0.7).toFixed(3)})`);
        grad.addColorStop(0.06, `hsla(${hue},${s}%,${lMd}%,${alpha.toFixed(3)})`);
        grad.addColorStop(0.35, `hsla(${hue},${Math.max(0,s-10)}%,${l}%,${(alpha*0.5).toFixed(3)})`);
        grad.addColorStop(0.7,  `hsla(${hue},${Math.max(0,s-20)}%,${Math.max(0,l-15)}%,${(alpha*0.15).toFixed(3)})`);
        grad.addColorStop(1,    `hsla(${hue},${Math.max(0,s-30)}%,${Math.max(0,l-25)}%,0)`);

        ctx.beginPath();
        ctx.moveTo(srcX, srcY);
        ctx.lineTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // ── Source halo ────────────────────────────────────────────────
      const lHi = Math.min(99, l + 22);
      const halo = ctx.createRadialGradient(srcX, srcY, 0, srcX, srcY, w * 0.12);
      halo.addColorStop(0,   `hsla(${hue},${s}%,${lHi}%,${(0.18 * bright).toFixed(3)})`);
      halo.addColorStop(0.3, `hsla(${hue},${s}%,${l}%,${(0.07 * bright).toFixed(3)})`);
      halo.addColorStop(1,   `hsla(${hue},${s}%,${l}%,0)`);
      ctx.beginPath();
      ctx.arc(srcX, srcY, w * 0.15, 0, Math.PI * 2);
      ctx.fillStyle = halo;
      ctx.fill();

      // ── Dust motes ────────────────────────────────────────────────
      const t = rs.t;
      for (let m = 0; m < 6; m++) {
        const moteT = t * 0.4 + m * 1.3;
        const along = (Math.sin(moteT * 0.7 + m) * 0.5 + 0.5) * 0.7;
        const perp  = Math.sin(moteT * 0.4 + m * 2.1) * 0.5 * halfAngle * along;
        const angle = baseAngle + perp;
        const mx    = srcX + Math.cos(angle) * along * w * 0.9;
        const my    = srcY + Math.sin(angle) * along * w * 0.9;
        const moteA = (Math.sin(moteT * 1.1 + m) * 0.3 + 0.5) * BASE_ALPHA * 2.5 * bright;
        ctx.beginPath();
        ctx.arc(mx, my, 1.4, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${hue},${s}%,${lHi}%,${moteA.toFixed(3)})`;
        ctx.fill();
      }

      requestAnimationFrame(draw);
    }

    requestAnimationFrame(draw);

    function onResize() {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width  = w;
      canvas.height = h;
    }
    window.addEventListener("resize", onResize);

    return () => {
      cancelled = true;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
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
        // NO mixBlendMode — avoids GPU compositing layer artifacts
      }}
    />
  );
}
