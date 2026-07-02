/**
 * Shared light-ray state — single source of truth for the ray position.
 * All LightRay canvas instances read from here so the ray stays perfectly
 * in sync whether the constellation overlay is open or not.
 */

const state = {
  t: 0,                 // accumulated time (seconds, same drift formula everywhere)
  srcX: 0.2,            // normalised [0,1] — updated each frame by the active canvas
  srcY: -0.04,          // starts just off the top edge
  started: false,
  rafHandle: 0,
};

export function getRayState() {
  return state;
}

/** Call once to start the shared clock. Safe to call multiple times. */
export function startRayClock() {
  if (state.started) return;
  state.started = true;
  let last = performance.now();

  function tick(now: number) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    state.t += dt;

    // Compute new source position and store it
    const { sx, sy } = computeSourcePos(state.t);
    state.srcX = sx;
    state.srcY = sy;

    // Keep CSS vars in sync (for rome-card ::before and any CSS consumers)
    const xPct = ((sx + 0.5) * 100).toFixed(1); // map [-0.5,1.5] → richer range
    document.documentElement.style.setProperty("--ray-x", `${(sx * 100).toFixed(1)}%`);
    document.documentElement.style.setProperty("--ray-y", `${(sy * 100).toFixed(1)}%`);

    state.rafHandle = requestAnimationFrame(tick);
  }

  state.rafHandle = requestAnimationFrame(tick);
}

/**
 * Lissajous path that keeps the source on/just outside the screen perimeter.
 * The source is always off-screen — only the beam enters the scene.
 * Returns normalised coords: x in [-0.15, 1.15], y in [-0.15, 1.15].
 * Values outside [0,1] are off-screen.
 */
export function computeSourcePos(t: number): { sx: number; sy: number } {
  // Perimeter walk: parameterise as angle around a squircle just outside the viewport
  // Period ~90s so the full cycle is slow and majestic
  const angle = t * (Math.PI * 2 / 90);

  // Squircle-ish path: stays near the four edges
  // Map to [-1, 1] in both axes, then offset to be just outside the screen edge
  const p = 4; // squircle power — higher = more rectangular
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  // Unit squircle: sign(cos)|cos|^(2/p), sign(sin)|sin|^(2/p)
  const ux = Math.sign(cosA) * Math.pow(Math.abs(cosA), 2 / p);
  const uy = Math.sign(sinA) * Math.pow(Math.abs(sinA), 2 / p);

  // Map from [-1,1] to screen coords just outside [0,1]
  const margin = 0.08; // how far outside the edge the source sits
  const sx = 0.5 + ux * (0.5 + margin);
  const sy = 0.5 + uy * (0.5 + margin);

  return { sx, sy };
}
