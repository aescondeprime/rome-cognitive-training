# Akira V2 setup

## First run

1. Build and open the ROME desktop app.
2. Open the Akira panel from the Aura at the lower right.
3. In **Settings**, choose a cloud provider/model and enter its API key.
4. Enter an ElevenLabs API key and voice ID if voice responses are wanted.
5. Save, then select **Health → Install / repair runtime** if Hermes was not already found.
6. Click **Listen** once and approve the macOS microphone prompt.

After the microphone is armed, the Aura can remain in standby. Say “Akira” to begin, continue speaking naturally after each response, and press Control+Escape to return to standby.

## Credentials

Credentials entered in the UI are encrypted with Electron `safeStorage` and are never returned to the renderer. If secure platform storage is unavailable, Akira refuses to save a key. In that case launch ROME with the relevant environment variables:

```text
OPENAI_API_KEY
ANTHROPIC_API_KEY
OPENROUTER_API_KEY
ELEVENLABS_API_KEY
```

For OpenAI API use, Akira configures Hermes's OpenAI-compatible custom provider at `https://api.openai.com/v1`. Anthropic and OpenRouter use their native Hermes provider names.

## Hermes runtime

Akira searches in this order:

1. `HERMES_EXECUTABLE`;
2. the managed `ROME/Akira/runtime/bin` directory;
3. the managed `uv` tool directory;
4. the application `PATH`.

The repair action requires the [`uv` package manager](https://docs.astral.sh/uv/), downloads the pinned Hermes source release, and installs its `voice` and `wake` extras in Hermes's supported editable mode with a managed Python 3.11 runtime. Runtime download and model initialization happen after the ROME window is usable.

For a manual installation, install Hermes and ensure `hermes --version` succeeds in the environment used to launch ROME. Akira then starts `hermes serve` automatically.

## macOS microphone access

The packaged app contains `NSMicrophoneUsageDescription`. If access was declined, enable ROME under **System Settings → Privacy & Security → Microphone**, restart ROME, and click Listen again.

ROME permits microphone access only to its trusted `http://127.0.0.1:5000` shell and only for audio. Native browser tabs retain their independent permission prompt and cannot access the Akira preload bridge.

## Degraded mode and troubleshooting

ROME remains usable when Hermes, local STT, wake assets, a provider key, or ElevenLabs is unavailable. The Aura shows `Unavailable` or a reason, and **Health** exposes bounded runtime logs.

- **Hermes not installed:** install `uv`, then use Install / repair runtime.
- **Wake word unavailable:** verify Hermes installed its voice dependencies and that the app remains armed; typed chat still works.
- **No transcription:** switch from `base` to `tiny` on an 8 GB machine, then repair/restart the runtime.
- **No spoken response:** check the ElevenLabs key and voice ID. Text responses remain available.
- **Provider error:** confirm the selected provider, model identifier, and corresponding environment/UI key.
- **Microphone blocked:** review macOS privacy access and restart ROME.

Akira's managed files are under ROME's application data directory in `Akira/`. Removing that directory resets Akira settings, runtime, activity, and sessions; do that only after making any desired backup.
