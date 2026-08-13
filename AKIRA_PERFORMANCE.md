# Akira V2 performance notes

The default target is a 2022 MacBook Air with Apple M2 and 8 GB unified memory. Akira deliberately keeps language-model inference in the cloud while running only wake detection, speech recognition, audio worklets, and orchestration locally.

## Recommended profile for M2 / 8 GB

- Hermes model inference: cloud provider.
- Local STT: `base` for accuracy; choose `tiny` if memory pressure or first-transcript latency is uncomfortable.
- Wake word: Sherpa open-vocabulary “Akira” model (small one-time asset).
- ElevenLabs: `eleven_flash_v2_5`, streamed `pcm_24000`.
- Active-page reads: off unless needed.
- Runtime restart ceiling: three attempts per five minutes.

No LLM weights, Whisper model, wake asset, Python environment, or Hermes runtime is packaged into the DMG. They live below `ROME/Akira`, so application updates remain small and do not duplicate models.

## Latency path

Wake capture uses an `AudioWorklet` to avoid main-thread polling. Dormant frames are downsampled and sent in 1,280-sample chunks. Active VAD runs on the same frames, while `MediaRecorder` produces a compressed utterance for local transcription. ElevenLabs PCM is scheduled ahead by roughly 25 ms rather than waiting for a complete audio file.

The live ROME context is capped and parallelized. Recent notes/memory are limited, native browser content is absent by default, and readable page text is capped at 50,000 characters when explicitly enabled. Capability payloads and wake/audio IPC frames have hard size limits.

## Memory behavior

Hermes and `faster-whisper` are separate from Chromium. The local STT model stays warm according to Hermes defaults, improving subsequent turns but retaining memory. On constrained systems:

1. select the `tiny` speech model;
2. close unneeded native browser tabs and large PDF/Academia views;
3. keep active-page reading disabled;
4. return Akira to standby when a continuous conversation is finished;
5. restart ROME if an upstream native dependency fails to release memory.

The UI keeps only the latest 100 transcript events, 500 activity items, 300 runtime log lines, and a bounded undo list. Audio source nodes are removed as they finish and all queued nodes are stopped on barge-in or standby.

## Verification targets

The fast desktop workflow packages Apple Silicon independently from Intel and Windows jobs. Deterministic Akira tests cover state transitions, ambiguity/bulk permission behavior, context assembly, mutation/invalidation, runtime replacement, gateway replacement, streamed PCM, and stale-audio cancellation.

Before release, verify on real M2 hardware:

- first microphone permission and subsequent restart;
- wake detection from near/far-field speech;
- local base/tiny transcription latency and memory;
- barge-in while ElevenLabs audio is queued;
- continuous listening after a silent pause;
- WebContentsView Aura visibility and Control+Escape;
- sleep/wake, network loss, and runtime crash recovery;
- signed/notarized DMG microphone entitlement behavior.

Those real-device checks cannot be established by container builds alone and should be recorded as release QA rather than inferred from unit tests.

