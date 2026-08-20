/**
 * Akira ambience state — the background gradient that signals a live conversation.
 *
 * Follows the same shape as `lightRayState`: colors are pushed onto CSS custom
 * properties on `:root`, so anything that references `var(--akira-*)` repaints
 * immediately without a React render. The Constellation editor writes here on
 * every picker change to give a live preview, and `AkiraAmbience` reads nothing
 * back — it just toggles state classes.
 */

import {
  DEFAULT_AKIRA_GRADIENT_A,
  DEFAULT_AKIRA_GRADIENT_B,
  DEFAULT_AKIRA_INTENSITY,
} from "./constellationLayout";

export interface AkiraAmbienceColors {
  gradientA: string;
  gradientB: string;
  intensity: number;
}

const state: AkiraAmbienceColors = {
  gradientA: DEFAULT_AKIRA_GRADIENT_A,
  gradientB: DEFAULT_AKIRA_GRADIENT_B,
  intensity: DEFAULT_AKIRA_INTENSITY,
};

/** Split an "H S% L%" string into numbers, tolerating malformed input. */
function parseHsl(value: string, fallback: [number, number, number]): [number, number, number] {
  const parts = String(value ?? "").replace(/%/g, "").trim().split(/\s+/).map(Number);
  const [h, s, l] = parts;
  return [
    Number.isFinite(h) ? h : fallback[0],
    Number.isFinite(s) ? s : fallback[1],
    Number.isFinite(l) ? l : fallback[2],
  ];
}

export function getAkiraAmbience(): AkiraAmbienceColors {
  return { ...state };
}

/**
 * Push gradient colors and intensity to `:root`.
 *
 * Components are written separately (`--akira-a-h`, `--akira-a-s`, …) so CSS can
 * build derived colors — a dimmer wash, a more saturated core — with
 * `hsl(var(--akira-a-h) var(--akira-a-s) …)` instead of being stuck with one
 * flat value.
 */
export function setAkiraAmbience(
  gradientA: string,
  gradientB: string,
  intensity: number = state.intensity,
): void {
  state.gradientA = gradientA;
  state.gradientB = gradientB;
  state.intensity = Math.max(0.15, Math.min(1, Number(intensity) || DEFAULT_AKIRA_INTENSITY));

  const el = document.documentElement;
  const [ah, as, al] = parseHsl(gradientA, [178, 76, 58]);
  const [bh, bs, bl] = parseHsl(gradientB, [268, 82, 68]);

  el.style.setProperty("--akira-a-h", String(ah));
  el.style.setProperty("--akira-a-s", `${as}%`);
  el.style.setProperty("--akira-a-l", `${al}%`);
  el.style.setProperty("--akira-b-h", String(bh));
  el.style.setProperty("--akira-b-s", `${bs}%`);
  el.style.setProperty("--akira-b-l", `${bl}%`);
  el.style.setProperty("--akira-gradient-a", `hsl(${ah} ${as}% ${al}%)`);
  el.style.setProperty("--akira-gradient-b", `hsl(${bh} ${bs}% ${bl}%)`);
  el.style.setProperty("--akira-intensity", state.intensity.toFixed(2));
}

/** Convenience for the editor's intensity slider. */
export function setAkiraIntensity(intensity: number): void {
  setAkiraAmbience(state.gradientA, state.gradientB, intensity);
}
