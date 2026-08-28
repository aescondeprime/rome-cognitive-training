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
  flashcardWidgetPos: { x: number; y: number } | null;
  flashcardWidgetCollapsed: boolean;
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
  /**
   * Per-widget uniform scale, keyed by `WidgetKey`. A single map rather than
   * five more sibling fields — the widget list has grown twice already and the
   * flat fields below are the reason `loadLayout` is thirty lines of backfill.
   */
  widgetScales: Partial<Record<WidgetKey, number>>;
  /**
   * Viewport the widget positions were last written against. Opening ROME on a
   * smaller display remaps them proportionally instead of leaving half of them
   * past the edge — without this there is no way to tell "dragged to x=1700"
   * from "saved on a 2560-wide screen".
   */
  widgetViewport: { w: number; h: number } | null;
}

// ── Widgets ────────────────────────────────────────────────────────────────

export const WIDGET_KEYS = ["kronos", "taskStabilizer", "threats", "projects", "flashcards"] as const;
export type WidgetKey = (typeof WIDGET_KEYS)[number];

/** Which `ConstellationLayout` field holds each widget's position. */
export const WIDGET_POS_FIELD: Record<WidgetKey, keyof ConstellationLayout> = {
  kronos:         "widgetPos",
  taskStabilizer: "taskStabilizerWidgetPos",
  threats:        "threatsWidgetPos",
  projects:       "projectsWidgetPos",
  flashcards:     "flashcardWidgetPos",
};

export const WIDGET_LABELS: Record<WidgetKey, string> = {
  kronos:         "Agenda",
  taskStabilizer: "Stabilizer",
  threats:        "Threats",
  projects:       "Projects",
  flashcards:     "Flashcards",
};

export const DEFAULT_WIDGET_SCALE = 1;
export const MIN_WIDGET_SCALE = 0.6;
export const MAX_WIDGET_SCALE = 1.6;

export function clampWidgetScale(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_WIDGET_SCALE;
  return Math.min(MAX_WIDGET_SCALE, Math.max(MIN_WIDGET_SCALE, value));
}

export function widgetScale(layout: ConstellationLayout, key: WidgetKey): number {
  return clampWidgetScale(layout.widgetScales?.[key] ?? DEFAULT_WIDGET_SCALE);
}

/**
 * Remap every stored widget position from the viewport it was saved against to
 * the one on screen now. Returns the same object when nothing moved, so callers
 * can use identity to decide whether to write state back.
 *
 * Positions are kept *proportional*, not merely clamped: a widget parked in the
 * lower right of a 27" display belongs in the lower right of a laptop screen,
 * not stacked against the edge with the other three. The final clamp against
 * the real measured box still happens in each widget — this pass only knows the
 * nominal width and cannot know how tall a widget rendered.
 */
export function refitWidgetPositions(
  layout: ConstellationLayout,
  viewport: { w: number; h: number },
): ConstellationLayout {
  const from = layout.widgetViewport;
  const sameViewport = from && from.w === viewport.w && from.h === viewport.h;
  if (sameViewport) return layout;

  // No recorded origin: adopt the current viewport without moving anything.
  // Guessing a scale factor here would shuffle a layout that is already correct.
  if (!from || from.w <= 0 || from.h <= 0) {
    return { ...layout, widgetViewport: { w: viewport.w, h: viewport.h } };
  }

  const sx = viewport.w / from.w;
  const sy = viewport.h / from.h;
  const next: ConstellationLayout = { ...layout, widgetViewport: { w: viewport.w, h: viewport.h } };

  for (const key of WIDGET_KEYS) {
    const field = WIDGET_POS_FIELD[key];
    const pos = layout[field] as { x: number; y: number } | null | undefined;
    if (!pos) continue;   // still on its default — the widget computes that itself
    const x = Math.max(0, Math.min(viewport.w - 40, Math.round(pos.x * sx)));
    const y = Math.max(0, Math.min(viewport.h - 40, Math.round(pos.y * sy)));
    (next as any)[field] = { x, y };
  }
  return next;
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
    flashcardWidgetPos: null,
    flashcardWidgetCollapsed: false,
    threatsWidgetCollapsed: false,
    taskStabilizerWidgetPos: null,
    taskStabilizerWidgetCollapsed: false,
    akiraGradientA: DEFAULT_AKIRA_GRADIENT_A,
    akiraGradientB: DEFAULT_AKIRA_GRADIENT_B,
    akiraIntensity: DEFAULT_AKIRA_INTENSITY,
    soundEnabled: DEFAULT_SOUND_ENABLED,
    soundVolume: DEFAULT_SOUND_VOLUME,
    soundPitch: DEFAULT_SOUND_PITCH,
    widgetScales: {},
    widgetViewport: null,
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
    if (!("flashcardWidgetPos"      in parsed)) (parsed as any).flashcardWidgetPos      = null;
    if (!("flashcardWidgetCollapsed" in parsed)) (parsed as any).flashcardWidgetCollapsed = false;
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
    // Backfill widget sizing (added with the editor's resize handles)
    if (!("widgetScales"   in parsed) || typeof parsed.widgetScales !== "object" || parsed.widgetScales === null) {
      (parsed as any).widgetScales = {};
    }
    if (!("widgetViewport" in parsed)) (parsed as any).widgetViewport = null;
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
