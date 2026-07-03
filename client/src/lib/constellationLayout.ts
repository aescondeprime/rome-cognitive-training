const STORAGE_KEY = "rome_constellation_layout_v2";

export interface NodeOverride {
  x: number; // percentage 0–100
  y: number;
  size: number;
}

export interface RayOverride {
  x: number;           // fractional position offset, range –0.4 → +0.4
  y: number;
  dirAngle: number | null; // beam direction in radians; null = auto-aim
}

export interface ConstellationLayout {
  nodes: Record<string, NodeOverride>;
  ray: RayOverride;
}

function defaultLayout(): ConstellationLayout {
  return { nodes: {}, ray: { x: 0, y: 0, dirAngle: null } };
}

export function loadLayout(): ConstellationLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultLayout();
    const parsed = JSON.parse(raw) as ConstellationLayout;
    // Backfill dirAngle if missing (upgrading from v1)
    if (parsed.ray && !("dirAngle" in parsed.ray)) {
      parsed.ray.dirAngle = null;
    }
    return parsed;
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
    // Also clear v1 key
    localStorage.removeItem("rome_constellation_layout_v1");
  } catch {}
}
