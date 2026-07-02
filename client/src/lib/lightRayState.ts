/**
 * Shared light-ray state — single source of truth for the ray position.
 * All LightRay canvas instances read from here so the ray stays perfectly
 * in sync whether the constellation overlay is open or not.
 *
 * Source is locked to the TOP edge of the screen, drifting slowly left→right→left.
 */

const state = {
  t: 0,
  srcX: 0.5,   // normalised [0,1] — starts top-center
  srcY: -0.06, // just above the top edge
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

    const { sx, sy } = computeSourcePos(state.t);
    state.srcX = sx;
    state.srcY = sy;

    // Keep CSS vars in sync for any CSS consumers
    document.documentElement.style.setProperty("--ray-x", `${(sx * 100).toFixed(1)}%`);
    document.documentElement.style.setProperty("--ray-y", `${(sy * 100).toFixed(1)}%`);

    state.rafHandle = requestAnimationFrame(tick);
  }

  state.rafHandle = requestAnimationFrame(tick);
}

/**
 * Source position: locked to TOP edge, drifts left↔right on a slow sine wave.
 * - X: oscillates between ~0.15 and ~0.85 over a 40s cycle
 * - Y: always slightly above the screen (–0.06), so only the beam is visible
 */
export function computeSourcePos(t: number): { sx: number; sy: number } {
  // Primary drift: 40s full left-right cycle
  const primary   = Math.sin(t * (Math.PI * 2) / 40);
  // Subtle wobble layered on top: 17s cycle, small amplitude
  const wobble    = Math.sin(t * (Math.PI * 2) / 17) * 0.06;

  const sx = 0.5 + (primary * 0.32) + wobble; // range ≈ [0.12, 0.88]
  const sy = -0.06;                             // fixed just above the top edge

  return { sx, sy };
}
