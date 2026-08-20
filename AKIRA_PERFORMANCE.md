# Akira V3 performance notes

Target hardware is a 2022 MacBook Air, Apple M2, 8 GB unified memory. V3 runs
far lighter than V2, which kept a Python runtime, a Whisper model, and a
separate wake engine resident.

## What runs locally

| Component | Cost |
|---|---|
| Microphone capture + resample | One `AudioWorklet`, negligible |
| Wake word (3 ONNX models via wasm) | ~10 MB resident, low single-digit % CPU |
| Playback scheduling | Web Audio, negligible |
| Everything else | Remote |

Nothing large is packaged into the DMG. The wake models live in
`client/public/akira/` and total a few megabytes.

**V2 comparison:** a managed Python 3.11 environment, `faster-whisper` holding a
speech model warm, and a Sherpa listener — hundreds of megabytes, all of it now
gone.

## Latency

The number that matters is time from you finishing a sentence to Akira starting
to speak.

| | V2 | V3 |
|---|---|---|
| Silence detection | ~950 ms | server-side VAD |
| Transcription | batch, after the utterance | streaming |
| Model response | awaited to completion | streamed |
| Speech synthesis | started after the full response | streamed |
| **Time to first audio** | **6–15 s** | **target ≤ 800 ms** |

V2's stages were strictly serial — nothing overlapped, so the costs summed. V3
overlaps all of them across one socket, which is the entire reason the
conversation feels continuous.

Local contributions are small: `eleven_flash_v2_5` is documented at ~75 ms, and
playback schedules ~12 ms ahead rather than waiting for a complete buffer. The
remainder is network and model latency.

**Starting a conversation is instant**, because the microphone is already open.
V2 spent hundreds of milliseconds acquiring the device *after* the wake word,
which is where the lost syllables came from.

## Memory behaviour

The renderer holds a fixed 3-second Int16 ring buffer (96 KB) plus bounded
transcript and activity lists. Audio source nodes are removed as they finish and
all queued nodes stop on barge-in or standby.

The main process holds the WebSocket, settings, and the cached greeting clip —
a single short PCM file, synthesised once per voice.

## Wake word accuracy

A self-trained openWakeWord model is a real trade-off, and its metrics are
printed at the end of training. A typical first run lands near 0.69 recall and
~1.8 false positives per hour: it misses roughly three attempts in ten and fires
spuriously once or twice an hour.

The strictness slider moves along that curve. Because conversations bill per
minute, the false-positive side has a direct cost, which is what the idle
timeout is for — it turns a spurious trigger into a 20-second non-event.

More training examples improve both numbers. Retraining replaces one file.

## Cost

Conversation minutes are the only running cost. The socket opens on wake or
`⌘'` and closes on standby, error, or idle timeout, so dormant Akira costs
nothing. Wake detection is local and free.

## Verification targets

Deterministic tests cover accelerator matching, including the shifted-
punctuation case and the Escape regression that V2 shipped with.

These require real hardware and should be recorded as release QA rather than
inferred from unit tests:

- first microphone permission, and the prompt after a restart;
- wake detection from near and far field, and the false-positive rate over a
  normal working day;
- time to first audio, measured rather than judged;
- barge-in while audio is queued;
- continuous conversation across a long pause;
- ambience visibility over the Constellation and in the World Browser;
- `⌘'` while a native browser tab holds focus;
- sleep/wake, network loss, and microphone device change;
- idle timeout firing, and *not* firing mid-turn;
- signed and notarised DMG microphone entitlement — dev mode runs as Electron,
  so it cannot validate this.
