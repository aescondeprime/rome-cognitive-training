/**
 * accent — ROME's accent colour, as strings you can put in an inline style.
 *
 * The accent lives as three CSS custom properties (`--accent-h/s/l`) written
 * onto `<html>` by `applyLayout`, so it follows the editor live. Anything that
 * hard-codes a colour instead — a node's own `accent`, a literal `hsl(...)` —
 * stops tracking it the moment the user changes it, which is how a menu ends up
 * gold in a blue app.
 *
 * `accent(0.3)` uses space-separated alpha syntax, which is what lets the
 * custom properties stay inside the colour rather than being concatenated into
 * one by hand.
 */
export function accent(alpha?: number): string {
  const base = "var(--accent-h) var(--accent-s) var(--accent-l)";
  return alpha === undefined ? `hsl(${base})` : `hsl(${base} / ${alpha})`;
}

/** The accent at an explicit lightness — for chrome that must stay legible. */
export function accentAt(lightness: number, alpha?: number): string {
  const base = `var(--accent-h) var(--accent-s) ${lightness}%`;
  return alpha === undefined ? `hsl(${base})` : `hsl(${base} / ${alpha})`;
}

/** The accent desaturated, for resting states that should recede. */
export function accentDim(saturation: number, lightness: number, alpha?: number): string {
  const base = `var(--accent-h) ${saturation}% ${lightness}%`;
  return alpha === undefined ? `hsl(${base})` : `hsl(${base} / ${alpha})`;
}
