import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  DEFAULT_CONSOLE_SHORTCUT,
  DEFAULT_CONVERSATION_SHORTCUT,
  matchesAkiraShortcut,
  type AkiraActivityEntry,
  type AkiraApprovalRequest,
  type AkiraCapabilityDescriptor,
  type AkiraAudioEvent,
  type AkiraDataChanged,
  type AkiraRendererCommand,
  type AkiraSettings,
  type AkiraStatus,
  type AkiraTranscriptEvent,
} from "@shared/akira";
import { queryClient } from "@/lib/queryClient";
import { getToken } from "@/lib/auth";
import {
  cancelSleep, describePeriod, extendSleep, readPeriod, setSleep, sleepStatus, wakeNow,
  wakeWordSuppressed,
} from "@/lib/sleepSession";
import { AkiraMic } from "./AkiraMic";
import { OpenWakeWord } from "./wake/OpenWakeWord";
import { loadFinancialState, saveFinancialState } from "@/lib/financialStore";
import {
  cancelFocus, completeTask as completeFocusTask, createTask as createFocusTask, extendFocus,
  findTask, focusStatus, markAnnounced, markEnded, pauseFocus, readTasks, restoreFocus,
  restoreTask as restoreFocusTask, resumeFocus, runningTask, spokenRemaining, startFocus,
  type FocusTimer,
} from "@/lib/focusSession";
import { makeId, projectFinancials, toDateInput, type ExpenseKind, type Recurrence } from "@/lib/financialEngine";

/**
 * Human names for ROME's routes.
 *
 * Contextual updates are read by a language model, not parsed, so "the Idea
 * Workshop" is worth more than "/idea-workshop" — it lets Akira resolve "the
 * board I was just looking at" without being told the URL scheme.
 */
const ROUTE_LABELS: Record<string, string> = {
  "/athena": "Athena Trials",
  "/athena/dual-n-back": "the Dual N-Back drill",
  "/athena/cwm": "the Complex Working Memory drill",
  "/athena/mental-math": "the Mental Math drill",
  "/athena/corsi": "the Corsi Blocks drill",
  "/athena/memory-span": "the Memory Span drill",
  "/athena/pasat": "the PASAT drill",
  "/philosophy": "Philosophy Chambers",
  "/strategic": "the Strategic node",
  "/taskboard": "the Taskboard",
  "/kronos-keep": "Kronos Keep",
  "/creative": "the Creative node",
  "/idea-workshop": "the Idea Workshop",
  "/investigative": "the Investigative node",
  "/component-board": "the Component Board",
  "/research-lab": "the Research Lab",
  "/world": "the World Browser",
  "/funding": "the Funding Dashboard",
  "/academia": "Academia",
  "/settings": "Settings",
};

function describeRoute(hash: string): string | null {
  const route = hash.replace(/^#/, "").split("?")[0] || "/";
  return ROUTE_LABELS[route] ?? null;
}

/** A short-lived message shown by the ambience layer, then cleared. */
export interface AkiraNotice {
  text: string;
  kind: "info" | "error";
  at: number;
}

interface AkiraContextValue {
  status: AkiraStatus | null;
  transcripts: AkiraTranscriptEvent[];
  approval: AkiraApprovalRequest | null;
  microphoneArmed: boolean;
  notice: AkiraNotice | null;
  showNotice: (text: string, kind?: AkiraNotice["kind"]) => void;
  panelOpen: boolean;
  /** Accepts an updater so the summon shortcut can toggle without a stale read. */
  setPanelOpen: Dispatch<SetStateAction<boolean>>;
  activate: (viaWakeWord?: boolean) => Promise<void>;
  standby: () => Promise<void>;
  interrupt: () => Promise<void>;
  /** Start a conversation when dormant, end it when active. Bound to Command+'. */
  toggleConversation: () => Promise<void>;
  submitText: (text: string) => Promise<void>;
  /** Speak one line without opening a conversation. Used to test the voice path. */
  announce: (text: string) => Promise<{ ok: boolean; voice: string; detail: string }>;
  /** Ask ElevenLabs whether the stored key is usable, and say what it answered. */
  verifyKey: () => Promise<{ ok: boolean; detail: string }>;
  /** Ask ROME's own data server whether it is answering, and how fast. */
  probeServer: () => Promise<{ ok: boolean; detail: string }>;
  /** Read the agent's tool and turn configuration from ElevenLabs. */
  auditAgent: () => Promise<{ ok: boolean; detail: string }>;
  /** Set the agent's tool timeout and turn timeout to what ROME needs. */
  repairAgent: () => Promise<{ ok: boolean; detail: string }>;
  respondToApproval: (approved: boolean) => Promise<void>;
  updateSettings: (patch: Partial<AkiraSettings>) => Promise<void>;
  setSecret: (name: string, value: string) => Promise<void>;
  installRuntime: () => Promise<void>;
  loadActivity: () => Promise<AkiraActivityEntry[]>;
  loadDiagnostics: () => Promise<Record<string, unknown>>;
  loadCapabilities: () => Promise<AkiraCapabilityDescriptor[]>;
  callCapability: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

const AkiraContext = createContext<AkiraContextValue | null>(null);

export function useAkira(): AkiraContextValue {
  const context = useContext(AkiraContext);
  if (!context) throw new Error("useAkira must be used inside AkiraProvider.");
  return context;
}

export function AkiraProvider({ children }: { children: ReactNode }) {
  const bridge = window.romeDesktop?.akira;
  const [status, setStatus] = useState<AkiraStatus | null>(null);
  const [transcripts, setTranscripts] = useState<AkiraTranscriptEvent[]>([]);
  const [approval, setApproval] = useState<AkiraApprovalRequest | null>(null);
  const [microphoneArmed, setMicrophoneArmed] = useState(false);
  /**
   * Is a sleep period actually running?
   *
   * Polled rather than ticked, and held as a boolean rather than as a status,
   * because this provider wraps the entire app: a value that changed every
   * second here would re-render everything once a second all night. `setState`
   * with an unchanged boolean bails out, so this costs two renders per period.
   */
  const [sleeping, setSleeping] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [notice, setNotice] = useState<AkiraNotice | null>(null);
  const statusRef = useRef<AkiraStatus | null>(null);
  const micRef = useRef<AkiraMic | null>(null);
  const wakeRef = useRef<OpenWakeWord | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const playbackTimeRef = useRef(0);
  const playbackSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const playbackGenerationRef = useRef(0);
  const continueTimerRef = useRef<number | null>(null);
  /** Clears the microphone's echo guard when Akira's scheduled audio runs out. */
  const selfSpeechTimerRef = useRef<number | null>(null);
  const lastVadLevelRef = useRef(0);
  /** Raw microphone RMS, used to tell a bare summons from an instruction. */
  const localLevelRef = useRef(0);
  const noticeTimerRef = useRef<number | null>(null);

  useEffect(() => { statusRef.current = status; }, [status]);

  /**
   * The wake word goes quiet for the length of a sleep period.
   *
   * Not by writing the setting off — a period interrupted by a crash or a quit
   * would leave the wake word disabled with no explanation and nothing to
   * blame. The setting is untouched; only the detector stops, and it comes back
   * on its own when the period ends.
   */
  useEffect(() => {
    const read = () => {
      const profile = queryClient.getQueryData<{ id?: number }>(["/api/active-profile"]);
      setSleeping(wakeWordSuppressed(sleepStatus(profile?.id)));
    };
    read();
    const id = window.setInterval(read, 15_000);
    window.addEventListener("rome:sleep:refresh", read);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("rome:sleep:refresh", read);
    };
  }, []);

  /**
   * Transient, self-clearing feedback. Akira has no persistent interface, so
   * this is how a failed shortcut or a missing runtime becomes visible without
   * reintroducing a permanent dock.
   */
  const showNotice = useCallback((text: string, kind: AkiraNotice["kind"] = "info") => {
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    setNotice({ text: text.slice(0, 240), kind, at: Date.now() });
    noticeTimerRef.current = window.setTimeout(() => {
      noticeTimerRef.current = null;
      setNotice(null);
    }, kind === "error" ? 6_000 : 3_200);
  }, []);

  /**
   * Tell the microphone Akira is audible, and for how long.
   *
   * Everything she says reaches the speakers this microphone is listening to:
   * the acknowledgement, a focus warning, a whole conversational turn. Ungated,
   * her voice arrives back as user audio and the agent's turn detector reads it
   * as someone talking over her — so she interrupts herself, mid-sentence, with
   * nobody in the room having said anything.
   *
   * The renderer is the only place that can answer "is she audible right now",
   * because it is the thing scheduling the audio. Conversation state cannot:
   * the acknowledgement plays while the machine is LISTENING and a focus
   * warning plays while it is dormant.
   */
  const holdSelfSpeech = useCallback((durationMs: number) => {
    micRef.current?.setSelfSpeaking(true);
    if (selfSpeechTimerRef.current) window.clearTimeout(selfSpeechTimerRef.current);
    selfSpeechTimerRef.current = window.setTimeout(() => {
      selfSpeechTimerRef.current = null;
      micRef.current?.setSelfSpeaking(false);
    }, Math.max(0, durationMs));
  }, []);

  const releaseSelfSpeech = useCallback(() => {
    if (selfSpeechTimerRef.current) window.clearTimeout(selfSpeechTimerRef.current);
    selfSpeechTimerRef.current = null;
    micRef.current?.setSelfSpeaking(false);
  }, []);

  const cancelPlayback = useCallback(() => {
    // Queued audio is thrown away, so nothing is coming out of the speakers and
    // the microphone should stop pretending otherwise.
    releaseSelfSpeech();
    playbackGenerationRef.current += 1;
    playbackSourcesRef.current.forEach(source => {
      try { source.stop(); } catch { /* already stopped */ }
    });
    playbackSourcesRef.current.clear();
    playbackTimeRef.current = 0;
  }, [releaseSelfSpeech]);

  /**
   * Playback context, created on demand.
   *
   * Left at the device's native rate rather than forced to the stream rate:
   * `AudioBufferSourceNode` resamples a 16kHz buffer for us, whereas pinning
   * the context to 16kHz reconfigures the output device and can pop.
   */
  const ensurePlaybackContext = useCallback(async () => {
    const existing = playbackContextRef.current;
    if (existing && existing.state !== "closed") {
      if (existing.state === "suspended") await existing.resume();
      return existing;
    }
    const context = new AudioContext({ latencyHint: "interactive" });
    playbackContextRef.current = context;
    await context.resume();
    return context;
  }, []);

  const playAudio = useCallback(async (event: AkiraAudioEvent) => {
    if (event.type === "cancel") {
      cancelPlayback();
      try { window.speechSynthesis?.cancel(); } catch { /* not every runtime has it */ }
      return;
    }
    // The fallback voice. Nothing to schedule: the browser owns the audio.
    if (event.type === "speak") {
      const line = String(event.text ?? "").trim();
      if (!line) return;
      try {
        const utterance = new SpeechSynthesisUtterance(line);
        utterance.volume = Math.max(0, Math.min(1, statusRef.current?.settings.voice.volume ?? 0.85));
        // The system voice hands back no schedule, so the guard is held on a
        // generous estimate and released early by the event when it arrives.
        utterance.onend = () => releaseSelfSpeech();
        utterance.onerror = () => releaseSelfSpeech();
        holdSelfSpeech(Math.max(1_500, line.length * 90));
        window.speechSynthesis.speak(utterance);
      } catch { /* no speech synthesis here; the console line still explains why */ }
      return;
    }
    if (event.type === "start") {
      cancelPlayback();
      const context = await ensurePlaybackContext();
      playbackTimeRef.current = context.currentTime + 0.025;
      return;
    }
    if (event.type !== "chunk" || !event.audio) return;
    // The realtime session streams chunks with no preceding "start" event, so
    // the context is created here. Requiring a start event silently dropped
    // every packet of the first spoken response.
    const context = await ensurePlaybackContext();
    const bytes = Uint8Array.from(atob(event.audio), character => character.charCodeAt(0));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const samples = Math.floor(bytes.byteLength / 2);
    if (!samples) return;
    const buffer = context.createBuffer(1, samples, event.sampleRate ?? 16_000);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < samples; index += 1) channel[index] = view.getInt16(index * 2, true) / 32768;
    const source = context.createBufferSource();
    source.buffer = buffer;
    const gain = context.createGain();
    gain.gain.value = Math.max(0, Math.min(1, statusRef.current?.settings.voice.volume ?? 0.85));
    source.connect(gain).connect(context.destination);
    const startAt = Math.max(context.currentTime + 0.012, playbackTimeRef.current || context.currentTime);
    playbackTimeRef.current = startAt + buffer.duration;
    playbackSourcesRef.current.add(source);
    source.onended = () => playbackSourcesRef.current.delete(source);
    source.start(startAt);
    // Chunks queue rather than overlap, so the guard is extended to whichever
    // sample is scheduled last — not to the arrival of the last chunk, which
    // happens seconds before she has finished being heard.
    holdSelfSpeech((playbackTimeRef.current - context.currentTime) * 1_000);
  }, [cancelPlayback, ensurePlaybackContext, holdSelfSpeech, releaseSelfSpeech]);

  /**
   * The always-open microphone.
   *
   * Replaces V2's record-wait-for-silence-transcribe loop entirely. The stream
   * is acquired once and held; starting a conversation only flips streaming on,
   * so there is no device acquisition between you speaking and Akira hearing.
   */
  const armMicrophone = useCallback(async () => {
    if (micRef.current?.open) {
      setMicrophoneArmed(true);
      return;
    }
    const mic = new AkiraMic({
      deviceId: statusRef.current?.settings.input.microphoneId || undefined,
      onChunk: base64 => bridge?.sendAudioChunk(base64),
      onLevel: rms => {
        // Kept raw as well as scaled: the greeting watcher below needs to know
        // whether a person is talking, not how bright to draw the glow.
        localLevelRef.current = rms;
        // Local level drives the ambience until the server's own VAD arrives,
        // so the glow responds on the very first syllable. Written straight to
        // CSS: React state here would re-render on every audio frame.
        const level = Math.max(0, Math.min(1, rms * 12));
        if (Math.abs(level - lastVadLevelRef.current) <= 0.04) return;
        lastVadLevelRef.current = level;
        document.documentElement.style.setProperty("--akira-vad", level.toFixed(2));
      },
      onPcm: pcm => wakeRef.current?.process(pcm),
      bargeInEnabled: statusRef.current?.settings.input.bargeInEnabled ?? true,
      // Sustained speech over Akira, measured against her own echo. The server
      // cannot make this call — it receives one stream and cannot tell her
      // voice from anyone else's — so the decision is made here and the turn is
      // cancelled explicitly.
      onBargeIn: () => {
        cancelPlayback();
        void bridge?.interrupt().then(setStatus).catch(() => undefined);
      },
      onError: error => showNotice(error.message, "error"),
    });
    micRef.current = mic;
    await mic.start();
    setMicrophoneArmed(true);
  }, [bridge, cancelPlayback, showNotice]);

  const disarmMicrophone = useCallback(async () => {
    const mic = micRef.current;
    micRef.current = null;
    await mic?.stop();
    setMicrophoneArmed(false);
    lastVadLevelRef.current = 0;
    document.documentElement.style.setProperty("--akira-vad", "0");
  }, []);

  /**
   * Order matters here.
   *
   * V2 connected first and armed the microphone second, which is why the first
   * words of every request were lost. V3 armed the mic first but still waited
   * for the socket before streaming — and opening one costs a signed-URL round
   * trip plus a handshake, so anything said in that second went nowhere. It
   * felt like having to wait for her to be ready before speaking.
   *
   * Streaming now starts *before* the connection: the main process holds those
   * frames and flushes them the moment the socket opens. Combined with the
   * ring buffer's pre-roll, the whole sentence survives — the part said before
   * the wake word and the part said during the connect.
   */
  const activate = useCallback(async (viaWakeWord = false) => {
    if (!bridge) return;
    try {
      await armMicrophone();
    } catch (error) {
      throw error instanceof Error && /denied|not allowed|NotAllowed/i.test(error.message)
        ? new Error("ROME needs microphone access. Enable it in System Settings \u2192 Privacy & Security \u2192 Microphone.")
        : error;
    }
    micRef.current?.beginStreaming(true);
    // "Yes?" is decided here, while the socket is still opening, because it is
    // local audio and has never needed the connection. What it does need is to
    // not answer someone who is still talking — and the microphone knows that
    // a second before the transcript does.
    if (viaWakeWord) {
      const startedAt = Date.now();
      const watcher = window.setInterval(() => {
        const elapsed = Date.now() - startedAt;
        // The first moments are the tail of the wake word itself.
        if (elapsed < 250) return;
        if (elapsed > 900) { window.clearInterval(watcher); return; }
        if (localLevelRef.current > 0.035) {
          window.clearInterval(watcher);
          void bridge.suppressGreeting();
        }
      }, 60);
    }
    try {
      setStatus(await bridge.activate(viaWakeWord));
    } catch (error) {
      // Nothing is listening, so nothing should be leaving the machine.
      micRef.current?.endStreaming();
      throw error;
    }
  }, [armMicrophone, bridge]);

  /**
   * Ending a conversation stops the upload but leaves the device open, so the
   * next one starts instantly and the ring buffer keeps its history. Nothing
   * leaves the machine while streaming is off.
   */
  const standby = useCallback(async () => {
    if (!bridge) return;
    if (continueTimerRef.current) window.clearTimeout(continueTimerRef.current);
    continueTimerRef.current = null;
    micRef.current?.endStreaming();
    cancelPlayback();
    lastVadLevelRef.current = 0;
    document.documentElement.style.setProperty("--akira-vad", "0");
    setStatus(await bridge.standby());
  }, [bridge, cancelPlayback]);

  /**
   * One key for the whole conversation: start it when dormant, end it when
   * active. Resolved from live status rather than a captured value so a rapid
   * double-press can't desynchronise the two halves.
   *
   * Failures are surfaced rather than thrown. With no dock and no visible
   * chrome, an unhandled rejection here means pressing the key does *nothing
   * at all* — no error, no sound, no glow — which is indistinguishable from a
   * dead keybinding. The notice is the only feedback channel Akira has left.
   */
  const toggleConversation = useCallback(async () => {
    if (!bridge) return;
    const state = statusRef.current?.state;
    const dormant = !state || state === "DORMANT" || state === "DEACTIVATING" || state === "ERROR";
    try {
      if (dormant) await activate();
      else await standby();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      showNotice(
        reason || "Akira could not start a conversation.",
        "error",
      );
    }
  }, [activate, bridge, showNotice, standby]);

  const interrupt = useCallback(async () => {
    if (!bridge) return;
    cancelPlayback();
    setStatus(await bridge.interrupt());
  }, [bridge, cancelPlayback]);

  const submitText = useCallback(async (text: string) => {
    if (!bridge || !text.trim()) return;
    setStatus(await bridge.submitText(text));
  }, [bridge]);

  const handleDataChanged = useCallback((event: AkiraDataChanged) => {
    for (const queryKey of event.queryKeys) void queryClient.invalidateQueries({ queryKey });
    for (const store of event.localStores) window.dispatchEvent(new CustomEvent(`rome:${store}:refresh`, { detail: event }));
  }, []);

  /**
   * Tell Akira where the user is, without taking a turn.
   *
   * `contextual_update` folds into the conversation silently, so Akira can
   * resolve "that board I was just looking at" without anyone having to say the
   * name — the difference between an assistant that is present and one that is
   * merely reachable.
   *
   * Only sent during a live conversation. Dormant, there is no socket and
   * nothing to tell.
   */
  useEffect(() => {
    if (!bridge) return;
    let lastSent = "";
    let timer: number | null = null;

    const announce = () => {
      const state = statusRef.current?.state;
      if (!state || state === "DORMANT" || state === "UNAVAILABLE") return;
      const label = describeRoute(window.location.hash);
      if (!label || label === lastSent) return;
      lastSent = label;
      bridge.sendContext(`The user is now looking at ${label}.`);
    };

    // Debounced: hash routing fires on every intermediate navigation, and a
    // burst of updates would crowd the conversation for no benefit.
    const onHashChange = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(announce, 400);
    };

    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
      if (timer) window.clearTimeout(timer);
    };
  }, [bridge]);

  /**
   * Announce the current screen when a conversation opens, so Akira starts
   * oriented rather than having to ask or call a tool to find out.
   */
  useEffect(() => {
    if (!bridge || status?.state !== "LISTENING") return;
    const label = describeRoute(window.location.hash);
    if (label) bridge.sendContext(`The user is looking at ${label}.`);
  }, [bridge, status?.state === "LISTENING"]);

  const handleRendererCommand = useCallback(async (command: AkiraRendererCommand) => {
    if (!bridge) return;
    try {
      const value = await runRendererCommand(command.action, command.args);
      await bridge.resolveRendererCommand({ id: command.id, ok: true, value });
    } catch (error) {
      await bridge.resolveRendererCommand({ id: command.id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }, [bridge]);

  useEffect(() => {
    if (!bridge) return;
    let active = true;
    void bridge.getStatus().then(value => { if (active) setStatus(value); });
    const remove = [
      bridge.onStatus(value => setStatus(value)),
      bridge.onTranscript(value => setTranscripts(old => mergeTranscript(old, value))),
      bridge.onAudio(value => void playAudio(value)),
      bridge.onApproval(value => {
        setApproval(value);
        window.setTimeout(
          () => setApproval(current => current?.id === value.id ? null : current),
          Math.max(0, value.expiresAt - Date.now()),
        );
      }),
      bridge.onDataChanged(handleDataChanged),
      bridge.onRendererCommand(value => void handleRendererCommand(value)),
      // The mic is already open, so a wake event only has to start streaming.
      // No device acquisition, no 30ms guess, no lost syllables.
      bridge.onWakeDetected(() => {
        void activate(true).catch(error => showNotice(
          error instanceof Error ? error.message : String(error),
          "error",
        ));
      }),
      // Server-side voice activity. Overrides the local estimate once the
      // conversation is live, because it knows what is speech and what is a fan.
      bridge.onVad(({ score }) => {
        lastVadLevelRef.current = score;
        document.documentElement.style.setProperty("--akira-vad", score.toFixed(2));
      }),
      // Shortcuts pressed while a native browser view has focus arrive here,
      // because the renderer never sees those key events at all.
      bridge.onShortcut(value => {
        if (value?.action === "standby") void standby();
        else if (value?.action === "toggle") void toggleConversation();
        else if (value?.action === "console") setPanelOpen(current => !current);
      }),
    ];
    const keydown = (event: KeyboardEvent) => {
      const input = statusRef.current?.settings.input;
      const conversation = input?.conversationShortcut ?? DEFAULT_CONVERSATION_SHORTCUT;
      const consoleShortcut = input?.consoleShortcut ?? DEFAULT_CONSOLE_SHORTCUT;
      // Check the console binding first: it is the more specific accelerator
      // (it carries Shift), and matching is exact so order only matters if a
      // future binding pair overlaps.
      if (matchesAkiraShortcut(consoleShortcut, event)) {
        event.preventDefault();
        setPanelOpen(current => !current);
        return;
      }
      if (matchesAkiraShortcut(conversation, event)) {
        event.preventDefault();
        void toggleConversation();
      }
    };
    window.addEventListener("keydown", keydown, true);
    return () => {
      active = false;
      remove.forEach(dispose => dispose());
      window.removeEventListener("keydown", keydown, true);
    };
  }, [activate, bridge, handleDataChanged, handleRendererCommand, playAudio, showNotice, standby, toggleConversation]);

  /**
   * Keep streaming aligned with conversation state.
   *
   * V2 needed a timer here to re-arm the recorder after every response, which
   * is what made silence feel like the end of a turn. With a persistent socket
   * there is nothing to re-arm: streaming is simply on for the whole
   * conversation and off outside it, and a pause is just a pause.
   */
  useEffect(() => {
    const mic = micRef.current;
    if (!mic?.open || !status) return;
    mic.setBargeInEnabled(status.settings.input.bargeInEnabled);
    const conversing = !["DORMANT", "DEACTIVATING", "UNAVAILABLE", "ERROR"].includes(status.state);
    if (conversing && !mic.isStreaming) mic.beginStreaming(true);
    else if (!conversing && mic.isStreaming) mic.endStreaming();
  }, [status]);

  /**
   * Wake-word lifecycle.
   *
   * Detection needs the microphone open, which in V2 it never was while
   * dormant — that was the whole bug. Here the mic is armed as soon as Akira is
   * configured, and Porcupine consumes the same frames the conversation later
   * streams. A missing key or keyword file simply leaves it off; Command+'
   * still works.
   */
  useEffect(() => {
    if (!bridge || !status) return;
    const settings = status.settings;
    const wanted = settings.input.wakeWordEnabled && status.available && !sleeping;

    if (!wanted) {
      if (wakeRef.current) {
        const detector = wakeRef.current;
        wakeRef.current = null;
        void detector.stop();
      }
      return;
    }
    if (wakeRef.current) return;

    let cancelled = false;
    void (async () => {
      try {
        await armMicrophone();
      } catch {
        return; // Permission not granted yet; Command+' will prompt again.
      }
      if (cancelled) return;
      // No credential of any kind: the models are local files.
      const detector = new OpenWakeWord({
        keywordModelPath: settings.input.wakeKeywordPath,
        melModelPath: settings.input.wakeMelPath,
        embeddingModelPath: settings.input.wakeEmbeddingPath,
        threshold: settings.input.wakeThreshold,
        onDetected: () => {
          if (statusRef.current?.state !== "DORMANT") return;
          // Belt and braces with the `wanted` gate above: the detector is torn
          // down on the poll, and a detection that beat the poll is dropped
          // here. Being woken by your own bedroom at 3am is not recoverable by
          // apologising for it afterwards.
          const profile = queryClient.getQueryData<{ id?: number }>(["/api/active-profile"]);
          if (wakeWordSuppressed(sleepStatus(profile?.id))) return;
          void activate(true).catch(error => showNotice(
            error instanceof Error ? error.message : String(error),
            "error",
          ));
        },
        onError: error => showNotice(`Wake word unavailable: ${error.message}`, "error"),
      });
      if (cancelled) return;
      wakeRef.current = detector;
      const started = await detector.start();
      if (!started && !cancelled) wakeRef.current = null;
    })();

    return () => { cancelled = true; };
  }, [activate, armMicrophone, bridge, showNotice, sleeping, status?.available, status?.settings.input.wakeWordEnabled]);

  /**
   * The focus cycle's voice.
   *
   * Runs here rather than in the widget or the top bar because both can be
   * unmounted and the cycle cannot: a five-minute warning that only fires while
   * the Task Stabilizer happens to be on screen is not a warning.
   *
   * Warnings are spoken through one-shot synthesis, which bills characters
   * rather than conversation minutes, so a whole 25-minute cycle costs nothing
   * until you actually say something. The two moments that need an *answer* —
   * time's up, and the nudge a minute later — open the socket after speaking,
   * and it closes itself on the usual silence timeout.
   */
  useEffect(() => {
    if (!bridge) return;
    let lastSignature = "\u0000";
    let asking = false;

    const ask = async (text: string, taskName: string) => {
      if (asking) return;
      asking = true;
      try {
        await bridge.announce(text);
        await activate(false);
        bridge.sendContext(
          `The focus cycle on "${taskName}" has run out and the user has just been asked aloud whether they finished. ` +
          "Do not repeat the question. Wait for their answer: if they finished, call rome.focus.complete; " +
          "if they need longer, call rome.focus.extend with the minutes they ask for; if they are done working on it " +
          "either way, call rome.focus.cancel.",
        );
      } catch { /* the bar keeps asking on screen */ }
      finally { asking = false; }
    };

    const tick = () => {
      const profile = queryClient.getQueryData<{ id?: number }>(["/api/active-profile"]);
      const profileId = profile?.id;
      const status = focusStatus(profileId);

      // Tell the main process only when something actually changed. It uses
      // this for the shorter silence leash during a cycle and to know what you
      // are working on, not to draw anything, so per-second updates are waste.
      const signature = status.active
        ? `${status.taskId}|${status.paused}|${status.awaitingAnswer}|${Math.round(status.remainingSeconds / 60)}`
        : "";
      if (signature !== lastSignature) {
        lastSignature = signature;
        bridge.setFocus(status.active
          ? {
              taskName: status.taskName,
              remainingSeconds: status.remainingSeconds,
              paused: status.paused,
              awaitingAnswer: status.awaitingAnswer,
            }
          : null);
      }

      const task = runningTask(readTasks(profileId));
      if (!task?.timer || status.paused) return;
      const announced = task.timer.announced;

      if (!status.awaitingAnswer) {
        // Skip a warning the cycle is already past — starting a four-minute
        // cycle should not open with "five minutes left".
        if (status.remainingSeconds <= 300 && !announced.five) {
          markAnnounced(profileId, "five");
          if (task.timer.durationSeconds > 360) void bridge.announce(`Five minutes left on ${task.title}.`);
          return;
        }
        if (status.remainingSeconds <= 60 && !announced.one) {
          markAnnounced(profileId, "one");
          if (task.timer.durationSeconds > 90) void bridge.announce(`One minute left on ${task.title}.`);
          return;
        }
        if (status.remainingSeconds <= 0) {
          markEnded(profileId);
          markAnnounced(profileId, "done");
          void ask(`Time's up on ${task.title}. Did you finish?`, task.title);
        }
        return;
      }

      // Asked once, asked again a minute later, then quiet. The question stays
      // on screen in the top bar either way.
      const endedAt = task.timer.endedAt ?? Date.now();
      if (!announced.nudge && Date.now() - endedAt >= 60_000) {
        markAnnounced(profileId, "nudge");
        void ask(`Still on ${task.title}. Did you finish, or do you want more time?`, task.title);
      }
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [activate, bridge]);

  useEffect(() => {
    const onVisibility = () => {
      const current = statusRef.current;
      if (!current || document.visibilityState === "visible" || current.settings.input.wakeWhenUnfocused) return;
      if (current.state !== "DORMANT") void standby();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [standby]);

  useEffect(() => () => {
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    if (continueTimerRef.current) window.clearTimeout(continueTimerRef.current);
    if (selfSpeechTimerRef.current) window.clearTimeout(selfSpeechTimerRef.current);
    cancelPlayback();
    void wakeRef.current?.stop();
    void disarmMicrophone();
    void playbackContextRef.current?.close();
  }, [cancelPlayback, disarmMicrophone]);

  const value = useMemo<AkiraContextValue>(() => ({
    status, transcripts, approval, microphoneArmed, notice, showNotice, panelOpen, setPanelOpen,
    activate, standby, interrupt, toggleConversation, submitText,
    announce: async text =>
      (await bridge?.announce(text)) ?? { ok: false, voice: "off", detail: "Akira is desktop-only." },
    verifyKey: () => bridge?.verifyKey() ?? Promise.resolve({ ok: false, detail: "Akira is desktop-only." }),
    probeServer: () => bridge?.probeServer() ?? Promise.resolve({ ok: false, detail: "Akira is desktop-only." }),
    auditAgent: () => bridge?.auditAgent() ?? Promise.resolve({ ok: false, detail: "Akira is desktop-only." }),
    repairAgent: () => bridge?.repairAgent() ?? Promise.resolve({ ok: false, detail: "Akira is desktop-only." }),
    respondToApproval: async approved => {
      if (!bridge || !approval) return;
      const id = approval.id;
      setApproval(null);
      await bridge.respondToApproval(id, approved);
    },
    updateSettings: async patch => { if (bridge) setStatus(await bridge.updateSettings(patch)); },
    setSecret: async (name, secret) => { if (bridge) setStatus(await bridge.setSecret(name, secret)); },
    installRuntime: async () => { if (bridge) setStatus(await bridge.installRuntime()); },
    loadActivity: () => bridge?.getActivity() ?? Promise.resolve([]),
    loadDiagnostics: () => bridge?.getDiagnostics() ?? Promise.resolve({}),
    loadCapabilities: () => bridge?.getCapabilities() ?? Promise.resolve([]),
    callCapability: (name, args) => bridge?.callCapability(name, args) ?? Promise.reject(new Error("Akira is desktop-only.")),
  }), [activate, approval, bridge, interrupt, microphoneArmed, notice, panelOpen, showNotice, standby, status, submitText, toggleConversation, transcripts]);

  return <AkiraContext.Provider value={value}>{children}</AkiraContext.Provider>;
}

function mergeTranscript(values: AkiraTranscriptEvent[], next: AkiraTranscriptEvent): AkiraTranscriptEvent[] {
  const output = [...values];
  const last = output.at(-1);
  if (last?.role === next.role && (!last.final || !next.final)) output[output.length - 1] = next;
  else output.push(next);
  return output.slice(-100);
}

/**
 * The focus cycle, as Akira reaches it.
 *
 * The cycle lives in localStorage, which the main process cannot read, so the
 * capabilities are thin main-process wrappers and the actual work happens here
 * against `focusSession`. Tasks are addressed by name throughout; the matcher
 * is the shared one, so a name resolves the same way here as it does for every
 * other capability.
 */
/**
 * The sleep period, from Akira's side.
 *
 * Thin wrappers over `sleepSession`, for the same reason the focus commands are
 * thin wrappers: the period lives in the renderer's storage, the main process
 * cannot read localStorage, and a second copy of the clock is a second answer
 * to "when am I being woken up?".
 *
 * Every result carries a spoken sentence rather than a pair of timestamps,
 * because every one of these is said back out loud, and 1789432000000 is not.
 */
async function runSleepCommand(
  action: string,
  args: Record<string, unknown>,
  profileId: number | undefined,
): Promise<unknown> {
  if (action === "sleep.set") {
    const period = setSleep(profileId, {
      startTime: typeof args.startTime === "string" ? args.startTime : null,
      endTime: typeof args.endTime === "string" ? args.endTime : null,
      durationMinutes: Number.isFinite(Number(args.durationMinutes)) ? Number(args.durationMinutes) : null,
      label: typeof args.label === "string" ? args.label : null,
    });
    return {
      set: describePeriod(period),
      started: period.startsAt <= Date.now(),
      wakeAt: new Date(period.endsAt).toISOString(),
      note: "The wake word is off for the length of the period, and the alarm only stops when the user presses Tab.",
    };
  }

  if (action === "sleep.status") {
    const period = readPeriod(profileId);
    return period
      ? { active: true, summary: describePeriod(period), phase: sleepStatus(profileId).phase }
      : { active: false, summary: "No sleep period is set." };
  }

  if (action === "sleep.cancel") {
    const result = cancelSleep(profileId);
    if (!result.cancelled) throw new Error("No sleep period is set.");
    return { cancelled: result.label, summary: `${result.label} is cancelled and off the calendar.` };
  }

  if (action === "sleep.extend") {
    const minutes = Math.round(Number(args.minutes) || 0);
    if (!minutes) throw new Error("Say how many minutes to add.");
    const period = extendSleep(profileId, Math.max(-720, Math.min(720, minutes)));
    return { summary: describePeriod(period) };
  }

  if (action === "sleep.wake") {
    // Routed through the controller when it is on screen, so that waking by
    // voice does the same three things as waking by Tab — silence, calendar,
    // debrief — rather than only the middle one.
    const dismiss = (window as any).__romeDismissAlarm;
    if (typeof dismiss === "function") { void dismiss(); return { summary: "Alarm off." }; }
    const result = wakeNow(profileId);
    if (!result.woke) throw new Error("No sleep period is set.");
    return { summary: `${result.label} ended.` };
  }

  throw new Error(`Unsupported sleep command: ${action}`);
}

async function runFocusCommand(
  action: string,
  args: Record<string, unknown>,
  profileId: number | undefined,
): Promise<unknown> {
  const status = () => focusStatus(profileId);
  const speakable = () => {
    const value = status();
    if (!value.active) return { active: false, message: "No focus cycle is running." };
    return {
      active: true,
      task: value.taskName,
      remaining: value.awaitingAnswer ? "none" : spokenRemaining(value.remainingSeconds),
      remainingSeconds: value.remainingSeconds,
      paused: value.paused,
      awaitingAnswer: value.awaitingAnswer,
    };
  };

  if (action === "focus.status") return speakable();

  if (action === "focus.start") {
    const label = String(args.title ?? "").trim();
    if (!label) throw new Error("Which task should the cycle run on?");
    const minutes = Math.max(1, Math.min(480, Math.round(Number(args.minutes) || 25)));
    const tasks = readTasks(profileId);
    const matches = findTask(tasks, label);
    if (matches.length > 1) {
      throw new Error(`More than one task matches that name: ${matches.slice(0, 4).map(task => task.title).join(", ")}. Ask which one.`);
    }
    // Nothing matched, so this is a new intention rather than a mis-heard one.
    // Refusing here would mean "start twenty minutes on the outline" needs a
    // separate "add the outline first", which is not how anyone speaks.
    const task = matches[0] ?? createFocusTask(profileId, label);
    await startFocus(profileId, task.id, minutes);
    return { started: task.title, minutes, created: !matches.length };
  }

  if (action === "focus.pause") { pauseFocus(profileId); return speakable(); }
  if (action === "focus.resume") { resumeFocus(profileId); return speakable(); }

  if (action === "focus.extend") {
    const minutes = Math.round(Number(args.minutes) || 0);
    if (!minutes) throw new Error("How many minutes should be added?");
    await extendFocus(profileId, Math.max(-480, Math.min(480, minutes)));
    return speakable();
  }

  if (action === "focus.cancel") {
    const running = runningTask(readTasks(profileId));
    const snapshot = running?.timer ? { ...running.timer } : null;
    const cancelled = await cancelFocus(profileId);
    return { ...cancelled, timer: snapshot };
  }

  if (action === "focus.restore") {
    const taskId = String(args.taskId ?? "");
    const timer = args.timer as FocusTimer | undefined;
    if (!taskId || !timer) throw new Error("Nothing to restore.");
    restoreFocus(profileId, taskId, timer);
    return speakable();
  }

  if (action === "focus.complete") {
    const label = String(args.title ?? "").trim();
    const tasks = readTasks(profileId);
    let target = label ? findTask(tasks, label) : [];
    if (label && target.length > 1) {
      throw new Error(`More than one task matches that name: ${target.slice(0, 4).map(task => task.title).join(", ")}. Ask which one.`);
    }
    const task = target[0] ?? (label ? null : runningTask(tasks));
    if (!task) throw new Error(label ? `No task matches "${label}".` : "No focus cycle is running.");
    return await completeFocusTask(profileId, task.id);
  }

  if (action === "focus.restore_task") {
    const taskId = String(args.taskId ?? "");
    if (!taskId) throw new Error("Which task should be reopened?");
    restoreFocusTask(profileId, taskId);
    return { reopened: taskId };
  }

  throw new Error(`Unsupported focus command: ${action}`);
}

async function runRendererCommand(action: string, args: Record<string, unknown>): Promise<unknown> {
  const profile = queryClient.getQueryData<{ id?: number }>(["/api/active-profile"]);
  const profileId = profile?.id ?? "default";
  const taskKey = `rome_task_stabilizer_v1:${profileId}`;
  const readTasks = () => {
    try { const value = JSON.parse(localStorage.getItem(taskKey) ?? "[]"); return Array.isArray(value) ? value : []; }
    catch { return []; }
  };
  const writeTasks = (tasks: unknown[]) => {
    localStorage.setItem(taskKey, JSON.stringify(tasks));
    window.dispatchEvent(new CustomEvent("rome:task-stabilizer:refresh"));
  };
  if (action === "navigate") {
    const route = String(args.route ?? "");
    if (!route.startsWith("/")) throw new Error("Invalid ROME route.");
    window.location.hash = `#${route}`;
    // The map sits over the whole app, so navigating underneath it changes a
    // page the user cannot see. Taking them to a page means taking them out of
    // the constellation — the overlay already exposes this for widgets that
    // navigate, and Akira is one more thing that navigates.
    try { (window as any).__romeCloseConstellation?.(); } catch { /* no map open */ }
    return { route };
  }
  // Akira's capabilities run in the main process, which has no localStorage and
  // therefore no session token. Without one the server falls back to the active
  // profile — which is usually the same account, and silently is not: writes
  // land under a different user than the app is reading as, so an event that
  // was really created is nowhere to be seen.
  if (action === "auth.token") return { token: getToken(), profileId: profile?.id ?? null };
  if (action === "task-stabilizer.list") return readTasks();
  if (action === "task-stabilizer.create") {
    const task = { id: crypto.randomUUID(), title: String(args.title ?? "").trim(), createdAt: Date.now(), completedAt: null, timer: null };
    if (!task.title) throw new Error("Task title is required.");
    writeTasks([task, ...readTasks()]);
    return task;
  }
  if (action === "task-stabilizer.update") {
    const id = String(args.id ?? "");
    let found = false;
    const tasks = readTasks().map((task: any) => {
      if (task.id !== id) return task;
      found = true;
      return {
        ...task,
        ...(typeof args.title === "string" && args.title.trim() ? { title: args.title.trim() } : {}),
        ...(typeof args.completed === "boolean" ? { completedAt: args.completed ? Date.now() : null, timer: args.completed ? null : task.timer } : {}),
      };
    });
    if (!found) throw new Error("Task Stabilizer item was not found.");
    writeTasks(tasks);
    return tasks.find((task: any) => task.id === id);
  }
  if (action === "task-stabilizer.delete") {
    const id = String(args.id ?? "");
    const before = readTasks();
    const tasks = before.filter((task: any) => task.id !== id);
    if (tasks.length === before.length) throw new Error("Task Stabilizer item was not found.");
    writeTasks(tasks);
    return { deletedId: id };
  }
  if (action.startsWith("focus.")) return runFocusCommand(action, args, profileId === "default" ? undefined : profileId as number);
  if (action.startsWith("sleep.")) return runSleepCommand(action, args, profileId === "default" ? undefined : profileId as number);
  if (action === "finance.summary") {
    const state = loadFinancialState(profileId);
    const projection = projectFinancials(state);
    return {
      asOf: new Date().toISOString(),
      currentBalance: state.currentBalance,
      projectedMonthEnd: projection.projectedMonthEnd,
      committedOutflow: projection.committedOutflow,
      remainingIncome: projection.remainingIncome,
      safeDailySpend: projection.safeDailySpend,
      healthScore: projection.healthScore,
      plannedExpenses: state.expenses.length,
      creditAccounts: state.creditAccounts.length,
      loans: state.loans.length,
      disclaimer: "ROME planning data only; not a bank balance or financial advice.",
    };
  }
  if (action === "finance.add-expense") {
    const state = loadFinancialState(profileId);
    const recurrenceMap: Record<string, Recurrence> = { weekly: "weekly", monthly: "monthly", annual: "annual", "one-time": "once", once: "once" };
    const kindMap: Record<string, ExpenseKind> = { subscription: "subscription", membership: "membership", recurring: "recurring", discretionary: "discretionary" };
    const expense = {
      id: makeId("expense"),
      name: String(args.name ?? "").trim(),
      amount: Math.max(0, Number(args.amount) || 0),
      date: toDateInput(new Date()),
      recurrence: recurrenceMap[String(args.frequency ?? "monthly").toLowerCase()] ?? "monthly",
      kind: kindMap[String(args.category ?? "recurring").toLowerCase()] ?? "recurring",
      paymentSource: "cash" as const,
    };
    if (!expense.name || expense.amount <= 0) throw new Error("A name and positive amount are required.");
    state.expenses.push(expense);
    saveFinancialState(state, profileId);
    window.dispatchEvent(new CustomEvent("rome:finance:refresh"));
    return expense;
  }
  if (action === "finance.delete-expense") {
    const state = loadFinancialState(profileId);
    const id = String(args.id ?? "");
    const next = state.expenses.filter(expense => expense.id !== id);
    if (next.length === state.expenses.length) throw new Error("Expense was not found.");
    state.expenses = next;
    saveFinancialState(state, profileId);
    window.dispatchEvent(new CustomEvent("rome:finance:refresh"));
    return { deletedId: id };
  }
  if (action === "context.snapshot") {
    const tasks = readTasks();
    const financial = loadFinancialState(profileId);
    return {
      route: window.location.hash.replace(/^#/, "") || "/",
      local: {
        taskStabilizer: { active: tasks.filter((task: any) => !task.completedAt).length, completed: tasks.filter((task: any) => task.completedAt).length },
        finance: { configured: financial.currentBalance !== 0 || financial.expenses.length > 0, plannedExpenses: financial.expenses.length },
      },
    };
  }
  throw new Error(`Unsupported renderer command: ${action}`);
}
