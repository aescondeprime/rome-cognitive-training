/**
 * Shared light-ray state — single source of truth for position + direction.
 * All LightRay canvas instances read from here so the ray stays perfectly
 * in sync whether the constellation overlay is open or not.
 */

const DRIFT_SPEED = 0.055;

const state = {
  t: 0,
  // Final computed source position — USE THESE in LightRay
  srcX: 0.5,
  srcY: 0.12,
  // When pinned, Lissajous is frozen and source sits exactly here
  pinnedX: null as number | null,
  pinnedY: null as number | null,
  // Direction the beam points — radians. null = auto (aim at screen center)
  dirAngle: null as number | null,
  // Ray colour — HSL components string, e.g. "43 88% 60%"
  rayColor: "43 88% 60%",
  // Ray brightness multiplier — 1.0 = default, 0.2 = dim, 2.0 = bright
  rayBrightness: 1.0,
  started: false,
  rafHandle: 0,
};

export function getRayState() {
  return state;
}

export function startRayClock() {
  // Already running — do nothing. The clock is a singleton that never stops
  // once started; it just keeps updating shared position state.
  if (state.started) return;
  state.started = true;
  let last = performance.now();

  function tick(now: number) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    if (state.pinnedX !== null) {
      // Pinned — source is exactly where the user placed it, no drift
      state.srcX = state.pinnedX;
      state.srcY = state.pinnedY!;
    } else {
      // Free Lissajous drift
      state.t += dt * DRIFT_SPEED;
      const { sx, sy } = computeSourcePos(state.t);
      state.srcX = Math.max(0.01, Math.min(0.99, sx));
      state.srcY = Math.max(0.01, Math.min(0.99, sy));
    }

    document.documentElement.style.setProperty("--ray-x", `${(state.srcX * 100).toFixed(1)}%`);
    document.documentElement.style.setProperty("--ray-y", `${(state.srcY * 100).toFixed(1)}%`);
    // Colour components for CSS ambient glow
    const [rh = 43, rs = 88, rl = 60] = state.rayColor.replace(/%/g, "").split(/\s+/).map(Number);
    document.documentElement.style.setProperty("--ray-h", String(rh));
    document.documentElement.style.setProperty("--ray-s", `${rs}%`);
    document.documentElement.style.setProperty("--ray-l", `${rl}%`);

    state.rafHandle = requestAnimationFrame(tick);
  }

  state.rafHandle = requestAnimationFrame(tick);
}

/**
 * Pin the source to an exact normalised position [0–1].
 * Freezes the Lissajous drift entirely.
 * Call with (null, null) to unpin and resume drift.
 */
export function pinRaySource(x: number | null, y: number | null) {
  state.pinnedX = x;
  state.pinnedY = y;
  if (x !== null) {
    state.srcX = Math.max(0.01, Math.min(0.99, x));
    state.srcY = Math.max(0.01, Math.min(0.99, y!));
  }
}

/** @deprecated — use pinRaySource instead */
export function setRayEditOffset(_ox: number, _oy: number) {
  // No-op — kept for build compatibility, callers will be updated
}

export function setRayDirection(angle: number | null) {
  state.dirAngle = angle;
}

/** Update the beam colour. Pass HSL components only, e.g. "210 80% 65%" */
export function setRayColor(hsl: string) {
  state.rayColor = hsl;
}

/** Update the beam brightness multiplier (0.2–2.0, default 1.0) */
export function setRayBrightness(v: number) {
  state.rayBrightness = Math.max(0.1, Math.min(2.0, v));
}

/** Get current brightness multiplier */
export function getRayBrightness(): number {
  return state.rayBrightness;
}

/** Returns a parsed { h, s, l } object from the stored HSL string */
export function getRayHSL(): { h: number; s: number; l: number } {
  const [h = 43, s = 88, l = 60] = state.rayColor
    .replace(/%/g, "")
    .split(/\s+/)
    .map(Number);
  return { h, s, l };
}

/** Lissajous drift — slow figure-8, upper screen area. */
export function computeSourcePos(t: number): { sx: number; sy: number } {
  const ax = 0.38, fx = 0.031, px = 0;
  const ay = 0.28, fy = 0.019, py = Math.PI * 0.6;
  const sx = 0.5  + ax * Math.sin(t * fx * Math.PI * 2 + px);
  const sy = 0.12 + ay * Math.sin(t * fy * Math.PI * 2 + py);
  return { sx, sy };
}
