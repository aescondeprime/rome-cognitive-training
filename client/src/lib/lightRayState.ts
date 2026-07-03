/**
 * Shared light-ray state — single source of truth for position + direction.
 * All LightRay canvas instances read from here so the ray stays perfectly
 * in sync whether the constellation overlay is open or not.
 */

const DRIFT_SPEED = 0.055;

const state = {
  t: 0,
  // Final computed source position (offset already applied) — USE THESE in LightRay
  srcX: 0.5,
  srcY: 0.12,
  // Editor position offset (fraction of screen, added on top of Lissajous)
  editOffsetX: 0,
  editOffsetY: 0,
  // Direction the beam points — radians. null = auto (aim at screen center)
  dirAngle: null as number | null,
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
    state.t += dt * DRIFT_SPEED;

    const { sx, sy } = computeSourcePos(state.t);
    // Apply editor offset — this is what LightRay should use
    state.srcX = Math.max(0.01, Math.min(0.99, sx + state.editOffsetX));
    state.srcY = Math.max(0.01, Math.min(0.99, sy + state.editOffsetY));

    document.documentElement.style.setProperty("--ray-x", `${(state.srcX * 100).toFixed(1)}%`);
    document.documentElement.style.setProperty("--ray-y", `${(state.srcY * 100).toFixed(1)}%`);

    state.rafHandle = requestAnimationFrame(tick);
  }

  state.rafHandle = requestAnimationFrame(tick);
}

/** Nudge the source position on top of the Lissajous path. */
export function setRayEditOffset(ox: number, oy: number) {
  state.editOffsetX = ox;
  state.editOffsetY = oy;
}

/**
 * Override beam direction angle (radians). Pass null to restore auto-aim
 * (beam auto-aims toward screen center).
 */
export function setRayDirection(angle: number | null) {
  state.dirAngle = angle;
}

/** Lissajous drift — slow figure-8, upper screen area. */
export function computeSourcePos(t: number): { sx: number; sy: number } {
  const ax = 0.38, fx = 0.031, px = 0;
  const ay = 0.28, fy = 0.019, py = Math.PI * 0.6;
  const sx = 0.5  + ax * Math.sin(t * fx * Math.PI * 2 + px);
  const sy = 0.12 + ay * Math.sin(t * fy * Math.PI * 2 + py);
  return { sx, sy };
}
