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
  rayColor: string;        // HSL string, e.g. "43 88% 60%" (just H S L, no hsl() wrapper)
  rayBrightness: number;   // 0.1–2.0, default 1.0
}

export interface ConstellationLayout {
  nodes: Record<string, NodeOverride>;
  ray: RayOverride;
  accentColor: string;    // HSL components, e.g. "43 88% 60%"
  particleCount: number;  // 0–560, default 280
  particleHue: number | null;  // null = follow accent hue
}

export const DEFAULT_RAY_COLOR    = "43 88% 60%";
export const DEFAULT_ACCENT_COLOR = "43 88% 60%";

function defaultLayout(): ConstellationLayout {
  return { nodes: {}, ray: { x: 0, y: 0, dirAngle: null, rayColor: DEFAULT_RAY_COLOR, rayBrightness: 1.0 }, accentColor: DEFAULT_ACCENT_COLOR, particleCount: 280, particleHue: null };
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
    // Backfill rayColor if missing
    if (parsed.ray && !("rayColor" in parsed.ray)) {
      parsed.ray.rayColor = DEFAULT_RAY_COLOR;
    }
    // Backfill rayBrightness if missing
    if (parsed.ray && !("rayBrightness" in parsed.ray)) {
      parsed.ray.rayBrightness = 1.0;
    }
    // Backfill accentColor if missing
    if (!("accentColor" in parsed)) {
      (parsed as any).accentColor = DEFAULT_ACCENT_COLOR;
    }
    // Backfill particle settings if missing
    if (!("particleCount" in parsed)) (parsed as any).particleCount = 280;
    if (!("particleHue"   in parsed)) (parsed as any).particleHue   = null;
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
