/**
 * LightRay — physics-accurate animated light ray
 *
 * The ray source drifts slowly around a perimeter path using
 * smooth parametric motion (Lissajous-like) — no instant jumps.
 * It casts a conic fan of light across the scene and updates
 * --ray-x / --ray-y CSS vars on :root so rome-card borders
 * can react to the ray direction.
 *
 * Also updates each .rome-card's left border brightness based on
 * how directly the ray faces that side.
 */

import { useEffect, useRef } from "react";

interface Props {
  /** z-index for the canvas — should sit above rome-bg but below content */
  zIndex?: number;
}

// How fast the source moves (fraction of screen per second, tuned to feel slow)
const DRIFT_SPEED = 0.055;

// Ray beam settings
const RAY_HALF_ANGLE_DEG = 11;   // half-angle of the beam fan
const BEAM_STEPS = 4;             // concentric opacity layers for the beam
const BASE_ALPHA = 0.055;         // peak alpha of the main beam

export default function LightRay({ zIndex = 2 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let w = window.innerWidth;
    let h = window.innerHeight;
    canvas.width  = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d")!;

    // Source position in [0,1]×[0,1] normalised coords
    // Starts upper-left
    let t = 0;

    // Lissajous-ish drift: source walks a slow figure-8 path
    // that keeps it near the edges/corners of the screen
    function sourcePos(time: number) {
      // A = amplitude, f = frequency, ph = phase offset
      // Produces a smooth closed path that visits corners over ~60s
      const ax = 0.38, fx = 0.031, px = 0;
      const ay = 0.28, fy = 0.019, py = Math.PI * 0.6;
      const cx = 0.5 + ax * Math.sin(time * fx * Math.PI * 2 + px);
      const cy = 0.12 + ay * Math.sin(time * fy * Math.PI * 2 + py);
      return { sx: cx, sy: cy };
    }

    // Update CSS vars so rome-card ::before can use them
    function updateCSSVars(sx: number, sy: number) {
      document.documentElement.style.setProperty("--ray-x", `${(sx * 100).toFixed(1)}%`);
      document.documentElement.style.setProperty("--ray-y", `${(sy * 100).toFixed(1)}%`);
    }

    // Update each .rome-card's border brightness based on ray angle
    function updateCardGlow(sx: number, sy: number) {
      const cards = document.querySelectorAll<HTMLElement>(".rome-card");
      cards.forEach(card => {
        const rect = card.getBoundingClientRect();
        const cardCx = (rect.left + rect.right) / 2 / w;
        const cardCy = (rect.top  + rect.bottom) / 2 / h;

        // Vector from source to card center
        const dx = cardCx - sx;
        const dy = cardCy - sy;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Normalised dot of (source→card) with (source→screen-center)
        // The closer to 0 distance and more "central" the card, the brighter
        const falloff = Math.max(0, 1 - dist * 1.6);
        const intensity = falloff * falloff;

        // Which side is the ray hitting? Rotate border glow accordingly
        // We encode as a gradient peak offset: 0 = left, 1 = right
        const angleNorm = (Math.atan2(dy, dx) / Math.PI + 1) / 2; // 0–1

        card.style.setProperty("--card-ray-intensity", (intensity * 0.55 + 0.14).toFixed(3));

        // Dynamic border-color with golden glow on the ray-facing side
        const borderAlpha = (intensity * 0.55 + 0.22).toFixed(2);
        card.style.borderColor = `hsl(43 55% 35% / ${borderAlpha})`;

        // box-shadow: extra gold glow on the ray-side edge
        const glowStrength = (intensity * 28).toFixed(0);
        const glowAlpha    = (intensity * 0.22 + 0.04).toFixed(2);
        // Offset glow toward the ray source
        const offX = (-dx * 12 * intensity).toFixed(1);
        const offY = (-dy * 12 * intensity).toFixed(1);
        card.style.boxShadow = [
          `4px 8px 32px hsl(220 25% 2% / 0.65)`,
          `inset 1px 1px 0 hsl(43 60% 50% / ${(intensity * 0.22 + 0.08).toFixed(2)})`,
          `${offX}px ${offY}px ${glowStrength}px hsl(43 70% 52% / ${glowAlpha})`,
        ].join(", ");
      });
    }

    let lastTime = performance.now();

    function draw(now: number) {
      const dt = Math.min((now - lastTime) / 1000, 0.05); // cap at 50ms
      lastTime = now;
      t += dt * DRIFT_SPEED;

      const { sx, sy } = sourcePos(t);
      const srcX = sx * w;
      const srcY = sy * h;

      // Clear
      ctx.clearRect(0, 0, w, h);

      // ── Beam rays ──────────────────────────────────────────────────────
      // Cast the beam from source to a circle of points at the far wall.
      // We use a radial gradient fanned out with multiple triangular fills
      // to simulate a physical light cone.

      const halfAngle = (RAY_HALF_ANGLE_DEG * Math.PI) / 180;

      // Central direction: point roughly toward screen center and downward
      const cxDir = w * 0.5 - srcX;
      const cyDir = h * 0.65 - srcY;
      const cLen  = Math.sqrt(cxDir * cxDir + cyDir * cyDir);
      const baseAngle = Math.atan2(cyDir, cxDir);

      // Draw layered beam (outer → inner, decreasing alpha)
      for (let layer = BEAM_STEPS; layer >= 1; layer--) {
        const layerFrac = layer / BEAM_STEPS;
        const spread = halfAngle * layerFrac * 1.8;
        const layerAlpha = BASE_ALPHA * (1 - layerFrac * 0.5);

        const farDist = Math.sqrt(w * w + h * h) * 1.2;

        const left  = baseAngle - spread;
        const right = baseAngle + spread;

        const x1 = srcX + Math.cos(left)  * farDist;
        const y1 = srcY + Math.sin(left)  * farDist;
        const x2 = srcX + Math.cos(right) * farDist;
        const y2 = srcY + Math.sin(right) * farDist;

        // Gradient along beam length — bright near source, fades out
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

      // ── Source halo ─────────────────────────────────────────────────────
      // Small bright bloom at the ray origin
      const halo = ctx.createRadialGradient(srcX, srcY, 0, srcX, srcY, w * 0.14);
      halo.addColorStop(0,    "hsla(43, 90%, 78%, 0.14)");
      halo.addColorStop(0.35, "hsla(43, 75%, 65%, 0.07)");
      halo.addColorStop(1,    "hsla(43, 60%, 50%, 0)");
      ctx.beginPath();
      ctx.arc(srcX, srcY, w * 0.14, 0, Math.PI * 2);
      ctx.fillStyle = halo;
      ctx.fill();

      // ── Dust motes along the beam ──────────────────────────────────────
      // A few bright specks floating in the light column
      const moteCount = 6;
      for (let m = 0; m < moteCount; m++) {
        // Use stable per-mote seed so they drift smoothly
        const moteT = t * 0.4 + m * 1.3;
        const along = (Math.sin(moteT * 0.7 + m) * 0.5 + 0.5) * 0.7;
        const perp  = (Math.sin(moteT * 0.4 + m * 2.1) * 0.5) * halfAngle * along;
        const angle = baseAngle + perp;
        const mx = srcX + Math.cos(angle) * along * w * 0.9;
        const my = srcY + Math.sin(angle) * along * w * 0.9;
        const moteAlpha = (Math.sin(moteT * 1.1 + m) * 0.3 + 0.5) * BASE_ALPHA * 3;
        ctx.beginPath();
        ctx.arc(mx, my, 1.2, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(43, 90%, 82%, ${moteAlpha.toFixed(3)})`;
        ctx.fill();
      }

      updateCSSVars(sx, sy);
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
        mixBlendMode: "screen",   // blends additively with the dark background
      }}
    />
  );
}
