/**
 * ROME sound design — procedural UI cues.
 *
 * Every sound is synthesised at play time from oscillators and filtered noise.
 * There are no audio files: the palette is a few hundred bytes of maths, it
 * never touches the bundle, and it retunes by editing numbers rather than by
 * re-exporting samples.
 *
 * Shape mirrors `lightRayState` / `akiraAmbienceState` — module-level runtime
 * state the Constellation editor writes into, so tuning is live and firing a
 * cue never re-renders a React tree.
 *
 * ── How this got here ───────────────────────────────────────────────────────
 *
 * v1 was bright sines at clean fifths with an ascending arpeggio on arrival,
 * which is the recipe for a game chime. v2 fixed that by moving the weight to
 * the bottom — low fundamentals gliding down, bell-ratio partials, a dark room.
 * v2 was heavy, but it was *acoustic*: an object being struck in a space.
 *
 * v3 keeps the weight and makes the thing a machine.
 *
 * • **Ring modulation.** Pitched partials are carrier × modulator at inharmonic
 *   ratios. The product contains no fundamental, only sum and difference tones.
 *   This is the robot timbre, and no amount of filtering imitates it.
 * • **Stepped pitch.** The low fall no longer glides. It holds four to six
 *   discrete values on an exact clock — a number being decremented by something
 *   counting, rather than mass settling. This is the single biggest change.
 * • **Data bursts.** Ticks spaced to the millisecond, pitch stepping by a fixed
 *   ratio. Nothing organic repeats that precisely, which is the point.
 * • **Quantisation.** A 6-bit crusher on the machine bus: digital grain, well
 *   short of lo-fi ruin.
 * • **Comb resonance.** A 6.5ms comb rings near 154Hz — the hollow of a small
 *   enclosure. A mechanism, where the reverb bus is a room.
 * • **Servo vibrato on the filter, never the pitch.** A band wobbling at 26–40Hz
 *   is a motor under load; the same wobble on an oscillator merely sounds sung.
 *
 * Levels are set by measurement rather than by ear — see the sound-design doc.
 */

import { DEFAULT_SOUND_ENABLED, DEFAULT_SOUND_PITCH, DEFAULT_SOUND_VOLUME } from "./constellationLayout";

// ── Cue vocabulary ──────────────────────────────────────────────────────────

export type CueName =
  | "nodeHover"
  | "nodeSelect"
  | "nodeDeselect"
  | "constellationOpen"
  | "constellationClose"
  | "domainEnter"
  | "domainShift";

/** Ordered for the editor's preview row. */
export const CUE_NAMES: CueName[] = [
  "nodeHover",
  "nodeSelect",
  "nodeDeselect",
  "constellationOpen",
  "constellationClose",
  "domainEnter",
  "domainShift",
];

export const CUE_LABELS: Record<CueName, string> = {
  nodeHover:          "Hover",
  nodeSelect:         "Select",
  nodeDeselect:       "Release",
  constellationOpen:  "Map open",
  constellationClose: "Map close",
  domainEnter:        "Enter",
  domainShift:        "Shift",
};

/**
 * Minimum gap between two firings of the same cue. Hover is the one that can
 * machine-gun — dragging the pointer across a node field would otherwise fire
 * once per node — so it gets the longest guard.
 */
const COOLDOWN_MS: Record<CueName, number> = {
  nodeHover:          80,
  nodeSelect:         40,
  nodeDeselect:       40,
  constellationOpen:  120,
  constellationClose: 120,
  domainEnter:        150,
  domainShift:        150,
};

// ── Pitch material ──────────────────────────────────────────────────────────
//
// One pitch class (D), low. Partial ratios are bell ratios rather than octaves
// and fifths: 2.76 and 5.40 are what a struck plate does, and they sit far
// enough from any interval that the ear refuses to hear a tune in them. They
// double here as ring-modulator ratios, where the same inharmonicity turns the
// sidebands metallic.

const D1 = 36.71;
const D2 = 73.42;
const D3 = 146.83;
const A2 = 110.0;

const BELL_2 = 2.76;
const BELL_3 = 5.4;

// ── Runtime state ───────────────────────────────────────────────────────────

/**
 * Output trim, applied on top of the user's volume.
 *
 * Set by measurement: every cue is rendered through an OfflineAudioContext and
 * levelled so that at the default volume of 0.6 the heaviest cue peaks near
 * −17.5 dBFS, the lighter ones near −22, and the hover tick near −27. Nothing
 * clips at any volume setting.
 */
const MASTER_TRIM = 1.05;

/**
 * Bus frequencies at pitch 1.0.
 *
 * These travel with the tune control rather than staying put, so the comb's
 * enclosure and the room's window keep the same relation to the material at
 * every setting. Transposing the voices alone would leave the machine sounding
 * like it had been recorded in a different box.
 */
const COMB_BASE = 0.0065;
const DAMP_BASE = 1200;
const CUT_BASE = 180;

let enabled = DEFAULT_SOUND_ENABLED;
let volume = DEFAULT_SOUND_VOLUME;

/**
 * Global frequency multiplier — the tune control.
 *
 * v3 shipped at 1.0 and read as too deep. Every frequency in the palette is
 * multiplied by this at schedule time; nothing about the *timing* moves, so the
 * clock, the step counts and the decays stay exactly where they are and only
 * the material changes.
 */
let pitch = DEFAULT_SOUND_PITCH;

const lastPlayedAt: Partial<Record<CueName, number>> = {};
const suppressedUntil: Partial<Record<CueName, number>> = {};

interface Engine {
  ctx: BaseAudioContext;
  master: GainNode;
  /** Straight through the output saturation. */
  dry: GainNode;
  /** The room: a dark filtered feedback delay. */
  space: GainNode;
  /** The mechanism: bit crusher into a short comb. */
  machine: GainNode;
  /** Frequency-dependent bus nodes, retained so the tune control can move them. */
  comb: DelayNode;
  damp: BiquadFilterNode;
  cut: BiquadFilterNode;
  noise: AudioBuffer;
}

let engine: Engine | null = null;
let engineFailed = false;

// ── Engine ──────────────────────────────────────────────────────────────────

function buildNoise(ctx: BaseAudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.0), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/**
 * A gentle saturation curve on the output.
 *
 * Two jobs. It generates harmonics from the low fundamentals, which is the only
 * reason a 41Hz step is audible at all on a laptop speaker that cannot
 * reproduce 41Hz. And it rounds transient peaks, so no cue jumps out.
 */
function saturationCurve(): Float32Array {
  const n = 1024;
  const curve = new Float32Array(n);
  const k = 2.2;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * k) / Math.tanh(k);
  }
  return curve;
}

/** Quantisation curve — the bit crusher. */
function crushCurve(bits: number): Float32Array {
  const levels = Math.pow(2, bits);
  const n = 8192;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.round(x * levels) / levels;
  }
  return curve;
}

/**
 * Build the three buses.
 *
 * Split out from `ensure()` so the offline measurement harness renders through
 * exactly this graph rather than a re-implementation of it — a levelling rig
 * that drifts from the thing it measures is worse than no rig.
 */
function buildBuses(ctx: BaseAudioContext, masterGain: number): Engine {
  const master = ctx.createGain();
  master.gain.value = masterGain;
  master.connect(ctx.destination);

  const drive = ctx.createGain();
  drive.gain.value = 3.2;
  const shaper = ctx.createWaveShaper();
  shaper.curve = saturationCurve();
  shaper.oversample = "2x";
  const trim = ctx.createGain();
  trim.gain.value = 1 / 3.2;
  drive.connect(shaper);
  shaper.connect(trim);
  trim.connect(master);

  const dry = ctx.createGain();
  dry.gain.value = 1;
  dry.connect(drive);

  // Machine bus: quantise, then run through a 6.5ms comb. The comb rings near
  // 154Hz — the hollow metallic resonance of a small enclosure.
  const machine = ctx.createGain();
  machine.gain.value = 1;
  const crusher = ctx.createWaveShaper();
  crusher.curve = crushCurve(6);
  crusher.oversample = "none";
  const comb = ctx.createDelay(0.05);
  comb.delayTime.value = COMB_BASE / pitch;
  const combFb = ctx.createGain();
  combFb.gain.value = 0.5;
  const combLp = ctx.createBiquadFilter();
  combLp.type = "lowpass";
  combLp.frequency.value = 4200;
  const machOut = ctx.createGain();
  machOut.gain.value = 0.55;
  machine.connect(crusher);
  crusher.connect(comb);
  comb.connect(combLp);
  combLp.connect(combFb);
  combFb.connect(comb);
  crusher.connect(machOut);
  combLp.connect(machOut);
  machOut.connect(drive);

  // Room bus: one short filtered feedback delay. Damped this hard it reads as a
  // large unlit space rather than as an echo, and the high-pass keeps the sub
  // content out of the tail where it would only turn to mud.
  const space = ctx.createGain();
  space.gain.value = 1;
  const delay = ctx.createDelay(0.6);
  delay.delayTime.value = 0.155;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.3;
  const damp = ctx.createBiquadFilter();
  damp.type = "lowpass";
  damp.frequency.value = DAMP_BASE * pitch;
  const cut = ctx.createBiquadFilter();
  cut.type = "highpass";
  cut.frequency.value = CUT_BASE * pitch;
  const wet = ctx.createGain();
  wet.gain.value = 0.45;
  space.connect(delay);
  delay.connect(damp);
  damp.connect(feedback);
  feedback.connect(delay);
  damp.connect(cut);
  cut.connect(wet);
  wet.connect(drive);

  return { ctx, master, dry, space, machine, comb, damp, cut, noise: buildNoise(ctx) };
}

/**
 * Create the context on first use, not at import.
 *
 * Browsers start an AudioContext suspended until a user gesture, and every cue
 * here is gesture-driven, so building it lazily means we never hold an idle
 * audio device open in a session where nothing is ever clicked.
 */
function ensure(): Engine | null {
  if (!enabled || engineFailed || typeof window === "undefined") return null;
  if (engine) {
    const ctx = engine.ctx as AudioContext;
    if (ctx.state === "suspended") void ctx.resume();
    return engine;
  }

  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) { engineFailed = true; return null; }

  try {
    engine = buildBuses(new Ctor({ latencyHint: "interactive" }), volume * MASTER_TRIM);
  } catch {
    engineFailed = true;
    return null;
  }
  return engine;
}

/**
 * Warm the audio device on the first gesture of the session.
 *
 * Without this the very first cue pays the context's start-up cost and lands
 * late enough to feel disconnected from the click that caused it.
 */
export function primeAudio(): void {
  ensure();
}

// ── Voices ──────────────────────────────────────────────────────────────────

/** Shared routing options: where a voice lands and how much of it goes where. */
interface Routed {
  pan?: number;
  /** 0–1 into the room. */
  send?: number;
  /** 0–1 into the machine bus. */
  mach?: number;
}

/**
 * Percussive envelope: near-instant attack, exponential decay.
 *
 * `exponentialRampToValueAtTime` cannot reach or start from zero, hence the
 * 0.0001 floor at both ends.
 */
function envelope(e: Engine, t0: number, peak: number, attack: number, decay: number): GainNode {
  const g = e.ctx.createGain();
  const top = Math.max(0.0002, peak);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(top, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  return g;
}

function route(e: Engine, node: AudioNode, o: Routed): void {
  const pan = e.ctx.createStereoPanner();
  pan.pan.value = o.pan ?? 0;
  node.connect(pan);
  pan.connect(e.dry);
  if (o.send) {
    const s = e.ctx.createGain();
    s.gain.value = o.send;
    pan.connect(s);
    s.connect(e.space);
  }
  if (o.mach) {
    const m = e.ctx.createGain();
    m.gain.value = o.mach;
    pan.connect(m);
    m.connect(e.machine);
  }
}

interface ToneOpts extends Routed {
  freq: number;
  to?: number;
  type?: OscillatorType;
  attack?: number;
  decay?: number;
  gain?: number;
}

function tone(e: Engine, t0: number, o: ToneOpts): void {
  const attack = o.attack ?? 0.003;
  const decay = o.decay ?? 0.22;
  const osc = e.ctx.createOscillator();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.freq * pitch, t0);
  if (o.to && o.to > 0 && o.to !== o.freq) {
    osc.frequency.exponentialRampToValueAtTime(o.to * pitch, t0 + attack + decay * 0.7);
  }
  const g = envelope(e, t0, o.gain ?? 0.06, attack, decay);
  osc.connect(g);
  route(e, g, o);
  osc.start(t0);
  osc.stop(t0 + attack + decay + 0.06);
}

interface AirOpts extends Routed {
  /** Bandpass centre at the start and end of the sweep. Equal values hold. */
  from: number;
  to: number;
  dur: number;
  gain?: number;
  q?: number;
  attack?: number;
  /** Filter vibrato rate in Hz. 0 or absent disables it. */
  vib?: number;
}

/**
 * Filtered noise — the breath, the grit and the servo.
 *
 * A wide band that sweeps is a swoosh; a narrow one that holds is a tick; a
 * narrow one that sweeps *and* wobbles is a motor. All three come from here,
 * which is why the Q range in use spans 3 to 6.
 */
function air(e: Engine, t0: number, o: AirOpts): void {
  const attack = o.attack ?? 0.02;
  const decay = Math.max(0.02, o.dur - attack);

  const src = e.ctx.createBufferSource();
  src.buffer = e.noise;
  src.loop = true;

  const from = o.from * pitch;
  const to = o.to * pitch;

  const bp = e.ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = o.q ?? 1.1;
  bp.frequency.setValueAtTime(from, t0);
  if (to !== from) {
    bp.frequency.exponentialRampToValueAtTime(Math.max(40, to), t0 + o.dur);
  }

  // Vibrato goes on the filter, never the pitch. An AudioParam sums its
  // automation with any connected signal, so the LFO rides on top of the sweep.
  if (o.vib) {
    const lfo = e.ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = o.vib;
    const depth = e.ctx.createGain();
    depth.gain.value = Math.max(from, to) * 0.05;
    lfo.connect(depth);
    depth.connect(bp.frequency);
    lfo.start(t0);
    lfo.stop(t0 + o.dur + 0.06);
  }

  const g = envelope(e, t0, o.gain ?? 0.03, attack, decay);
  src.connect(bp);
  bp.connect(g);
  route(e, g, o);

  // Start at a random offset so repeated cues never sound like the identical
  // sample being retriggered.
  src.start(t0, Math.random() * 0.5);
  src.stop(t0 + attack + decay + 0.06);
}

interface ServoOpts extends Routed {
  from: number;
  to: number;
  dur: number;
  gain: number;
  q?: number;
  attack?: number;
  vib?: number;
}

/** A resonant band that sweeps and wobbles: servo travel. */
function servo(e: Engine, t0: number, o: ServoOpts): void {
  air(e, t0, {
    from: o.from, to: o.to, dur: o.dur, gain: o.gain,
    q: o.q ?? 5, attack: o.attack ?? 0.008, vib: o.vib ?? 0,
    pan: o.pan, send: o.send, mach: o.mach,
  });
}

interface TickOpts extends Routed {
  freq: number;
  gain: number;
  q?: number;
  dur?: number;
}

/** One contact tick: a few milliseconds of band-limited noise. */
function tick(e: Engine, t0: number, o: TickOpts): void {
  air(e, t0, {
    from: o.freq, to: o.freq, dur: o.dur ?? 0.007,
    gain: o.gain, q: o.q ?? 4, attack: 0.0006,
    pan: o.pan, send: o.send, mach: o.mach,
  });
}

interface DataOpts extends TickOpts {
  count: number;
  /** Seconds between ticks. Exact — that is the effect. */
  spacing?: number;
  /** Frequency multiplier applied per tick. >1 accelerates, <1 winds down. */
  drift?: number;
  /** Gain multiplier applied per tick. */
  falloff?: number;
}

/**
 * A burst of ticks on an exact clock.
 *
 * Evenly spaced to the millisecond and stepping in pitch by a fixed ratio.
 * Nothing organic repeats this precisely, which is the whole point — and the
 * alternating pan gives the burst width without making it a stereo effect.
 */
function data(e: Engine, t0: number, o: DataOpts): void {
  const drift = o.drift ?? 1;
  const falloff = o.falloff ?? 0.72;
  const spacing = o.spacing ?? 0.02;
  for (let i = 0; i < o.count; i++) {
    tick(e, t0 + i * spacing, {
      freq: o.freq * Math.pow(drift, i),
      gain: o.gain * Math.pow(falloff, i),
      q: o.q ?? 4,
      dur: o.dur ?? 0.007,
      pan: (o.pan ?? 0) + (i % 2 ? 0.08 : -0.08),
      send: o.send,
      mach: o.mach,
    });
  }
}

interface MetalOpts extends Routed {
  freq: number;
  /** Modulator ratio. Inharmonic values are the ones that sound machine. */
  ratio: number;
  decay: number;
  gain: number;
  attack?: number;
  /** How much untouched carrier is blended back in, 0–1. */
  blend?: number;
}

/**
 * Ring modulation: carrier × modulator at an inharmonic ratio.
 *
 * The product has no fundamental at all, only sum and difference tones, which
 * is exactly why it reads as machine rather than instrument. A little dry
 * carrier is blended back so the cue still has a pitch centre to sit on.
 */
function metal(e: Engine, t0: number, o: MetalOpts): void {
  const attack = o.attack ?? 0.003;
  const decay = o.decay;

  const carrier = e.ctx.createOscillator();
  carrier.type = "sine";
  carrier.frequency.setValueAtTime(o.freq * pitch, t0);

  const modulator = e.ctx.createOscillator();
  modulator.type = "sine";
  modulator.frequency.setValueAtTime(o.freq * o.ratio * pitch, t0);

  // A gain node whose gain is driven by an oscillator *is* a ring modulator:
  // the output is the product of the two signals.
  const rm = e.ctx.createGain();
  rm.gain.value = 0;
  const depth = e.ctx.createGain();
  depth.gain.value = 1;
  modulator.connect(depth);
  depth.connect(rm.gain);
  carrier.connect(rm);

  const blend = o.blend ?? 0.35;
  const dryCarrier = e.ctx.createGain();
  dryCarrier.gain.value = blend;
  const wetRing = e.ctx.createGain();
  wetRing.gain.value = 1 - blend;
  carrier.connect(dryCarrier);
  rm.connect(wetRing);

  const g = envelope(e, t0, o.gain, attack, decay);
  dryCarrier.connect(g);
  wetRing.connect(g);
  route(e, g, o);

  carrier.start(t0);
  carrier.stop(t0 + attack + decay + 0.06);
  modulator.start(t0);
  modulator.stop(t0 + attack + decay + 0.06);
}

interface StepOpts extends Routed {
  from: number;
  to: number;
  decay: number;
  gain: number;
  steps?: number;
  type?: OscillatorType;
}

/**
 * The mass, falling on a clock.
 *
 * v2 glided this fundamental down, and a glide is a physical object settling.
 * Held steps are a value being decremented by something counting, which is the
 * most cybernetic device in the palette and the cheapest.
 */
function steppedDrop(e: Engine, t0: number, o: StepOpts): void {
  const steps = o.steps ?? 5;
  const osc = e.ctx.createOscillator();
  osc.type = o.type ?? "sine";
  // The descent finishes at 72% of the decay: the last step is held, not cut
  // off mid-fall, which is what makes it land rather than trail away.
  const span = o.decay * 0.72;
  for (let i = 0; i < steps; i++) {
    const f = o.from * Math.pow(o.to / o.from, i / (steps - 1)) * pitch;
    osc.frequency.setValueAtTime(f, t0 + span * (i / steps));
  }
  const g = envelope(e, t0, o.gain, 0.004, o.decay);
  osc.connect(g);
  route(e, g, o);
  osc.start(t0);
  osc.stop(t0 + o.decay + 0.06);
}

// ── Cues ────────────────────────────────────────────────────────────────────
//
// `scale` lets a caller duck an individual firing without touching the master
// volume.
//
// Balance note: the first cybernetic pass read as too deep. The fix was not
// transposition — pitch moves everything together, so it lightens the machine by
// making the whole thing smaller. Instead the low counted drops lost ~5dB and
// shortened (and now bottom out near 50Hz rather than 41Hz), while the tick
// bursts, servos and ring-modulated partials came up to meet them. Energy below
// 200Hz went from 57–80% to 38–53% with the character untouched. If it ever
// needs lightening again, move this balance before reaching for the pitch.

type CueFn = (e: Engine, t0: number, scale: number) => void;

const CUES: Record<CueName, CueFn> = {
  /** A sensor registering. Two clocked ticks and a trace of body, nothing else. */
  nodeHover: (e, t, s) => {
    data(e, t, { count: 2, spacing: 0.018, freq: 2600, gain: 0.115 * s, q: 5, dur: 0.006, drift: 0.88, mach: 0.6 });
    metal(e, t, { freq: 330, ratio: BELL_2, decay: 0.045, gain: 0.028 * s, mach: 0.5 });
  },

  /** Latching on: a three-tick burst, a counted drop, a ring-modulated body. */
  nodeSelect: (e, t, s) => {
    data(e, t, { count: 3, spacing: 0.022, freq: 3000, gain: 0.135 * s, q: 4, dur: 0.007, drift: 0.86, mach: 0.7 });
    steppedDrop(e, t, { from: 132, to: 74, steps: 4, decay: 0.22, gain: 0.045 * s });
    metal(e, t + 0.01, { freq: 220, ratio: BELL_2, decay: 0.3, gain: 0.088 * s, pan: -0.08, send: 0.26, mach: 0.55 });
    servo(e, t, { from: 900, to: 3200, dur: 0.1, gain: 0.04 * s, q: 6, vib: 40, pan: 0.1, mach: 0.4 });
  },

  /** Releasing. The same machine, running down instead of up. */
  nodeDeselect: (e, t, s) => {
    data(e, t, { count: 2, spacing: 0.024, freq: 1900, gain: 0.085 * s, q: 4, dur: 0.007, drift: 0.8, mach: 0.6 });
    steppedDrop(e, t, { from: 98, to: 56, steps: 3, decay: 0.18, gain: 0.03 * s });
    metal(e, t + 0.008, { freq: 165, ratio: BELL_2, decay: 0.24, gain: 0.06 * s, pan: 0.08, send: 0.2, mach: 0.5 });
    servo(e, t, { from: 2400, to: 700, dur: 0.12, gain: 0.032 * s, q: 5 });
  },

  /**
   * The map coming up: a servo travelling, a counted drop, and five ticks
   * accelerating in pitch underneath — a system enumerating what it found.
   */
  constellationOpen: (e, t, s) => {
    steppedDrop(e, t, { from: 112, to: 52, steps: 6, decay: 0.4, gain: 0.036 * s });
    servo(e, t, { from: 380, to: 3000, dur: 0.5, gain: 0.075 * s, q: 5.5, vib: 26, attack: 0.14, send: 0.45, mach: 0.5 });
    data(e, t + 0.06, { count: 5, spacing: 0.036, freq: 2200, gain: 0.082 * s, q: 5, dur: 0.006, drift: 1.09, falloff: 0.86, mach: 0.8 });
    metal(e, t + 0.04, { freq: D3, ratio: BELL_2, decay: 0.66, gain: 0.062 * s, pan: -0.12, send: 0.45, mach: 0.4 });
    tone(e, t, { freq: D2, type: "triangle", attack: 0.11, decay: 0.46, gain: 0.011 * s });
  },

  /** The map going down. Servo reverses, ticks decelerate, the drop shuts. */
  constellationClose: (e, t, s) => {
    servo(e, t, { from: 2800, to: 420, dur: 0.28, gain: 0.07 * s, q: 5, vib: 18, attack: 0.01, send: 0.28, mach: 0.5 });
    data(e, t, { count: 3, spacing: 0.03, freq: 1800, gain: 0.095 * s, q: 4, dur: 0.006, drift: 0.82, mach: 0.7 });
    steppedDrop(e, t + 0.01, { from: 96, to: 50, steps: 4, decay: 0.22, gain: 0.034 * s });
    metal(e, t + 0.02, { freq: A2 * 1.5, ratio: BELL_2, decay: 0.28, gain: 0.058 * s, send: 0.22, mach: 0.4 });
  },

  /**
   * Committing to a domain — the one cue allowed real weight.
   *
   * Four fast ticks, a six-step fall from 146Hz to 52Hz, two ring-modulated
   * partials, and then a single hard tick at 0.30s: the mechanism engaging
   * after the movement has finished. That late lock is what makes it read as
   * one machine completing an operation rather than as a sound effect.
   */
  domainEnter: (e, t, s) => {
    data(e, t, { count: 4, spacing: 0.015, freq: 3600, gain: 0.12 * s, q: 3.5, dur: 0.007, drift: 0.93, mach: 0.8 });
    steppedDrop(e, t, { from: 146, to: 52, steps: 6, decay: 0.54, gain: 0.062 * s });
    tone(e, t, { freq: D1, type: "triangle", attack: 0.02, decay: 0.6, gain: 0.02 * s });
    servo(e, t, { from: 430, to: 3600, dur: 0.4, gain: 0.06 * s, q: 5, vib: 30, attack: 0.09, send: 0.5, mach: 0.55 });
    metal(e, t + 0.012, { freq: D3, ratio: BELL_2, decay: 0.78, gain: 0.075 * s, pan: -0.16, send: 0.5, mach: 0.45 });
    metal(e, t + 0.04, { freq: D3, ratio: BELL_3, decay: 0.54, gain: 0.034 * s, pan: 0.16, send: 0.55, mach: 0.5 });
    tick(e, t + 0.3, { freq: 1700, gain: 0.075 * s, q: 3, dur: 0.01, mach: 0.7 });
    metal(e, t + 0.302, { freq: A2 * 1.5, ratio: 1.41, decay: 0.3, gain: 0.038 * s, send: 0.4, mach: 0.5 });
  },

  /** The same machine, one gear down. */
  domainShift: (e, t, s) => {
    data(e, t, { count: 2, spacing: 0.02, freq: 2800, gain: 0.085 * s, q: 4, dur: 0.006, drift: 1.1, mach: 0.7 });
    steppedDrop(e, t, { from: 108, to: 70, steps: 3, decay: 0.18, gain: 0.03 * s });
    servo(e, t, { from: 880, to: 2900, dur: 0.18, gain: 0.038 * s, q: 5, vib: 24, attack: 0.04, send: 0.3, mach: 0.5 });
    metal(e, t + 0.01, { freq: 220, ratio: BELL_2, decay: 0.34, gain: 0.052 * s, pan: 0.1, send: 0.32, mach: 0.4 });
  },
};

// ── Public API ──────────────────────────────────────────────────────────────

export function playCue(name: CueName, opts?: { scale?: number; force?: boolean }): void {
  if (!enabled && !opts?.force) return;

  const now = typeof performance !== "undefined" ? performance.now() : Date.now();

  if (!opts?.force) {
    const until = suppressedUntil[name] ?? 0;
    if (now < until) return;
    const last = lastPlayedAt[name] ?? -Infinity;
    if (now - last < COOLDOWN_MS[name]) return;
  }
  lastPlayedAt[name] = now;

  const e = ensure();
  if (!e) return;

  const cue = CUES[name];
  if (!cue) return;

  try {
    // A hair of lead time: scheduling exactly at currentTime occasionally lands
    // in a block that has already been rendered, which clips the attack.
    cue(e, e.ctx.currentTime + 0.005, opts?.scale ?? 1);
  } catch {
    // A cue is never worth breaking an interaction over.
  }
}

/**
 * Silence one cue for a moment.
 *
 * Used where two cues would otherwise collide: clicking a branch label closes
 * the constellation *and* navigates, and the close cue underneath the enter cue
 * just muddies it.
 */
export function suppressCue(name: CueName, ms: number): void {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  suppressedUntil[name] = now + ms;
}

export function setSoundEnabled(value: boolean): void {
  enabled = Boolean(value);
  if (!engine) return;
  const ctx = engine.ctx as AudioContext;
  if (!enabled) {
    // Leave the graph intact — re-suspending is instant and rebuilding is not.
    void ctx.suspend();
  } else if (ctx.state === "suspended") {
    void ctx.resume();
  }
}

export function setSoundVolume(value: number): void {
  const v = Number(value);
  volume = Math.max(0, Math.min(1, Number.isFinite(v) ? v : DEFAULT_SOUND_VOLUME));
  if (engine) {
    engine.master.gain.setTargetAtTime(volume * MASTER_TRIM, engine.ctx.currentTime, 0.01);
  }
}

/**
 * Transpose the whole palette.
 *
 * `value` is a frequency multiplier: 1.0 is the designed baseline, 2.0 is an
 * octave up. The editor presents it in semitones because that is the scale the
 * ear actually hears it on. Bus frequencies are ramped rather than set, so
 * dragging the slider while a cue is ringing does not click.
 */
export function setSoundPitch(value: number): void {
  const v = Number(value);
  pitch = Math.max(0.5, Math.min(2.2, Number.isFinite(v) && v > 0 ? v : DEFAULT_SOUND_PITCH));
  if (!engine) return;
  const now = engine.ctx.currentTime;
  engine.comb.delayTime.setTargetAtTime(COMB_BASE / pitch, now, 0.01);
  engine.damp.frequency.setTargetAtTime(Math.min(14000, DAMP_BASE * pitch), now, 0.01);
  engine.cut.frequency.setTargetAtTime(CUT_BASE * pitch, now, 0.01);
}

export function getSoundState(): { enabled: boolean; volume: number; pitch: number } {
  return { enabled, volume, pitch };
}
