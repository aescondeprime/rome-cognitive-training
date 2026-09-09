/**
 * The wake alarm — the one sound in ROME that is not allowed to be ignored.
 *
 * Same procedural approach as `sound.ts`: synthesised at play time, no audio
 * file, tuned by editing numbers. Everything else about it is the opposite of a
 * UI cue. A cue is a short polite acknowledgement that respects the sound
 * toggle and gets out of the way. This is a siren that starts five minutes
 * before the end of a sleep period at the edge of audibility, climbs on a
 * constant-decibel slope to whatever peak the editor is set to, and then keeps
 * going until a key is pressed.
 *
 * ── Why it ignores the sound setting ────────────────────────────────────────
 *
 * `setSoundEnabled(false)` silences hover chimes. An alarm that a preference
 * set weeks ago can silence is an alarm that fails exactly once, on the morning
 * it mattered, with no warning that it was going to. If someone does not want
 * to be woken they do not set a sleep period. The **peak** is adjustable, and
 * its floor is 45 dB rather than zero, for the same reason.
 *
 * ── Four voices ─────────────────────────────────────────────────────────────
 *
 * One siren heard every morning stops being heard. Each voice is one function
 * scheduling one cycle into a shared bus, so adding a fifth is one entry in
 * `VOICES` and one in `ALARM_VOICES`. They differ in *kind*, not in decoration:
 * a stab, a pulse, a sweep and a bell wake different people, and the same
 * person differently on different mornings.
 */

import {
  DEFAULT_ALARM_VOICE, alarmGain, dbToGain, normalizeVoice, type AlarmVoice,
} from "@shared/sleepClock";

/** How far ahead the scheduler runs. Slack for a busy main thread. */
const LOOKAHEAD_MS = 900;
const TICK_MS = 200;
/** A preview that outlives the finger on the button is a preview nobody trusts. */
const PREVIEW_MS = 6_000;

type ProgressFn = (now: number) => number;

let context: AudioContext | null = null;
let master: GainNode | null = null;
let bus: AudioNode | null = null;
let timer: number | null = null;
let progressOf: ProgressFn | null = null;
let playingVoice: AlarmVoice = DEFAULT_ALARM_VOICE;
let playingPeak = 1;
let cycleLengthMs = 1_400;
let nextCycleAt = 0;
let ringing = false;
let previewing = false;
let previewTimer: number | null = null;

/** The stored settings, applied by `applyLayout` and read when the alarm starts. */
let configuredVoice: AlarmVoice = DEFAULT_ALARM_VOICE;
let configuredPeak = 1;

export function setAlarmVoice(voice: unknown): void {
  configuredVoice = normalizeVoice(voice);
}

export function setAlarmPeakDb(db: number): void {
  configuredPeak = dbToGain(db);
}

/**
 * Is the alarm sounding right now?
 *
 * Read by the Constellation overlay, which owns Tab. While this is true, Tab
 * silences the alarm and does not open the map — the one key the user has been
 * told to press cannot also be the key that navigates.
 *
 * A preview deliberately does **not** count: Tab in the editor should still
 * behave like Tab.
 */
export function alarmRinging(): boolean {
  return ringing;
}

export function alarmPreviewing(): boolean {
  return previewing;
}

// ── The bus ─────────────────────────────────────────────────────────────────

/**
 * Soft clipping.
 *
 * The alarm's peak is deliberately at the top of the range, and three layers
 * summing there would otherwise clip against the hardware — which is loud, but
 * as a crackle rather than as a siren. A tanh curve compresses the peaks into
 * saturation instead: it stays loud, it gains harmonics as it gets louder, and
 * the harmonics make it *more* piercing rather than broken.
 */
function makeClipper(target: AudioContext): WaveShaperNode {
  const shaper = target.createWaveShaper();
  const curve = new Float32Array(1_024);
  for (let index = 0; index < curve.length; index += 1) {
    const x = (index / (curve.length - 1)) * 2 - 1;
    curve[index] = Math.tanh(x * 2.2) / Math.tanh(2.2);
  }
  shaper.curve = curve;
  shaper.oversample = "2x";
  return shaper;
}

// ── Voice: klaxon ───────────────────────────────────────────────────────────
//
// Machine, not bell. Ring modulation at an inharmonic ratio removes the
// fundamental and leaves sum and difference tones, so the sound has no *note* —
// that is what reads as a device rather than an instrument. The two whoops are
// detuned seven cents against each other so they beat, which is unpleasant in
// exactly the way an alarm should be and survives being heard through a pillow.

function whoop(target: AudioContext, at: number, ratio: number, duration: number): void {
  const carrier = target.createOscillator();
  carrier.type = "sawtooth";
  carrier.frequency.setValueAtTime(220 * ratio, at);
  carrier.frequency.exponentialRampToValueAtTime(560 * ratio, at + duration * 0.75);

  // Deliberately not a whole-number multiple of the carrier: a 3:2 modulator
  // would just sound like a chord.
  const modulator = target.createOscillator();
  modulator.type = "sine";
  modulator.frequency.setValueAtTime(157 * ratio, at);

  const ring = target.createGain();
  ring.gain.setValueAtTime(0, at);
  const modDepth = target.createGain();
  modDepth.gain.setValueAtTime(1, at);
  modulator.connect(modDepth).connect(ring.gain);

  const band = target.createBiquadFilter();
  band.type = "bandpass";
  band.Q.setValueAtTime(4.5, at);
  band.frequency.setValueAtTime(420, at);
  band.frequency.exponentialRampToValueAtTime(2_400, at + duration * 0.8);

  const envelope = target.createGain();
  envelope.gain.setValueAtTime(0.0001, at);
  envelope.gain.exponentialRampToValueAtTime(0.5, at + 0.05);
  envelope.gain.setValueAtTime(0.5, at + duration * 0.7);
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);

  carrier.connect(ring).connect(band).connect(envelope).connect(bus!);
  carrier.start(at); carrier.stop(at + duration + 0.05);
  modulator.start(at); modulator.stop(at + duration + 0.05);
}

/** The stepped sub — four held pitches, an exact clock, no glide. */
function steppedSub(target: AudioContext, at: number): void {
  const osc = target.createOscillator();
  osc.type = "square";
  [58, 49, 62, 44].forEach((frequency, index) => osc.frequency.setValueAtTime(frequency, at + index * 0.11));

  const low = target.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.setValueAtTime(190, at);

  const envelope = target.createGain();
  envelope.gain.setValueAtTime(0.0001, at);
  envelope.gain.exponentialRampToValueAtTime(0.42, at + 0.02);
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.52);

  osc.connect(low).connect(envelope).connect(bus!);
  osc.start(at); osc.stop(at + 0.6);
}

/** Eight ticks, 38ms apart, the pitch stepping by a fixed ratio. Nothing organic repeats that precisely. */
function dataBurst(target: AudioContext, at: number): void {
  for (let index = 0; index < 8; index += 1) {
    const when = at + index * 0.038;
    const osc = target.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(1_180 * Math.pow(1.12, index), when);
    const envelope = target.createGain();
    envelope.gain.setValueAtTime(0.0001, when);
    envelope.gain.exponentialRampToValueAtTime(0.2, when + 0.004);
    envelope.gain.exponentialRampToValueAtTime(0.0001, when + 0.03);
    osc.connect(envelope).connect(bus!);
    osc.start(when); osc.stop(when + 0.05);
  }
}

function klaxon(target: AudioContext, at: number): void {
  whoop(target, at, 1, 0.42);
  whoop(target, at + 0.46, 1.0072, 0.42);
  steppedSub(target, at);
  dataBurst(target, at + 0.95);
}

// ── Voice: pulsar ───────────────────────────────────────────────────────────
//
// Sharp rather than heavy. Six square stabs climbing a fixed ratio, each short
// enough to be a click with a pitch. The gaps are the point: the ear cannot
// habituate to something that keeps stopping.

function pulsar(target: AudioContext, at: number): void {
  for (let index = 0; index < 6; index += 1) {
    const when = at + index * 0.115;
    const osc = target.createOscillator();
    osc.type = "square";
    const base = 880 * Math.pow(1.09, index);
    osc.frequency.setValueAtTime(base, when);
    // A tiny upward chirp inside each stab. Without it the pulse reads as a
    // microwave finishing rather than as something that wants you awake.
    osc.frequency.exponentialRampToValueAtTime(base * 1.06, when + 0.05);

    const band = target.createBiquadFilter();
    band.type = "bandpass";
    band.Q.setValueAtTime(9, when);
    band.frequency.setValueAtTime(base * 2, when);

    const envelope = target.createGain();
    envelope.gain.setValueAtTime(0.0001, when);
    envelope.gain.exponentialRampToValueAtTime(0.55, when + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.0001, when + 0.075);

    osc.connect(band).connect(envelope).connect(bus!);
    osc.start(when); osc.stop(when + 0.1);
  }
  // One low thud under the last stab, so the pattern has a floor to land on.
  const thud = target.createOscillator();
  thud.type = "sine";
  thud.frequency.setValueAtTime(72, at + 0.575);
  thud.frequency.exponentialRampToValueAtTime(46, at + 0.72);
  const envelope = target.createGain();
  envelope.gain.setValueAtTime(0.0001, at + 0.575);
  envelope.gain.exponentialRampToValueAtTime(0.4, at + 0.59);
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.78);
  thud.connect(envelope).connect(bus!);
  thud.start(at + 0.575); thud.stop(at + 0.8);
}

// ── Voice: siren ────────────────────────────────────────────────────────────
//
// Fills the room instead of stabbing it. A sawtooth through a resonant lowpass
// sweeping up and back down, which is the air-raid gesture — but the resonance
// is high enough that the filter itself whistles, and that is what keeps it on
// this side of nostalgic.

function siren(target: AudioContext, at: number): void {
  const duration = 2.0;
  const osc = target.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(150, at);
  osc.frequency.exponentialRampToValueAtTime(300, at + duration * 0.5);
  osc.frequency.exponentialRampToValueAtTime(150, at + duration);

  const resonant = target.createBiquadFilter();
  resonant.type = "lowpass";
  resonant.Q.setValueAtTime(14, at);
  resonant.frequency.setValueAtTime(320, at);
  resonant.frequency.exponentialRampToValueAtTime(3_200, at + duration * 0.5);
  resonant.frequency.exponentialRampToValueAtTime(320, at + duration);

  // A fifth above and slightly quieter, so the sweep has an interval inside it
  // rather than being one line moving.
  const upper = target.createOscillator();
  upper.type = "sawtooth";
  upper.frequency.setValueAtTime(226, at);
  upper.frequency.exponentialRampToValueAtTime(452, at + duration * 0.5);
  upper.frequency.exponentialRampToValueAtTime(226, at + duration);
  const upperGain = target.createGain();
  upperGain.gain.setValueAtTime(0.35, at);

  const envelope = target.createGain();
  envelope.gain.setValueAtTime(0.0001, at);
  envelope.gain.exponentialRampToValueAtTime(0.4, at + 0.18);
  envelope.gain.setValueAtTime(0.4, at + duration - 0.25);
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);

  osc.connect(resonant);
  upper.connect(upperGain).connect(resonant);
  resonant.connect(envelope).connect(bus!);
  osc.start(at); osc.stop(at + duration + 0.05);
  upper.start(at); upper.stop(at + duration + 0.05);
}

// ── Voice: chime ────────────────────────────────────────────────────────────
//
// The one that will not startle you. Still ring-modulated, so it belongs to the
// same family rather than sounding like a different app — but the partials fall
// instead of rising and the tails overlap, which is what makes a sound read as
// an invitation rather than a demand.

function chime(target: AudioContext, at: number): void {
  [784, 588, 440].forEach((frequency, index) => {
    const when = at + index * 0.34;
    const carrier = target.createOscillator();
    carrier.type = "sine";
    carrier.frequency.setValueAtTime(frequency, when);

    // Bell ratio: inharmonic enough to be metal, close enough to be pleasant.
    const modulator = target.createOscillator();
    modulator.type = "sine";
    modulator.frequency.setValueAtTime(frequency * 1.41, when);
    const ring = target.createGain();
    ring.gain.setValueAtTime(0, when);
    const depth = target.createGain();
    depth.gain.setValueAtTime(0.75, when);
    modulator.connect(depth).connect(ring.gain);

    // A little of the plain carrier alongside the ring, so the bell keeps a
    // pitch. Pure ring modulation has none, which is right for the klaxon and
    // wrong for the one sound here meant to be agreeable.
    const body = target.createGain();
    body.gain.setValueAtTime(0.35, when);

    const envelope = target.createGain();
    envelope.gain.setValueAtTime(0.0001, when);
    envelope.gain.exponentialRampToValueAtTime(0.5, when + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, when + 1.25);

    carrier.connect(ring).connect(envelope);
    carrier.connect(body).connect(envelope);
    envelope.connect(bus!);
    carrier.start(when); carrier.stop(when + 1.3);
    modulator.start(when); modulator.stop(when + 1.3);
  });
}

const VOICES: Record<AlarmVoice, { cycleMs: number; play: (target: AudioContext, at: number) => void }> = {
  klaxon: { cycleMs: 1_400, play: klaxon },
  pulsar: { cycleMs: 900,   play: pulsar },
  siren:  { cycleMs: 2_200, play: siren },
  chime:  { cycleMs: 2_000, play: chime },
};

// ── The engine ──────────────────────────────────────────────────────────────

/**
 * Keep the siren fed, and keep it at the right volume.
 *
 * Loudness is re-read from the wall clock on every cycle rather than ramped
 * once at the start. A five-minute `linearRampToValueAtTime` would be a promise
 * made by a suspended audio context and a sleeping laptop, and the two of them
 * do not keep it; recomputing from `Date.now()` means a machine that slept
 * through four of the five minutes wakes up at the loudness it should have
 * reached.
 */
function pump(): void {
  const target = context;
  if (!target || !master || !progressOf) return;
  if (target.state === "suspended") void target.resume().catch(() => undefined);

  master.gain.setTargetAtTime(alarmGain(progressOf(Date.now()), playingPeak), target.currentTime, 0.4);

  const voice = VOICES[playingVoice] ?? VOICES.klaxon;
  const horizon = target.currentTime + LOOKAHEAD_MS / 1_000;
  if (nextCycleAt < target.currentTime) nextCycleAt = target.currentTime + 0.05;
  while (nextCycleAt < horizon) {
    voice.play(target, nextCycleAt);
    nextCycleAt += cycleLengthMs / 1_000;
  }
}

function open(voice: AlarmVoice, peak: number, progress: ProgressFn): boolean {
  try {
    const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctor) return false;
    playingVoice = voice;
    playingPeak = peak;
    cycleLengthMs = (VOICES[voice] ?? VOICES.klaxon).cycleMs;
    progressOf = progress;
    context = new Ctor({ latencyHint: "interactive" });
    master = context.createGain();
    master.gain.setValueAtTime(alarmGain(progress(Date.now()), peak), context.currentTime);
    master.connect(makeClipper(context)).connect(context.destination);
    bus = master;
    nextCycleAt = context.currentTime + 0.05;
    void context.resume().catch(() => undefined);
    pump();
    timer = window.setInterval(pump, TICK_MS);
    return true;
  } catch {
    return false;
  }
}

function close(): void {
  progressOf = null;
  if (timer !== null) window.clearInterval(timer);
  timer = null;
  const target = context;
  const gain = master;
  context = null;
  master = null;
  bus = null;
  if (gain && target) {
    // A 60ms fade rather than a cut: stopping a saturated siren instantly
    // leaves a click loud enough to be the last thing you hear.
    try {
      gain.gain.cancelScheduledValues(target.currentTime);
      gain.gain.setValueAtTime(gain.gain.value, target.currentTime);
      gain.gain.linearRampToValueAtTime(0.0001, target.currentTime + 0.06);
    } catch { /* the context is already gone */ }
  }
  if (target) window.setTimeout(() => { void target.close().catch(() => undefined); }, 120);
}

/**
 * Start ringing, and keep ringing.
 *
 * `progress` is asked for the current position in the ramp rather than given
 * one, so the alarm has no opinion about when the period ends and cannot drift
 * away from the clock that does.
 */
export function startWakeAlarm(progress: ProgressFn): void {
  if (ringing) { progressOf = progress; return; }
  // A real alarm always wins over a preview somebody left running.
  stopAlarmPreview();
  ringing = true;
  // No audio device, or a context the browser refused to create. The visual
  // half of waking up still happens; there is nothing useful to throw at.
  if (!open(configuredVoice, configuredPeak, progress)) stopWakeAlarm();
}

export function stopWakeAlarm(): void {
  if (!ringing) return;
  ringing = false;
  close();
}

/**
 * The editor's test button.
 *
 * Plays at the chosen peak with no ramp, because the question it answers is
 * "is this loud enough to wake me" and not "does the climb feel right" — the
 * climb is five minutes long and nobody auditions it. It stops itself after six
 * seconds, so a test left running is never mistaken for the thing it is testing.
 */
export function previewAlarm(voice: AlarmVoice, db: number): void {
  if (ringing) return;
  stopAlarmPreview();
  previewing = true;
  if (!open(normalizeVoice(voice), dbToGain(db), () => 1)) { previewing = false; return; }
  previewTimer = window.setTimeout(stopAlarmPreview, PREVIEW_MS);
}

export function stopAlarmPreview(): void {
  if (previewTimer !== null) window.clearTimeout(previewTimer);
  previewTimer = null;
  if (!previewing) return;
  previewing = false;
  close();
}
