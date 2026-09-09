/**
 * The echo guard: what the microphone does while Akira herself is audible.
 *
 * The bug these cover is Akira interrupting herself. She plays through the
 * speakers the microphone is listening to, so without a guard her own voice is
 * uploaded as user audio, the agent's turn detector reads it as someone talking
 * over her, and she cuts her own sentence off. Nobody in the room said anything.
 *
 * Every window here is a statement about time, so the clock is injected rather
 * than slept through.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { AkiraMic } from "../AkiraMic";

const SAMPLE_RATE = 16_000;
const FRAME_MS = 10;
const FRAME_SAMPLES = (SAMPLE_RATE / 1_000) * FRAME_MS;

interface Rig {
  mic: AkiraMic;
  /** Every chunk that left for the agent, decoded. */
  sent: Int16Array[];
  /** Frames offered to the wake-word detector. */
  heard: number;
  bargeIns: number;
  advance: (ms: number) => void;
  /** Play `ms` of audio at `amplitude` into the microphone, moving the clock. */
  feed: (amplitude: number, ms: number) => void;
  reset: () => void;
}

function rig(options: { bargeInEnabled?: boolean } = {}): Rig {
  let clock = 1_000_000;
  const state = { sent: [] as Int16Array[], heard: 0, bargeIns: 0 };

  const mic = new AkiraMic({
    bargeInEnabled: options.bargeInEnabled,
    now: () => clock,
    onChunk: base64 => {
      const bytes = Buffer.from(base64, "base64");
      state.sent.push(new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2));
    },
    onPcm: () => { state.heard += 1; },
    onBargeIn: () => { state.bargeIns += 1; },
  });

  // The one piece of the real thing a unit test cannot have. A 16kHz context
  // makes the resampler a pass-through, so what goes in is what is measured.
  (mic as unknown as { context: { sampleRate: number } }).context = { sampleRate: SAMPLE_RATE };

  const consume = (frame: Float32Array) =>
    (mic as unknown as { consume: (input: Float32Array) => void }).consume(frame);

  const self = {
    mic,
    get sent() { return state.sent; },
    get heard() { return state.heard; },
    get bargeIns() { return state.bargeIns; },
    advance: (ms: number) => { clock += ms; },
    feed: (amplitude: number, ms: number) => {
      for (let elapsed = 0; elapsed < ms; elapsed += FRAME_MS) {
        const frame = new Float32Array(FRAME_SAMPLES);
        // Alternating, so the RMS of the frame is exactly the amplitude.
        for (let index = 0; index < FRAME_SAMPLES; index += 1) {
          frame[index] = index % 2 === 0 ? amplitude : -amplitude;
        }
        consume(frame);
        clock += FRAME_MS;
      }
    },
    reset: () => { state.sent.length = 0; state.heard = 0; state.bargeIns = 0; },
  };
  return self as unknown as Rig;
}

const samples = (chunks: Int16Array[]) => chunks.reduce((total, chunk) => total + chunk.length, 0);
const peak = (chunks: Int16Array[]) =>
  chunks.reduce((loudest, chunk) => {
    for (const sample of chunk) loudest = Math.max(loudest, Math.abs(sample));
    return loudest;
  }, 0);

test("audio reaches the agent unchanged when Akira is not speaking", () => {
  const harness = rig();
  harness.mic.beginStreaming(false);
  harness.feed(0.2, 500);

  assert.ok(samples(harness.sent) >= SAMPLE_RATE / 4, "a 250ms chunk should have gone upstream");
  assert.ok(peak(harness.sent) > 4_000, "the user's voice should not be attenuated");
});

test("her own voice is uploaded as silence, not as the user talking", () => {
  const harness = rig();
  harness.mic.beginStreaming(false);
  harness.mic.setSelfSpeaking(true);
  harness.feed(0.35, 1_000);

  // The stream keeps its cadence — a gap would leave the agent's turn detector
  // guessing — but carries nothing.
  assert.ok(samples(harness.sent) >= SAMPLE_RATE / 4, "the stream should keep flowing");
  assert.equal(peak(harness.sent), 0, "nothing Akira said should have gone upstream");
});

test("her own voice is not offered to the wake word either", () => {
  const harness = rig();
  harness.mic.setSelfSpeaking(true);
  harness.feed(0.35, 500);
  assert.equal(harness.heard, 0, "she should not be able to summon herself by name");

  harness.mic.setSelfSpeaking(false);
  harness.advance(400); // past the echo tail
  harness.feed(0.2, 100);
  assert.ok(harness.heard > 0, "the wake word should hear the room again afterwards");
});

test("the echo tail outlasts the last scheduled sample", () => {
  const harness = rig();
  harness.mic.beginStreaming(false);
  harness.mic.setSelfSpeaking(true);
  harness.feed(0.35, 500);
  harness.mic.setSelfSpeaking(false);
  harness.reset();

  // The room is still ringing and the output device has its own latency, so the
  // moment scheduling stops is not the moment the microphone stops hearing her.
  harness.feed(0.35, 200);
  assert.equal(peak(harness.sent), 0, "the tail of her sentence should still be muted");

  harness.reset();
  harness.advance(400);
  harness.feed(0.2, 300);
  assert.ok(peak(harness.sent) > 4_000, "the user should be audible once the room is quiet");
});

test("the pre-roll never replays Akira into her own ear", () => {
  const harness = rig();
  // A spoken focus warning, with the conversation opening immediately after —
  // which is exactly what `announce` then `activate` does.
  harness.feed(0.2, 800);
  harness.mic.setSelfSpeaking(true);
  harness.feed(0.9, 700);
  harness.mic.setSelfSpeaking(false);
  harness.reset();

  harness.mic.beginStreaming(true, 1_500);
  assert.equal(samples(harness.sent), 0, "opening a conversation on her own tail should send nothing");
});

test("the pre-roll is clamped to what was captured after she finished", () => {
  const harness = rig();
  harness.feed(0.2, 800);
  harness.mic.setSelfSpeaking(true);
  harness.feed(0.9, 700);
  harness.mic.setSelfSpeaking(false);
  harness.feed(0.2, 800); // the user, talking once she has stopped
  harness.reset();

  harness.mic.beginStreaming(true, 1_500);
  // 800ms since she finished, less the 320ms tail.
  assert.equal(samples(harness.sent), Math.floor((480 / 1_000) * SAMPLE_RATE));
  assert.ok(peak(harness.sent) < 10_000, "none of her 0.9 amplitude should be in there");
});

test("sustained speech over her is a barge-in", () => {
  const harness = rig();
  harness.mic.beginStreaming(false);
  harness.mic.setSelfSpeaking(true);
  harness.feed(0.05, 450);            // calibration: this is the echo, by definition
  assert.equal(harness.bargeIns, 0, "the opening of her sentence can never be an interruption");

  harness.feed(0.4, 400);
  assert.equal(harness.bargeIns, 1, "the user talking over her should be recognised once");
  assert.equal(harness.mic.guarded, false, "the guard should drop the moment it fires");
  assert.ok(peak(harness.sent) > 4_000, "their opening syllables should have been handed back");
});

test("her own echo is never mistaken for one, however long she talks", () => {
  const harness = rig();
  harness.mic.beginStreaming(false);
  harness.mic.setSelfSpeaking(true);
  harness.feed(0.06, 450);
  harness.feed(0.06, 6_000);          // a long answer, all of it leaking into the mic
  assert.equal(harness.bargeIns, 0);
  assert.equal(harness.mic.guarded, true);
  assert.equal(peak(harness.sent), 0);
});

test("a single loud syllable bleeding through is not an interruption", () => {
  const harness = rig();
  harness.mic.beginStreaming(false);
  harness.mic.setSelfSpeaking(true);
  harness.feed(0.05, 450);
  for (let burst = 0; burst < 12; burst += 1) {
    harness.feed(0.4, 80);            // short of the sustain threshold
    harness.feed(0.01, 200);
  }
  assert.equal(harness.bargeIns, 0, "decay should outrun accumulation across a sentence");
});

test("switching barge-in off means she is never interrupted", () => {
  const harness = rig({ bargeInEnabled: false });
  harness.mic.beginStreaming(false);
  harness.mic.setSelfSpeaking(true);
  harness.feed(0.05, 450);
  harness.feed(0.5, 2_000);

  assert.equal(harness.bargeIns, 0);
  assert.equal(harness.mic.guarded, true, "the guard should hold until she finishes");
  assert.equal(peak(harness.sent), 0);

  harness.mic.setBargeInEnabled(true);
  harness.feed(0.5, 400);
  assert.equal(harness.bargeIns, 1, "and the setting should take effect without a restart");
});

test("headphones leave interrupting as easy as it should be", () => {
  const harness = rig();
  harness.mic.beginStreaming(false);
  harness.mic.setSelfSpeaking(true);
  // Nothing leaks back, so the threshold falls to the floor rather than sitting
  // at whatever the speakers were doing.
  harness.feed(0.001, 450);
  harness.feed(0.05, 300);
  assert.equal(harness.bargeIns, 1, "a quietly spoken interruption should still land");
});
