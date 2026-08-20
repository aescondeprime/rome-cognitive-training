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
import { AkiraMic } from "./AkiraMic";
import { OpenWakeWord } from "./wake/OpenWakeWord";
import { loadFinancialState, saveFinancialState } from "@/lib/financialStore";
import { makeId, projectFinancials, toDateInput, type ExpenseKind, type Recurrence } from "@/lib/financialEngine";

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
  const lastVadLevelRef = useRef(0);
  const noticeTimerRef = useRef<number | null>(null);

  useEffect(() => { statusRef.current = status; }, [status]);

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

  const cancelPlayback = useCallback(() => {
    playbackGenerationRef.current += 1;
    playbackSourcesRef.current.forEach(source => {
      try { source.stop(); } catch { /* already stopped */ }
    });
    playbackSourcesRef.current.clear();
    playbackTimeRef.current = 0;
  }, []);

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
  }, [cancelPlayback, ensurePlaybackContext]);

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
        // Local level drives the ambience until the server's own VAD arrives,
        // so the glow responds on the very first syllable. Written straight to
        // CSS: React state here would re-render on every audio frame.
        const level = Math.max(0, Math.min(1, rms * 12));
        if (Math.abs(level - lastVadLevelRef.current) <= 0.04) return;
        lastVadLevelRef.current = level;
        document.documentElement.style.setProperty("--akira-vad", level.toFixed(2));
      },
      onPcm: pcm => wakeRef.current?.process(pcm),
      onError: error => showNotice(error.message, "error"),
    });
    micRef.current = mic;
    await mic.start();
    setMicrophoneArmed(true);
  }, [bridge, showNotice]);

  const disarmMicrophone = useCallback(async () => {
    const mic = micRef.current;
    micRef.current = null;
    await mic?.stop();
    setMicrophoneArmed(false);
    lastVadLevelRef.current = 0;
    document.documentElement.style.setProperty("--akira-vad", "0");
  }, []);

  /**
   * Order matters here. V2 connected first and armed the microphone second,
   * which is why the first words of every request were lost. The mic is armed
   * first — usually already open — and streaming begins with a pre-roll flush,
   * so speech from before the trigger still reaches the agent.
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
    const next = await bridge.activate(viaWakeWord);
    setStatus(next);
    micRef.current?.beginStreaming(true);
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
    const wanted = settings.input.wakeWordEnabled && status.available;

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
  }, [activate, armMicrophone, bridge, showNotice, status?.available, status?.settings.input.wakeWordEnabled]);

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
    cancelPlayback();
    void wakeRef.current?.stop();
    void disarmMicrophone();
    void playbackContextRef.current?.close();
  }, [cancelPlayback, disarmMicrophone]);

  const value = useMemo<AkiraContextValue>(() => ({
    status, transcripts, approval, microphoneArmed, notice, showNotice, panelOpen, setPanelOpen,
    activate, standby, interrupt, toggleConversation, submitText,
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
    return { route };
  }
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
