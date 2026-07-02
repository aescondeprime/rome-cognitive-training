/**
 * Shared light-ray state — single source of truth for the ray position.
 * All LightRay canvas instances read from here so the ray stays perfectly
 * in sync whether the constellation overlay is open or not.
 *
 * Uses the original Lissajous drift path from Mark VII.
 */

const DRIFT_SPEED = 0.055;

const state = {
  t: 0,
  srcX: 0.5,
  srcY: 0.12,
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
    state.t += dt * DRIFT_SPEED;

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
 * Original Lissajous drift — slow figure-8 path that visits corners over ~60s.
 * Source stays in the upper portion of the screen.
 */
export function computeSourcePos(t: number): { sx: number; sy: number } {
  const ax = 0.38, fx = 0.031, px = 0;
  const ay = 0.28, fy = 0.019, py = Math.PI * 0.6;
  const sx = 0.5  + ax * Math.sin(t * fx * Math.PI * 2 + px);
  const sy = 0.12 + ay * Math.sin(t * fy * Math.PI * 2 + py);
  return { sx, sy };
}
