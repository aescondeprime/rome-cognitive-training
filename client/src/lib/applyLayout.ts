/**
 * The single place where a stored ConstellationLayout becomes live renderer
 * state.
 *
 * This module exists because there used to be two such places, and they
 * disagreed. `ConstellationMenu` applied the ray's position, direction, colour
 * and brightness from an effect that only ran once the map was open; `App`
 * applied the accent colour and nothing else at boot. The visible result was
 * that every cold start showed the prototype's drifting gold ray until you
 * opened the Constellation, at which point your real settings appeared — the
 * classic symptom of two code paths owning the same state.
 *
 * Anything that turns stored layout into live state belongs here, and every
 * caller goes through it.
 */

import {
  DEFAULT_ACCENT_COLOR,
  DEFAULT_AKIRA_GRADIENT_A,
  DEFAULT_AKIRA_GRADIENT_B,
  DEFAULT_AKIRA_INTENSITY,
  DEFAULT_RAY_COLOR,
  DEFAULT_SOUND_ENABLED,
  DEFAULT_SOUND_PITCH,
  DEFAULT_SOUND_VOLUME,
  type ConstellationLayout,
} from "./constellationLayout";
import {
  pinRaySource,
  setAccentColor,
  setRayBrightness,
  setRayColor,
  setRayDirection,
} from "./lightRayState";
import { setAkiraAmbience } from "./akiraAmbienceState";
import { setSoundEnabled, setSoundPitch, setSoundVolume } from "./sound";

/**
 * Is the ray source drifting rather than pinned?
 *
 * Layouts saved before the float toggle existed carry no `rayFloat`. For those,
 * an untouched source at (0, 0) meant drifting — which is exactly what the old
 * code inferred from the same two numbers — so the fallback reproduces what the
 * user was already seeing rather than changing it under them.
 */
export function isRayFloating(layout: ConstellationLayout): boolean {
  return layout.ray.rayFloat ?? (layout.ray.x === 0 && layout.ray.y === 0);
}

/** Ray position, direction, colour and brightness, plus the UI accent. */
export function applyRayLayout(layout: ConstellationLayout): void {
  if (isRayFloating(layout)) {
    pinRaySource(null, null);
    // A drifting source with a fixed beam angle sweeps light across the room
    // like a searchlight, which reads as a bug rather than as a choice. A
    // floating source always aims itself.
    setRayDirection(null);
  } else {
    pinRaySource(
      Math.max(0.01, Math.min(0.99, 0.5 + layout.ray.x)),
      Math.max(0.01, Math.min(0.99, 0.28 + layout.ray.y)),
    );
    setRayDirection(layout.ray.dirAngle ?? null);
  }
  setRayColor(layout.ray.rayColor ?? DEFAULT_RAY_COLOR);
  setRayBrightness(layout.ray.rayBrightness ?? 1.0);
  setAccentColor(layout.accentColor ?? DEFAULT_ACCENT_COLOR);
}

/**
 * Everything the renderer draws or plays from stored layout.
 *
 * Safe to call at module-eval time, before React mounts: it only touches
 * `document.documentElement` and module-level state, never the DOM tree.
 */
export function applyLayout(layout: ConstellationLayout): void {
  applyRayLayout(layout);
  setAkiraAmbience(
    layout.akiraGradientA ?? DEFAULT_AKIRA_GRADIENT_A,
    layout.akiraGradientB ?? DEFAULT_AKIRA_GRADIENT_B,
    layout.akiraIntensity ?? DEFAULT_AKIRA_INTENSITY,
  );
  setSoundEnabled(layout.soundEnabled ?? DEFAULT_SOUND_ENABLED);
  setSoundVolume(layout.soundVolume ?? DEFAULT_SOUND_VOLUME);
  setSoundPitch(layout.soundPitch ?? DEFAULT_SOUND_PITCH);
}
