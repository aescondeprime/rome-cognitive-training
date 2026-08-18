/**
 * AkiraAmbience — the entire visible surface of Akira.
 *
 * V2 announced Akira with a permanent orb and label bar docked in the lower
 * right. V3 has no persistent chrome at all: when Akira is dormant this renders
 * a transparent, non-interactive layer and ROME looks exactly like ROME. When a
 * conversation is live, the edges of the window bloom with a soft gradient —
 * that bloom *is* the indicator.
 *
 * Two details worth knowing:
 *
 * 1. The glow breathes with your voice, not on a fixed timer. `AkiraProvider`
 *    writes microphone level straight to the `--akira-vad` custom property so
 *    the animation runs entirely in CSS — driving it through React state would
 *    mean a re-render every audio frame.
 * 2. When the World Browser mounts a native `WebContentsView`, that view paints
 *    over the DOM and a full-bleed overlay would be invisible. We switch to an
 *    inset frame drawn in the margin around the view instead.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { AkiraState } from "@shared/akira";
import { loadLayout } from "@/lib/constellationLayout";
import { setAkiraAmbience } from "@/lib/akiraAmbienceState";
import { useAkira } from "./AkiraProvider";

/** States that should light the room. Everything else stays dark. */
const ACTIVE_STATES: ReadonlySet<AkiraState> = new Set<AkiraState>([
  "WAKE_DETECTED",
  "LISTENING",
  "PROCESSING",
  "SPEAKING",
  "ACTING",
  "AWAITING_APPROVAL",
  "AWAKE_IDLE",
]);

export default function AkiraAmbience() {
  const { status } = useAkira();
  const [worldMode, setWorldMode] = useState(false);
  const [flashing, setFlashing] = useState(false);
  const errorFlashRef = useRef<number | null>(null);

  // Colors come from the Constellation layout, where the ray and accent colors
  // already live. Applied once on mount; the editor calls setAkiraAmbience
  // directly for live preview, so no subscription is needed here.
  useEffect(() => {
    try {
      const layout = loadLayout();
      setAkiraAmbience(layout.akiraGradientA, layout.akiraGradientB, layout.akiraIntensity);
    } catch {
      /* CSS fallbacks cover a malformed or missing layout */
    }
  }, []);

  // The World Browser mounts a native view over the DOM; track it so we can
  // fall back to a frame that survives being painted over.
  useEffect(() => {
    const read = () => setWorldMode(document.documentElement.dataset.romeDesktopWorld === "true");
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-rome-desktop-world"],
    });
    return () => observer.disconnect();
  }, []);

  const state: AkiraState = status?.state ?? "UNAVAILABLE";
  const reduceMotion = Boolean(status?.settings.appearance.reduceMotion);
  const animationStrength = status?.settings.appearance.animationStrength ?? 0.65;

  // A failure gets one amber pulse rather than a dialog. Akira going wrong
  // should be noticeable without being an interruption.
  useEffect(() => {
    if (state !== "ERROR") return;
    setFlashing(true);
    if (errorFlashRef.current) window.clearTimeout(errorFlashRef.current);
    errorFlashRef.current = window.setTimeout(() => setFlashing(false), 1_400);
    return () => {
      if (errorFlashRef.current) window.clearTimeout(errorFlashRef.current);
      errorFlashRef.current = null;
    };
  }, [state]);

  const visible = ACTIVE_STATES.has(state) || flashing;

  return (
    <div
      aria-hidden="true"
      data-testid="akira-ambience"
      className={[
        "akira-ambience",
        `akira-ambience-${state.toLowerCase()}`,
        worldMode ? "akira-ambience-framed" : "",
        visible ? "is-visible" : "",
        flashing ? "is-error-flash" : "",
        reduceMotion ? "is-static" : "",
      ].filter(Boolean).join(" ")}
      style={{ "--akira-anim-strength": reduceMotion ? "0" : animationStrength.toFixed(2) } as CSSProperties}
    />
  );
}
