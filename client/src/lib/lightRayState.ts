/**
 * Shared light-ray state — single source of truth for the ray position.
 * Source is locked to the TOP edge, drifting slowly left↔right.
 * All LightRay instances read from here for perfect sync.
 */

const state = {
  t: 0,
  srcX: 0.5,
  srcY: -0.04,
  started: false,
  rafHandle: 0,
};

export function getRayState() {
  return state;
}

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

    document.documentElement.style.setProperty("--ray-x", `${(sx * 100).toFixed(1)}%`);
    document.documentElement.style.setProperty("--ray-y", `${(sy * 100).toFixed(1)}%`);

    state.rafHandle = requestAnimationFrame(tick);
  }

  state.rafHandle = requestAnimationFrame(tick);
}

/**
 * Source locked to top edge.
 * - Primary cycle: 60s (slow, majestic)
 * - Tiny wobble: 23s, very small amplitude
 * x range ≈ [0.20, 0.80]
 */
export function computeSourcePos(t: number): { sx: number; sy: number } {
  const primary = Math.sin(t * (Math.PI * 2) / 60);
  const wobble  = Math.sin(t * (Math.PI * 2) / 23) * 0.04;
  const sx = 0.5 + primary * 0.28 + wobble;
  const sy = -0.04; // just above top edge
  return { sx, sy };
}
