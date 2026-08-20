# Akira V3 — Implementation Spec

**Status:** Draft for approval · **Target:** `rome-cognitive-training` · **Branch:** `feat/akira-v3`
**Baseline:** `25e7f16` (AkiraFix0.2.1) · **Author:** drafted with Claude, 2026-08-18

---

## 0. Goal

Akira should feel like JARVIS: you say its name, it answers, you keep talking, it does things
— and none of that pulls you out of what you were doing. Today it does not feel like that,
for reasons that are architectural rather than cosmetic. This spec replaces the conversation
loop, makes Akira visually invisible until spoken to, fixes the keybind collision, and widens
what Akira can actually operate.

### Decisions locked with the user

| Area | Decision |
|---|---|
| Conversation loop | ElevenLabs Agents realtime WebSocket |
| Microphone | Renderer owns one always-open stream; no handoff |
| Hermes | Retained for wake word + deep-work delegate; removed from the live loop |
| Idle UI | Completely invisible — no dock, no orb, no label |
| Active UI | Background gradient glow; colors editable in the Constellation editor |
| Keybind | `Command + '` toggles the conversation on and off |
| Capabilities | Full surface: tasks, memory, research spaces, training data, time/projects/threats |
| Rollout | One branch, four testable phases |

---

## 1. Root-cause findings

These are the defects V3 is built to eliminate. Each is cited to current code at `25e7f16`.

### 1.1 The turn pipeline is fully serial (the "not smooth" complaint)

`AkiraProvider.tsx` records a complete utterance, waits for `silenceMs` (default 950ms),
stops `MediaRecorder`, encodes to base64, and only then hands off. `controller.ts:502` calls
`speak()` exclusively from the `message.complete` branch — so ElevenLabs is not asked for a
single byte of audio until the language model has finished its entire response.

```
capture ──► silence 950ms ──► encode ──► IPC ──► batch Whisper ──► LLM (full) ──► TTS ──► play
└──────────────────────── nothing overlaps ────────────────────────┘
```

Realistic time-to-first-audio: **6–15 seconds**. ChatGPT voice mode overlaps every stage and
lands near 500ms. This is not tunable; the pipeline shape is wrong.

### 1.2 Two capture systems contend for one microphone (the "wake word doesn't work" complaint)

Hermes owns the mic during standby via Sherpa. On detection, `controller.ts:469` pauses
Hermes, then `AkiraProvider.tsx:326-330` cold-starts `getUserMedia` + `AudioContext` +
`AudioWorklet` in the renderer and calls `startRecorder` **30ms later**. On macOS that
cold start costs hundreds of milliseconds, so:

- the opening syllables of your request are lost, and
- anything said *after* "Akira" in the same breath is lost entirely.

If Hermes' Sherpa/`pypinyin` chain failed to install, `wake.detected` never fires and the only
signal is a `reason` string buried in a panel you have to open.

### 1.3 Escape is handled without modifier checks (the "Cmd+Esc exits me out of a node" complaint)

`ConstellationMenu.tsx:465` handles bare `Escape` with no modifier guard:

```ts
if (e.key === "Escape") {
  if (selectedId) { setSelectedId(null); return; }
  if (editMode)   { setEditMode(false);  return; }
  onClose();
}
```

Any Escape — modified or not — deselects your node. Akira's handler
(`AkiraProvider.tsx:336`) fires on the same event. Both run. Additionally
`deactivationShortcut` is a hard-coded two-member union in `shared/akira.ts`, consumed in
`AkiraProvider.tsx:334`, `AkiraAura.tsx:233`, `main.ts:451`, and `tab-manager.ts:198-208`.

### 1.4 The dock is two permanent buttons, and the gradient was never wired to a background

`AkiraAura.tsx:144-159` renders a persistent orb *and* an "AKIRA / Standby" label bar in the
lower-right. Meanwhile `gradientA`/`gradientB` exist in settings and are pushed to CSS custom
properties (`AkiraAura.tsx:78-79`), but every consumer in `index.css` uses them only to tint
the 40px orb (`.akira-aura`, `.akira-dock-label`). **No background glow exists in the
codebase.** That is why it was never seen.

### 1.5 The capability surface is narrow, and one registered consumer is broken

28 capabilities exist, covering boards, ideas, tasks, stabilizer, finance, schedule, browser,
and navigation. Nothing covers Athena Trials, Philosophy Chambers, Research Lab, Component
Board, Academia, Kronos Keep, Memory Vault, Local Memory, Cognitive Profile, Threats, or
Projects.

`AkiraAura.tsx:64` calls `rome.memory.list`, **which is not registered** — the Memory tab
throws on every open.

Separately, `controller.ts:201-209` staples a 14,000-character JSON snapshot to the front of
every single prompt. That is expensive, mostly irrelevant per-turn, and crowds the context
that reasoning actually needs.

### 1.6 Correction to the wake-word plan — Hermes cannot accept client audio

I verified this against the pinned Hermes source (`NousResearch/hermes-agent` @
`3c27eb6234bf`). Its gateway exposes exactly nine RPC methods:

```
config.set  voice.record  voice.toggle  voice.tts
wake.pause  wake.resume   wake.start    wake.status  wake.stop
```

`wake.start` arms Hermes' *own* listener against its *own* capture device. **There is no API
to push client-captured PCM into it.** The claim in `AKIRA_ARCHITECTURE.md` that Akira uses
"client-captured 16 kHz mono PCM while dormant" is not supported by the runtime.

So "renderer forwards PCM to Sherpa over IPC" — which is what I offered and you selected — is
not implementable without forking Hermes. Section 3.2 gives the plan that preserves your
intent (renderer owns the mic, no handoff, no new dependency) without that fork, plus a
defined fallback.

---

## 2. Target architecture

```
┌─ ROME renderer ────────────────────────────────────────────────┐
│  AkiraMic          one always-open 16kHz stream + ring buffer  │
│  AkiraAmbience     background gradient glow (state-driven)     │
│  AkiraConsole      summoned only; no persistent chrome         │
└───────┬──────────────────────────────┬─────────────────────────┘
        │ narrow IPC                   │ wake events
┌───────▼──────────────────────────────▼─────────────────────────┐
│  Electron · Akira host                                          │
│  ├─ realtime-session.ts   ElevenLabs Agents WebSocket           │
│  ├─ capability-registry   UNCHANGED — the hands                 │
│  ├─ permission-policy     UNCHANGED — approvals, undo, activity │
│  ├─ memory-store.ts       NEW — profile-scoped durable memory   │
│  └─ hermes-delegate.ts    NEW — background deep-work handoff    │
└───────┬───────────────────────────────┬────────────────────────┘
        │ client tools                  │ MCP (unchanged)
┌───────▼────────────────┐   ┌──────────▼─────────────────────────┐
│  ElevenLabs Agents     │   │  Hermes  ·  wake word + deep work  │
│  STT · turn-taking     │   │  Sherpa listener, MCP reasoning    │
│  VAD · barge-in · TTS  │   └────────────────────────────────────┘
└────────────────────────┘
```

**What does not change:** `capability-registry.ts`, `permission-policy.ts`,
`activity-store.ts`, `host-bridge.ts`, `mcp-server.ts`, the approval dialog, undo, and the
React Query invalidation contract. The hands are good. Only the brain and the wiring change.

---

## 3. Component specifications

### 3.1 Realtime session (`electron/akira/realtime-session.ts`) — NEW

Owns one WebSocket to `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=…`.

**Client → server**

| Message | Use |
|---|---|
| `conversation_initiation_client_data` | Opens the turn. Carries `dynamic_variables` (profile name, route, live counts) and a `conversation_config_override.agent.prompt` assembled from ROME memory. |
| `user_audio_chunk` | Base64 PCM 16kHz mono, ~250ms frames, streamed continuously while active. |
| `client_tool_result` | Result of a ROME capability, keyed by `tool_call_id`. |
| `contextual_update` | Non-interrupting state change ("user navigated to Idea Workshop"). |
| `user_message` | Typed input from the console. |
| `pong` | Latency keepalive. |

**Server → client**

| Message | Handling |
|---|---|
| `audio` | Base64 PCM → existing Web Audio scheduling queue in `AkiraProvider`. Retained as-is; it already works. |
| `user_transcript` | Emit to transcript, drive `LISTENING → PROCESSING`. |
| `agent_response` | Emit to transcript. |
| `client_tool_call` | **Dispatch into `capabilityRegistry.call(name, args)`.** Permission policy, approval, undo, and activity logging all apply unchanged. Reply with `client_tool_result`. |
| `interruption` | Cancel queued playback, return to `LISTENING`. |
| `vad_score` | Drive the ambience intensity (section 3.5). |
| `ping` | Reply `pong`. |

**Tool exposure.** The agent's tool list is generated from
`capabilityRegistry.list()`, the same descriptors that feed the MCP manifest today. One
generator, two consumers. A capability added once appears in both places.

**Latency budget.** Target time-to-first-audio ≤ 800ms. `eleven_flash_v2_5` is documented at
~75ms model latency; the remainder is network plus LLM first-token.

**Failure behavior.** Socket loss during an active conversation → one silent reconnect
attempt preserving conversation id; second failure → `ERROR`, ambience flashes amber once,
Akira speaks nothing. Never a modal.

### 3.2 Microphone ownership (`client/src/akira/AkiraMic.ts`) — NEW

One `getUserMedia` stream, opened once when ROME gains focus after Akira is configured, and
held for the lifetime of the window. Never closed on state change.

- `AudioWorklet` downsamples to 16kHz mono PCM.
- A **3-second rolling ring buffer** is maintained at all times.
- On wake, the buffer is flushed into the socket *before* live audio, so the words spoken
  after "Akira" in the same breath survive. This is the direct fix for 1.2.

**Wake detection — primary approach.** Hermes keeps its Sherpa listener and its own capture
device; the renderer holds its stream concurrently. macOS CoreAudio permits multiple clients
on one input device, so both can listen at once. The handoff — the actual source of the bug —
disappears entirely: `wake.pause`/`wake.resume` are no longer called, and no cold start sits
between detection and capture.

**This must be verified on your M2 in Phase 2**, because concurrent input capture is the one
assumption in this spec I cannot test from here.

**Fallback if concurrent capture fails.** Move detection into the renderer with Picovoice
Porcupine Web and a custom "Akira" keyword; Hermes then never touches audio. Costs a
Picovoice access key. Hermes already supports `wake.porcupine`, so the model file is reusable
if you ever want to move it back. Decision point is a single Phase 2 test, not a rewrite —
`AkiraMic` is the same either way.

**Privacy.** The mic being always open is a real change in posture. It is mitigated by: audio
leaving the machine *only* between wake and deactivate; the ring buffer being fixed-size,
in-memory, and never written to disk; and a hard "Akira is off" switch in Settings that
releases the device.

### 3.3 Activation and deactivation

**Wake word** — `wake.detected` from Hermes → open realtime socket → flush pre-roll → `LISTENING`.

**`Command + '`** — toggle. Pressed while dormant, starts a conversation with no wake word.
Pressed while active, deactivates.

Three code paths must agree:

1. `AkiraProvider` keydown listener — `event.metaKey && event.key === "'"`.
2. `tab-manager.ts` `before-input-event` — so it works when a native browser tab has focus.
   Replaces the Control+Escape branch at lines 198-208.
3. `shared/akira.ts` — replace the two-member union with
   `type AkiraShortcut = string` validated against an allow-list, so this is never again a
   type-level constant.

**The Escape collision fix.** `ConstellationMenu.tsx:465` gains a modifier guard:

```ts
if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey) { … }
```

Bare Escape keeps its current node/edit behavior. Modified Escape is ignored, permanently
decoupling constellation navigation from Akira.

**Continuous conversation.** Silence never ends a conversation. The `AWAKE_IDLE →
bridge.activate()` re-arm loop (`AkiraProvider.tsx:355-363`) is deleted — with a persistent
socket there is nothing to re-arm. Only `Command + '`, a spoken standby command, or a hard
error deactivates.

### 3.4 State machine

Eleven states collapse to seven. `WAKE_DETECTED`, `DEACTIVATING`, and `AWAKE_IDLE` were
artifacts of the handoff and the re-arm loop; both are gone.

```
UNAVAILABLE ── configured ──► DORMANT
DORMANT ── wake | Cmd+' ──► LISTENING
LISTENING ── user_transcript ──► PROCESSING
PROCESSING ── audio | client_tool_call ──► SPEAKING | ACTING
SPEAKING ── interruption | complete ──► LISTENING
ACTING ── approval needed ──► AWAITING_APPROVAL ──► ACTING
any ── Cmd+' | standby ──► DORMANT
any ── fatal ──► ERROR ──► DORMANT
```

`SPEAKING` and `ACTING` may hold concurrently — Akira narrating while it works is the desired
behavior, not a conflict.

### 3.5 Ambience (`client/src/akira/AkiraAmbience.tsx`) — NEW, replaces the dock

A single fixed full-viewport element, `pointer-events: none`, sitting behind app content and
below `LightRay` (which owns `zIndex: 201`).

- **Dormant:** `opacity: 0`. Renders nothing. ROME looks exactly like ROME.
- **Active:** a soft radial/conic gradient bloom from the viewport edges inward, built from
  `--akira-gradient-a` and `--akira-gradient-b`, fading over 400ms.
- **Breathing:** slow pulse tied to state — calm in `LISTENING`, quicker in `PROCESSING`,
  amplitude driven by `vad_score` while you speak, so the room responds to your voice.
- **State tint:** `ACTING` shifts toward gradient B; `AWAITING_APPROVAL` toward amber;
  `ERROR` a single amber flash, then dormant.
- Honors `appearance.reduceMotion` by dropping to a static wash.

**World Browser case.** When a native `WebContentsView` covers the window, a DOM overlay is
occluded. `AkiraAmbience` reads the existing `html[data-rome-desktop-world="true"]` flag and
switches to an inset frame glow drawn in the margin outside the view's bounds, so the signal
survives on the one screen where a DOM overlay cannot reach.

**Removed:** `.akira-dock`, `.akira-aura`, `.akira-aura-orbit`, `.akira-aura-core`,
`.akira-dock-label` and their `data-rome-desktop-world` variants — roughly 110 lines of
`index.css`.

**The console** (transcript, settings, memory, activity, health) survives as
`AkiraConsole.tsx`, summoned by `Command + Shift + '` or from the Settings page. It is never
mounted unless opened. The approval dialog remains always-available, since it must interrupt
by design.

### 3.6 Constellation editor integration

Gradient colors move to where every other ROME color already lives.

- `ConstellationLayout` gains `akiraGradientA` and `akiraGradientB`, HSL-component strings
  (`"178 76% 58%"`) matching the existing `accentColor`/`rayColor` convention.
- The edit-mode panel gains an "Akira" group with two pickers, an intensity slider, and a
  live preview that runs the ambience at full strength while the picker is focused.
- `defaultLayout()` and the backfill ladder in `loadLayout()` are extended, consistent with
  how `rayColor` and `accentColor` were added.
- `appearance.gradientA`/`gradientB` are **removed** from `AkiraSettings`. The renderer owns
  this; the main process has no business storing a color it never draws.

### 3.7 Capability expansion

The registry grows to cover every area you selected. New capabilities follow the existing
descriptor contract exactly — `risk`, `visual`, `queryKeys`, `localStores`, `supportsUndo` —
so permissions, approvals, invalidation, and undo come for free.

| Area | Capabilities |
|---|---|
| **Memory** | `rome.memory.list` *(fixes the broken tab)*, `.search`, `.write`, `.forget`, `.vault_list`, `.vault_read` |
| **Research spaces** | `rome.research.boards`, `.cards`, `.create_card`, `.update_card`, `.link`; `rome.components.*`; `rome.philosophy.entries`, `.create_entry`; `rome.academia.*` |
| **Training** | `rome.training.start_drill`, `.recent_sessions`, `.stats`; `rome.profile.cognitive` |
| **Time & tracking** | `rome.kronos.agenda`, `.schedule`, `.reschedule`; `rome.projects.*`; `rome.threats.*` |
| **Delegate** | `rome.delegate` — hands a multi-step request to Hermes in the background |

**`rome.delegate` semantics.** Akira says something like "I'll work on that and tell you when
it's done", returns immediately, and Hermes runs the chain through MCP against the same
registry. Progress arrives as `contextual_update` so Akira can mention it mid-conversation
without interrupting you. Completion is announced. Delegated work is subject to identical
approval gating — a destructive action still surfaces a dialog, regardless of which brain
requested it.

**Ambiguity handling.** The current `requireSingleMatch` rejects ambiguous names outright.
V3 returns candidates *to the agent* instead, so Akira can ask "the research board or the
component board?" — which is what a person would do, and closer to the inference you asked
for.

**Context strategy.** The 14k-character per-prompt blob is deleted. Replaced by:

- a compact set of `dynamic_variables` at conversation start (~400 chars: profile, route, open
  counts, today's agenda size);
- `contextual_update` on navigation and on `data-changed`, so Akira tracks your movement
  through the app in real time;
- `rome.get_context` retained as a **tool** the agent calls when it actually needs detail.

This is both cheaper and more accurate — the agent pulls what it needs instead of drowning in
what it doesn't.

### 3.8 Memory and growth (`electron/akira/memory-store.ts`) — NEW

"Learn and grow with me" needs somewhere durable to grow into. Hermes session continuity does
not survive a runtime restart, and V3 takes Hermes out of the live loop anyway.

- Profile-scoped JSON store beside `activity-store.ts`, same atomic-write discipline.
- Three tiers: **facts** (stable — preferences, names, working style), **episodic** (recent
  conversation summaries, decaying), **directives** (explicit "remember that…" instructions,
  never auto-expired).
- Facts and directives are compiled into the agent prompt override at conversation start.
- Akira writes via `rome.memory.write`; you can read, edit, and delete everything from the
  console's Memory tab.
- Bounded: 200 facts, 50 episodic entries, unbounded directives (they're user-authored).

Memory is inspectable and editable by design. An assistant that remembers things you can't
see or correct is a liability, not a feature.

---

## 4. Phases

Each phase ends at a state you can run and judge. Nothing merges to `main` until you've said
the phase is right.

### Phase 1 — Presence and control *(no voice changes)*

Fixes the things that annoy you daily, independent of the risky work.

- `Command + '` toggle across all three input paths
- Escape modifier guard in `ConstellationMenu`
- `AkiraAmbience` background gradient; dock and orb deleted
- Constellation editor gradient controls
- `AkiraConsole` extracted, summoned rather than docked

**You can judge:** does idle ROME feel clean, does the glow look right, does Escape behave.

### Phase 2 — Realtime voice loop *(the core)*

- `realtime-session.ts` + ElevenLabs Agents integration
- `AkiraMic` always-open stream and ring buffer
- **Concurrent-capture verification on your M2** — the one open assumption
- State machine collapse; handoff and re-arm loop deleted
- Barge-in via `interruption`
- Client-tool dispatch into the existing registry

**You can judge:** does it flow like ChatGPT voice mode. This is the phase that decides
whether V3 succeeded.

### Phase 3 — Capabilities and memory

- Full capability expansion per 3.7
- `memory-store.ts` and the three-tier prompt assembly
- `rome.delegate` handoff to Hermes
- Context strategy swap
- Ambiguity → candidates

**You can judge:** can you actually ask for the things you want done.

### Phase 4 — Hardening

- Deterministic tests for the new session, mic, memory, and dispatch paths
- Rewrite `AKIRA_ARCHITECTURE.md`, `AKIRA_SETUP.md`, `AKIRA_PERFORMANCE.md` — all three
  currently describe a system that will no longer exist, and one of them (1.6) already
  describes one that never did
- Sleep/wake, network loss, device change, permission revocation
- Signed/notarized DMG microphone entitlement check

---

## 5. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Concurrent mic capture fails on macOS | **High** | Porcupine fallback, fully specified in 3.2; `AkiraMic` is unchanged either way |
| ElevenLabs Agents plan doesn't cover your account | **High** | Verify before Phase 2 starts — it gates the whole phase |
| Conversation-minute cost during long sessions | Medium | Socket opens on wake, closes on deactivate; idle costs nothing |
| Realtime agent LLM weak on long tool chains | Medium | `rome.delegate` routes those to Hermes |
| Local checkout 9 commits behind | Low | Resolve in Phase 0 before any work |
| Voice quality unverifiable from here | Certain | Every phase ends on your hardware |

---

## 6. Before Phase 1

1. `git pull` your local checkout to `25e7f16` — you have been testing an older build.
2. Confirm your ElevenLabs plan includes the Agents platform, and create an agent (I'll
   specify its configuration; the voice, prompt, and LLM are set in their dashboard).
3. Confirm `Command + '` is free in your macOS setup — I found no conflict in ROME, but
   system-level bindings vary.

---

## 7. Open questions

- **Agent LLM choice.** ElevenLabs configures this in their dashboard. Worth picking
  deliberately — it's the model doing the fast conversational reasoning.
- **First message.** Should Akira greet on wake ("Yes?"), or answer only what you asked?
  JARVIS does the latter; it's a small thing that changes the feel a lot.
- **Approval friction.** Voice-approving destructive actions may be more natural than the
  dialog. Worth revisiting in Phase 3 once you've lived with it.
