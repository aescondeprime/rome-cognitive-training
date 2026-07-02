/**
 * Persistent layout overrides for the constellation.
 * Stores node positions (% of screen), node sizes, and ray source offset
 * in localStorage so edits survive page refreshes.
 */

const STORAGE_KEY = "rome_constellation_layout_v1";

export interface NodeOverride {
  x: number; // percentage 0–100
  y: number;
  size: number;
}

export interface RayOverride {
  offsetX: number; // fractional offset added on top of Lissajous drift, range –0.4 → +0.4
  offsetY: number;
}

export interface ConstellationLayout {
  nodes: Record<string, NodeOverride>;
  ray: RayOverride;
}

function defaultLayout(): ConstellationLayout {
  return { nodes: {}, ray: { offsetX: 0, offsetY: 0 } };
}

export function loadLayout(): ConstellationLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultLayout();
    return JSON.parse(raw) as ConstellationLayout;
  } catch {
    return defaultLayout();
  }
}

export function saveLayout(layout: ConstellationLayout) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {}
}

export function resetLayout() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}
