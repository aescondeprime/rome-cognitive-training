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
  /**
   * Let the source drift on its own Lissajous path instead of sitting where it
   * was dragged. While floating, `dirAngle` is ignored and the beam aims itself
   * — a moving source with a fixed angle sweeps like a searchlight.
   */
  rayFloat: boolean;
}

export interface ConstellationLayout {
  nodes: Record<string, NodeOverride>;
  ray: RayOverride;
  accentColor: string;    // HSL components, e.g. "43 88% 60%"
  particleCount: number;  // 0–560, default 280
  particleHue: number | null;  // null = follow accent hue
  particleSaturation: number;  // 0-100, was hard-coded at 55
  widgetPos: { x: number; y: number } | null;  // null = default top-right
  widgetCollapsed: boolean;
  projectsWidgetPos: { x: number; y: number } | null;
  projectsWidgetCollapsed: boolean;
  threatsWidgetPos: { x: number; y: number } | null;
  threatsWidgetCollapsed: boolean;
  taskStabilizerWidgetPos: { x: number; y: number } | null;
  taskStabilizerWidgetCollapsed: boolean;
  /**
   * Akira's ambient background gradient. Stored here rather than in Akira's
   * Electron settings because the renderer is what draws it, and this is where
   * every other user-tunable ROME color already lives.
   */
  akiraGradientA: string;   // HSL components, e.g. "178 76% 58%"
  akiraGradientB: string;
  akiraIntensity: number;   // 0.15–1, default 0.6
  /**
   * UI sound cues. Synthesised in `lib/sound.ts` rather than sampled, so these
   * two values are the whole of their persisted state — everything else about
   * a cue is code.
   */
  soundEnabled: boolean;
  soundVolume: number;      // 0–1, default 0.6
  /**
   * Frequency multiplier for the whole cue palette. 1.0 is the designed
   * baseline; the editor presents it in semitones. Stored as a multiplier so
   * `sound.ts` can use it directly without converting on every voice.
   */
  soundPitch: number;       // 0.5–2.2, default 1.122 (+2 semitones)
}

export const DEFAULT_RAY_COLOR    = "43 88% 60%";
export const DEFAULT_ACCENT_COLOR = "43 88% 60%";

export const DEFAULT_AKIRA_GRADIENT_A = "178 76% 58%";
export const DEFAULT_AKIRA_GRADIENT_B = "268 82% 68%";
export const DEFAULT_AKIRA_INTENSITY  = 0.6;
export const DEFAULT_PARTICLE_SATURATION = 70;

export const DEFAULT_SOUND_ENABLED = true;
export const DEFAULT_SOUND_VOLUME  = 0.6;
// +2 semitones. The palette's own balance now does most of the lightening (see
// the note above the cue table in `sound.ts`), so this only has to nudge.
export const DEFAULT_SOUND_PITCH   = 1.122;

/**
 * A pristine layout. Exported so the editor's Reset uses exactly the same
 * object the loader falls back to — in V2 these were two separate literals and
 * drifted apart every time a field was added.
 */
export function defaultLayout(): ConstellationLayout {
  return {
    nodes: {},
    ray: { x: 0, y: 0, dirAngle: null, rayColor: DEFAULT_RAY_COLOR, rayBrightness: 1.0, rayFloat: true },
    accentColor: DEFAULT_ACCENT_COLOR,
    particleCount: 280,
    particleHue: null,
    particleSaturation: DEFAULT_PARTICLE_SATURATION,
    widgetPos: null,
    widgetCollapsed: false,
    projectsWidgetPos: null,
    projectsWidgetCollapsed: false,
    threatsWidgetPos: null,
    threatsWidgetCollapsed: false,
    taskStabilizerWidgetPos: null,
    taskStabilizerWidgetCollapsed: false,
    akiraGradientA: DEFAULT_AKIRA_GRADIENT_A,
    akiraGradientB: DEFAULT_AKIRA_GRADIENT_B,
    akiraIntensity: DEFAULT_AKIRA_INTENSITY,
    soundEnabled: DEFAULT_SOUND_ENABLED,
    soundVolume: DEFAULT_SOUND_VOLUME,
    soundPitch: DEFAULT_SOUND_PITCH,
  };
}

export function loadLayout(): ConstellationLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultLayout();
    const parsed = JSON.parse(raw) as ConstellationLayout;
    // Stored layouts predate several fields, so every read backfills.
    // `ray` is cast through a loose record: narrowing `ConstellationLayout` with
    // `"dirAngle" in parsed.ray` collapses the type to `never` (the property is
    // already declared), which made three of these lines fail typecheck.
    const ray = parsed.ray as unknown as Record<string, unknown> | undefined;
    if (ray) {
      if (!("dirAngle" in ray)) ray.dirAngle = null;
      if (!("rayColor" in ray)) ray.rayColor = DEFAULT_RAY_COLOR;
      if (!("rayBrightness" in ray)) ray.rayBrightness = 1.0;
      // Pre-toggle layouts: an untouched source meant drifting, which is what
      // the renderer inferred from these same two numbers.
      if (!("rayFloat" in ray)) ray.rayFloat = ray.x === 0 && ray.y === 0;
    }
    // Backfill accentColor if missing
    if (!("accentColor" in parsed)) {
      (parsed as any).accentColor = DEFAULT_ACCENT_COLOR;
    }
    // Backfill particle settings if missing
    if (!("particleCount"    in parsed)) (parsed as any).particleCount    = 280;
    if (!("particleHue"      in parsed)) (parsed as any).particleHue      = null;
    if (!("particleSaturation" in parsed)) (parsed as any).particleSaturation = DEFAULT_PARTICLE_SATURATION;
    if (!("widgetPos"              in parsed)) (parsed as any).widgetPos              = null;
    if (!("widgetCollapsed"        in parsed)) (parsed as any).widgetCollapsed        = false;
    if (!("projectsWidgetPos"      in parsed)) (parsed as any).projectsWidgetPos      = null;
    if (!("projectsWidgetCollapsed" in parsed)) (parsed as any).projectsWidgetCollapsed = false;
    if (!("threatsWidgetPos"        in parsed)) (parsed as any).threatsWidgetPos        = null;
    if (!("threatsWidgetCollapsed"  in parsed)) (parsed as any).threatsWidgetCollapsed  = false;
    if (!("taskStabilizerWidgetPos" in parsed)) (parsed as any).taskStabilizerWidgetPos = null;
    if (!("taskStabilizerWidgetCollapsed" in parsed)) (parsed as any).taskStabilizerWidgetCollapsed = false;
    // Backfill Akira ambience settings (added in Akira V3)
    if (!("akiraGradientA" in parsed)) (parsed as any).akiraGradientA = DEFAULT_AKIRA_GRADIENT_A;
    if (!("akiraGradientB" in parsed)) (parsed as any).akiraGradientB = DEFAULT_AKIRA_GRADIENT_B;
    if (!("akiraIntensity"  in parsed)) (parsed as any).akiraIntensity  = DEFAULT_AKIRA_INTENSITY;
    // Backfill sound settings (added with the UI cue palette)
    if (!("soundEnabled" in parsed)) (parsed as any).soundEnabled = DEFAULT_SOUND_ENABLED;
    if (!("soundVolume"  in parsed)) (parsed as any).soundVolume  = DEFAULT_SOUND_VOLUME;
    if (!("soundPitch"   in parsed)) (parsed as any).soundPitch   = DEFAULT_SOUND_PITCH;
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
