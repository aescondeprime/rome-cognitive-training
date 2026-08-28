/**
 * AmbientBackdrop — ROME's own sky, mounted behind a page.
 *
 * Built for the World Browser's opacity slider. Fading the browser only pays
 * off if there is something behind it, and there wasn't: the cave gradient and
 * the starfield are drawn by `ConstellationMenu`, which unmounts the moment you
 * leave the map. On the browser screen the fade would have revealed a flat
 * `--background` and the feature would have looked broken.
 *
 * This is the same gradient (`.rome-bg`) and the same particle field, minus the
 * camera and minus every interaction. The light ray is deliberately *not*
 * redrawn here — `App` already mounts one at z-index 201, above this, and it
 * shows through the faded page on its own.
 *
 * It fills its nearest positioned ancestor rather than the window, so the
 * caller decides exactly which rectangle gets a sky. That also keeps it out of
 * the page's stacking order: dropped in as the first child of the surface it
 * sits behind, everything else in that surface paints over it by tree order and
 * no z-index has to be invented for the rest of the screen.
 *
 * Mounted only while the surface above it is actually translucent — a second
 * always-on RAF loop is not worth paying for a layer nobody can see.
 */
import { useEffect, useRef, useState } from "react";
import ParticleCanvas from "./ParticleCanvas";
import { loadLayout, DEFAULT_PARTICLE_SATURATION } from "@/lib/constellationLayout";

export default function AmbientBackdrop({
  /** 0–1. A barely-faded page should not sit on a full sky. */
  strength = 1,
  zIndex = 0,
}: {
  strength?: number;
  zIndex?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });

  // The canvas needs pixel dimensions, and the rectangle this sits in is a flex
  // child that resizes with the window, the toolbar and the panel state. A
  // ResizeObserver is the only thing that catches all three.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => {
      const rect = host.getBoundingClientRect();
      setDims(prev => {
        const w = Math.round(rect.width);
        const h = Math.round(rect.height);
        return prev.w === w && prev.h === h ? prev : { w, h };
      });
    };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(host);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  // Read once on mount rather than subscribing: the particle settings are only
  // edited in the Constellation, and opening the Constellation unmounts this.
  const [layout] = useState(loadLayout);

  // Thinner than the map's field. Behind a web page this is texture, not the
  // subject, and a full-density starfield reads as dirt on the screen.
  const count = Math.round((layout.particleCount ?? 280) * 0.45);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        zIndex,
        pointerEvents: "none",
        overflow: "hidden",
        opacity: Math.max(0, Math.min(1, strength)),
        transition: "opacity 180ms ease",
      }}
    >
      <div className="rome-bg" style={{ position: "absolute", inset: 0, zIndex: 0 }} />
      {dims.w > 0 && dims.h > 0 && (
        <ParticleCanvas
          width={dims.w}
          height={dims.h}
          count={count}
          particleHue={layout.particleHue ?? undefined}
          saturation={layout.particleSaturation ?? DEFAULT_PARTICLE_SATURATION}
        />
      )}
    </div>
  );
}
