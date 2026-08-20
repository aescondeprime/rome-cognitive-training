# Akira V3 setup

Two things are required — an ElevenLabs agent, and one client tool on it. The
wake word is optional and needs no account at all.

---

## 1. Create the ElevenLabs agent

**Agents → Create agent → Blank template.** Not one of the prebuilts; they ship
their own prompts, greetings, and tools, all of which fight ROME's.

| Field | Value |
|---|---|
| Name | `Akira` |
| Voice | Your choice |
| TTS model | `eleven_flash_v2_5` — the quality models add 1–2s per turn |
| First message | **Leave empty.** ROME decides whether to greet |
| Knowledge base | Empty. ROME supplies context live |

Copy the agent ID (`agent_…`).

### Enable the prompt override

**Agent → Overrides → System prompt → on.**

This is not optional. ROME sends its capability catalogue as a per-conversation
system prompt override, and ElevenLabs rejects the entire connection when an
override is sent for a field that has not been enabled — you get close code
1008 and a socket that opens then immediately closes.

Without it Akira will connect and converse, but with no idea ROME exists.

Leave every other override off; ROME sends only this one, and each toggle is
standing permission for a client to change that field.

### Add the `rome_execute` tool

**Agent → Tools → Add tool → Client tool.**

| Field | Value |
|---|---|
| Name | `rome_execute` |
| Description | `Execute a capability inside the ROME application. The exact capability names and their arguments are listed in the ROME CAPABILITIES section of your system prompt. Wait for the response before telling the user what happened.` |
| Wait for response | **On** |

Two string parameters, both required:

| Identifier | Type | Description |
|---|---|---|
| `capability` | String | `Exact capability name from the catalogue, for example "rome.ideas.create".` |
| `arguments_json` | String | `Arguments as a JSON object encoded in a string, for example {"title":"New concept"}. Use {} when the capability takes none.` |

This is the only tool the agent ever needs. Every ROME capability routes through
it, and the catalogue travels in the prompt — so adding capabilities later
requires no dashboard change. The canonical copy of this spec lives in
`electron/akira/tool-catalogue.ts` as `DISPATCH_TOOL_SPEC`.

**Without this tool Akira can talk but cannot act**, which looks like the
capabilities silently not working rather than a missing configuration.

### Choose the LLM

Set it deliberately. What matters, in order: tool-calling reliability across a
large surface, latency to first token, and only then reasoning depth. Reasoning
effort should be **None** — deliberation mid-sentence reads as lag.

---

## 2. Configure ROME

Open the console with **⌘⇧'** → **Settings** → **Conversation**:

- paste the **agent ID**
- paste your **ElevenLabs API key** — encrypted with Electron `safeStorage`,
  never returned to the renderer

If secure storage is unavailable, Akira refuses to persist the key; launch ROME
with `ELEVENLABS_API_KEY` in the environment instead.

Press **⌘'** and talk.

---

## 3. Wake word (optional)

Detection runs entirely on-device. No account, no key, no service.

```bash
npm install onnxruntime-web
mkdir -p client/public/akira
```

Three ONNX files go in `client/public/akira/`:

| File | Source |
|---|---|
| `akira.onnx` | Trained yourself — see below |
| `melspectrogram.onnx` | openWakeWord release assets |
| `embedding_model.onnx` | openWakeWord release assets |

The latter two are shared by every openWakeWord model and only need downloading
once.

To train `akira.onnx`, use openWakeWord's Colab notebook with the phrase set to
`akira` and a T4 GPU runtime. It generates its own synthetic training audio, so
nothing is recorded. The upstream notebook has suffered dependency rot; a
maintained fork is at
<https://github.com/alfiedennen/openwakeword-colab-2026>.

Then enable the wake word under **Settings → Input** and tune **strictness**.
Higher is stricter: fewer false triggers, more missed attempts. Around 0.65 is a
reasonable starting point for a self-trained model.

---

## Keyboard

| Shortcut | Action |
|---|---|
| `⌘'` | Start or end a conversation |
| `⌘⇧'` | Open the console |

Both are configurable under **Settings → Input**, work while a native browser
tab has focus, and cannot be assigned to the same accelerator.

---

## Microphone permission

The packaged app declares `NSMicrophoneUsageDescription`. If access was
declined, enable ROME under **System Settings → Privacy & Security →
Microphone** and restart.

In dev mode (`npm run desktop:dev`) the running binary is Electron, not ROME,
and macOS tracks permission per binary — so it appears as "Electron" and dev
mode is not a valid test of the signed app's entitlement.

---

## Cost

Conversations bill per minute. The socket opens when a conversation starts and
closes when it ends, so idle Akira costs nothing. The **Close after silence**
setting exists specifically because a false wake-word trigger would otherwise
leave the meter running; 0 disables it.

---

## Degraded modes

ROME stays fully usable when any part of Akira is unavailable.

| Symptom | Cause |
|---|---|
| "No ElevenLabs agent configured" | Agent ID missing in settings |
| Connection closes, code 1008 | System prompt override not enabled |
| "connected without its ROME capabilities" | Same, but the fallback retry succeeded |
| Akira talks but does nothing | `rome_execute` tool not added to the agent |
| Wake word never fires | Models missing from `client/public/akira/`, or `onnxruntime-web` not installed |
| Nothing happens on ⌘' | Check the notice at the bottom of the window — failures surface there |

Akira's managed files live under ROME's application data directory in `Akira/`.
Removing it resets settings, credentials, cached greeting audio, and activity.

## Hermes

Hermes is no longer part of the conversation and does not need to be installed.
The runtime manager and MCP bridge remain in the tree for a future background
delegation path; nothing in normal operation touches them.
