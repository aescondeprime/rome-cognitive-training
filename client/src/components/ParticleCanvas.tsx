/**
 * ParticleCanvas — the drifting starfield.
 *
 * Extracted from `ConstellationMenu` when the World Browser gained an ambient
 * backdrop to fade onto: the same field now has two callers, one with a camera
 * and one without.
 */
import { useEffect, useRef } from "react";
import type { MotionValue } from "framer-motion";
import { DEFAULT_PARTICLE_SATURATION } from "@/lib/constellationLayout";

// ── Moving particle canvas ─────────────────────────────────────────────────
//
// Two things this field has to do that a plain drifting starfield does not:
//
// 1. Fake the camera. The canvas is mounted OUTSIDE the camera-transformed
//    layer, so when the map flies to a node the field would otherwise sit
//    frozen behind it and the depth illusion collapses. Every particle carries
//    a `depth` (0 = far, 1 = near) and is projected through a weakened copy of
//    the camera transform — near particles take almost all of the zoom and pan,
//    far ones barely move. Wrapping is done in each layer's OWN world units
//    (not in screen space), so on-screen density stays constant at every zoom
//    instead of thinning out as the field is magnified.
//
// 2. Answer the pointer. A soft radial push inside a falloff radius, plus a
//    tangential drag carried by the cursor's own velocity, applied as an
//    impulse on the particle's velocity which then relaxes back to the drift it
//    was born with. Nothing is yanked; the field stirs and settles.
//
// The camera values arrive as framer-motion MotionValues and are read with
// `.get()` inside the RAF loop — subscribing React to them would re-render the
// whole menu sixty times a second.

/** Pointer influence — radius in screen px, and impulse strengths. */
const PTR_RADIUS = 185;
const PTR_PUSH   = 0.055;  // steady repulsion from a resting cursor
const PTR_SWIRL  = 0.030;  // drag carried by cursor velocity
const VEL_RELAX  = 0.040;  // per-frame pull back toward birth drift
const MAX_SPEED  = 1.8;
const WRAP_MARGIN = 56;    // wrap this far off-screen so pops are never seen

export default function ParticleCanvas({
  width, height, count = 280, particleHue, saturation = DEFAULT_PARTICLE_SATURATION,
  camScale, camX, camY, depthStrength = 1,
}: {
  width: number; height: number; count?: number; particleHue?: number; saturation?: number;
  camScale?: MotionValue<number>; camX?: MotionValue<number>; camY?: MotionValue<number>;
  /** 0 disables camera parallax entirely (edit mode). */
  depthStrength?: number;
}) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const countRef   = useRef(count);
  const hueRef     = useRef(particleHue);
  const satRef     = useRef(saturation);
  const depthRef   = useRef(depthStrength);
  const camRef     = useRef({ camScale, camX, camY });

  // Pointer state lives in a ref: a mousemove that set React state would
  // re-render the menu on every pixel of cursor travel.
  const ptrRef = useRef({ x: -9999, y: -9999, vx: 0, vy: 0, active: false });

  // Keep refs in sync so the RAF loop always reads current values
  useEffect(() => { countRef.current = count; }, [count]);
  useEffect(() => { hueRef.current   = particleHue; }, [particleHue]);
  useEffect(() => { satRef.current   = saturation; }, [saturation]);
  useEffect(() => { depthRef.current = depthStrength; }, [depthStrength]);
  useEffect(() => { camRef.current   = { camScale, camX, camY }; }, [camScale, camX, camY]);

  useEffect(() => {
    const ptr = ptrRef.current;
    function onMove(e: MouseEvent) {
      // movementX/Y is already a per-event delta, so it doubles as velocity
      // without keeping a previous sample around.
      ptr.vx = Math.max(-14, Math.min(14, (e.movementX || 0)));
      ptr.vy = Math.max(-14, Math.min(14, (e.movementY || 0)));
      ptr.x = e.clientX; ptr.y = e.clientY;
      ptr.active = true;
    }
    function onLeave() { ptr.active = false; }
    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("mouseleave", onLeave);
    window.addEventListener("blur", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("blur", onLeave);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0 || height === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // A reduced-motion field still has depth, just a shallower one, and the
    // pointer only breathes on it.
    const depthGain = reduced ? 0.4 : 1;
    const ptrGain   = reduced ? 0.35 : 1;

    // Spawn MAX_COUNT particles once; only draw the first `countRef.current` of them
    const MAX = 560;
    const particles = Array.from({ length: MAX }, () => {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 0.18 + 0.04;
      const r     = Math.random() * 1.5 + 0.3;
      const vx    = Math.cos(angle) * speed;
      const vy    = Math.sin(angle) * speed;
      return {
        x: Math.random() * width, y: Math.random() * height,
        vx, vy,
        // Birth drift — every impulse decays back to this, so the field always
        // returns to the motion it started with.
        bvx: vx, bvy: vy,
        r,
        // Depth is read off the radius the particle already had, so a resting
        // field looks exactly as it did before: big dots simply turn out to be
        // the near ones.
        depth: 0.14 + ((r - 0.3) / 1.5) * 0.86,
        alpha: Math.random() * 0.6 + 0.15,
        phase: Math.random() * Math.PI * 2,
        flicker: Math.random() * 0.025 + 0.008,
      };
    });

    let t = 0;
    let raf: number;
    let cancelled = false;

    const mod = (a: number, b: number) => ((a % b) + b) % b;

    function draw() {
      if (cancelled) return;
      ctx!.clearRect(0, 0, width, height);
      t++;

      // Read accent hue directly from CSS var at draw time (canvas can't use var())
      // particleHue === -1 is the "White" sentinel — use low saturation
      const rawHue = hueRef.current;
      const isWhite = rawHue === -1;
      const h = isWhite ? 43
        : rawHue != null ? rawHue
        : (parseInt(getComputedStyle(document.documentElement).getPropertyValue("--accent-h").trim()) || 43);
      // White stays desaturated by definition; everything else follows the
      // editor, which used to be pinned at a washed-out 55.
      const sat = isWhite ? 10 : Math.max(0, Math.min(100, satRef.current));

      // ── Camera, read once per frame ────────────────────────────────────
      const cam = camRef.current;
      const gain = depthGain * depthRef.current;
      const camS = cam.camScale ? cam.camScale.get() : 1;
      const camTX = cam.camX ? cam.camX.get() : 0;
      const camTY = cam.camY ? cam.camY.get() : 0;

      const ptr = ptrRef.current;
      // Cursor velocity is an impulse, not a state — bleed it off every frame
      // so a cursor that stops moving stops dragging.
      ptr.vx *= 0.86; ptr.vy *= 0.86;

      const visible = Math.min(countRef.current, MAX);
      for (let i = 0; i < visible; i++) {
        const p = particles[i];
        p.x += p.vx; p.y += p.vy;

        // Per-layer camera: depth 0 sits still, depth 1 rides the full move.
        const d  = p.depth * gain;
        const es = 1 + (camS - 1) * d;      // this layer's effective zoom
        const tx = camTX * d;               // this layer's effective pan
        const ty = camTY * d;

        // Wrap inside the world window this layer actually shows, so density
        // on screen never changes with zoom.
        const spanX = (width  + WRAP_MARGIN * 2) / es;
        const spanY = (height + WRAP_MARGIN * 2) / es;
        const originX = (-WRAP_MARGIN - tx) / es;
        const originY = (-WRAP_MARGIN - ty) / es;
        p.x = originX + mod(p.x - originX, spanX);
        p.y = originY + mod(p.y - originY, spanY);

        const sx = p.x * es + tx;
        const sy = p.y * es + ty;

        if (ptr.active) {
          const dx = sx - ptr.x, dy = sy - ptr.y;
          const dist2 = dx * dx + dy * dy;
          if (dist2 < PTR_RADIUS * PTR_RADIUS) {
            const dist = Math.sqrt(dist2) || 0.0001;
            const fall = 1 - dist / PTR_RADIUS;
            const f = fall * fall * ptrGain;   // squared falloff = soft edge
            // Impulses are computed in screen px, so divide by this layer's
            // zoom to convert back into the world units velocity lives in.
            p.vx += ((dx / dist) * PTR_PUSH + ptr.vx * PTR_SWIRL) * f / es;
            p.vy += ((dy / dist) * PTR_PUSH + ptr.vy * PTR_SWIRL) * f / es;
          }
        }

        // Relax toward birth drift, then clamp — the field can be stirred but
        // never thrown.
        p.vx += (p.bvx - p.vx) * VEL_RELAX;
        p.vy += (p.bvy - p.vy) * VEL_RELAX;
        const sp2 = p.vx * p.vx + p.vy * p.vy;
        if (sp2 > MAX_SPEED * MAX_SPEED) {
          const k = MAX_SPEED / Math.sqrt(sp2);
          p.vx *= k; p.vy *= k;
        }

        if (sx < -4 || sx > width + 4 || sy < -4 || sy > height + 4) continue;

        const flicker = Math.sin(t * p.flicker + p.phase) * 0.28 + 0.72;
        ctx!.beginPath();
        // Near particles gain a little size with the zoom; far ones stay pins.
        ctx!.arc(sx, sy, p.r * (0.82 + 0.18 * es), 0, Math.PI * 2);
        ctx!.fillStyle = `hsla(${h}, ${sat}%, 80%, ${(p.alpha * flicker).toFixed(3)})`;
        ctx!.fill();
      }
      raf = requestAnimationFrame(draw);
    }
    draw();
    return () => { cancelled = true; cancelAnimationFrame(raf); };
  }, [width, height]);

  return (
    <canvas ref={canvasRef} width={width} height={height}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />
  );
}
