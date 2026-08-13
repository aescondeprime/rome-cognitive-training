import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AkiraActivityEntry,
  AkiraApprovalRequest,
  AkiraCapabilityDescriptor,
  AkiraAudioEvent,
  AkiraDataChanged,
  AkiraRendererCommand,
  AkiraSettings,
  AkiraStatus,
  AkiraTranscriptEvent,
} from "@shared/akira";
import { queryClient } from "@/lib/queryClient";
import { loadFinancialState, saveFinancialState } from "@/lib/financialStore";
import { makeId, projectFinancials, toDateInput, type ExpenseKind, type Recurrence } from "@/lib/financialEngine";
import { publishInputDiagnostics } from "./input-diagnostics";

interface AkiraContextValue {
  status: AkiraStatus | null;
  transcripts: AkiraTranscriptEvent[];
  approval: AkiraApprovalRequest | null;
  microphoneArmed: boolean;
  panelOpen: boolean;
  setPanelOpen: (value: boolean) => void;
  activate: () => Promise<void>;
  standby: () => Promise<void>;
  interrupt: () => Promise<void>;
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
  const statusRef = useRef<AkiraStatus | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureContextRef = useRef<AudioContext | null>(null);
  const captureNodeRef = useRef<AudioWorkletNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const speechSeenRef = useRef(false);
  const lastSpeechRef = useRef(0);
  const recordingStartedRef = useRef(0);
  const discardRecordingRef = useRef(false);
  const speechFramesRef = useRef(0);
  const noiseFloorRef = useRef(0.004);
  const lastMeterUpdateRef = useRef(0);
  const bargeFramesRef = useRef(0);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const playbackTimeRef = useRef(0);
  const playbackSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const playbackGenerationRef = useRef(0);
  const continueTimerRef = useRef<number | null>(null);

  useEffect(() => { statusRef.current = status; }, [status]);

  const cancelPlayback = useCallback(() => {
    playbackGenerationRef.current += 1;
    playbackSourcesRef.current.forEach(source => {
      try { source.stop(); } catch { /* already stopped */ }
    });
    playbackSourcesRef.current.clear();
    playbackTimeRef.current = 0;
  }, []);

  const playAudio = useCallback(async (event: AkiraAudioEvent) => {
    if (event.type === "cancel") {
      cancelPlayback();
      return;
    }
    if (event.type === "start") {
      cancelPlayback();
      const context = playbackContextRef.current ?? new AudioContext({ latencyHint: "interactive", sampleRate: event.sampleRate ?? 24_000 });
      playbackContextRef.current = context;
      await context.resume();
      playbackTimeRef.current = context.currentTime + 0.025;
      return;
    }
    if (event.type !== "chunk" || !event.audio) return;
    const context = playbackContextRef.current;
    if (!context) return;
    const bytes = Uint8Array.from(atob(event.audio), character => character.charCodeAt(0));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const samples = Math.floor(bytes.byteLength / 2);
    if (!samples) return;
    const buffer = context.createBuffer(1, samples, event.sampleRate ?? 24_000);
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
  }, [cancelPlayback]);

  const finishUtterance = useCallback(async (recorder: MediaRecorder) => {
    if (!bridge) return;
    const explicitlyDiscarded = discardRecordingRef.current;
    const shouldDiscard = explicitlyDiscarded || !speechSeenRef.current;
    const chunks = recordChunksRef.current;
    recordChunksRef.current = [];
    if (shouldDiscard || !chunks.length) {
      if (!explicitlyDiscarded && !speechSeenRef.current) {
        publishInputDiagnostics({
          phase: "error",
          speechDetected: false,
          lastError: "No speech was detected. Check the input meter and microphone permission, then try again.",
        });
      }
      if (statusRef.current?.state === "LISTENING") window.setTimeout(() => startRecorder(), 80);
      return;
    }
    const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
    try {
      publishInputDiagnostics({ phase: "transcribing", lastError: "" });
      const dataUrl = await blobToDataUrl(blob);
      const result = await bridge.transcribe(dataUrl, blob.type || "audio/webm");
      const text = result.text.trim();
      if (text) {
        publishInputDiagnostics({ phase: "recognized", lastTranscript: text, lastError: "" });
        await bridge.submitText(text);
      } else {
        publishInputDiagnostics({ phase: "error", lastError: "Audio was received, but no words were recognized." });
        if (statusRef.current?.state === "LISTENING") window.setTimeout(() => startRecorder(), 80);
      }
    } catch (error) {
      publishInputDiagnostics({
        phase: "error",
        lastError: error instanceof Error ? error.message : String(error),
      });
      if (statusRef.current?.state === "LISTENING") window.setTimeout(() => startRecorder(), 200);
    }
  }, [bridge]);

  const startRecorder = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || !bridge || statusRef.current?.state !== "LISTENING") return;
    if (recorderRef.current?.state === "recording") return;
    const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(type => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred, audioBitsPerSecond: 64_000 } : undefined);
    recorderRef.current = recorder;
    recordChunksRef.current = [];
    speechSeenRef.current = false;
    speechFramesRef.current = 0;
    discardRecordingRef.current = false;
    recordingStartedRef.current = performance.now();
    lastSpeechRef.current = performance.now();
    publishInputDiagnostics({ phase: "recording", speechDetected: false });
    recorder.ondataavailable = event => { if (event.data.size) recordChunksRef.current.push(event.data); };
    recorder.onstop = () => {
      if (recorderRef.current === recorder) recorderRef.current = null;
      void finishUtterance(recorder);
    };
    recorder.start(250);
  }, [bridge, finishUtterance]);

  const stopRecorder = useCallback((discard = false) => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    discardRecordingRef.current = discard;
    recorder.stop();
  }, []);

  const handleCaptureSamples = useCallback((input: Float32Array) => {
    const current = statusRef.current;
    if (!current || !bridge) return;
    let sum = 0;
    for (let index = 0; index < input.length; index += 1) sum += input[index] * input[index];
    const rms = Math.sqrt(sum / Math.max(1, input.length));
    const now = performance.now();
    const speechThreshold = Math.max(0.011, Math.min(0.03, noiseFloorRef.current * 3));
    if (now - lastMeterUpdateRef.current >= 100) {
      lastMeterUpdateRef.current = now;
      publishInputDiagnostics({
        rms,
        level: Math.min(1, rms / 0.08),
        threshold: speechThreshold,
        phase: speechSeenRef.current ? "speech" : recorderRef.current?.state === "recording" ? "recording" : "armed",
        speechDetected: speechSeenRef.current,
      });
    }

    const playbackContext = playbackContextRef.current;
    const playbackActive = Boolean(
      playbackContext &&
      playbackSourcesRef.current.size > 0 &&
      playbackTimeRef.current > playbackContext.currentTime + 0.015,
    );
    if ((current.state === "SPEAKING" || playbackActive) && current.settings.input.bargeInEnabled) {
      const bargeThreshold = Math.max(0.035, noiseFloorRef.current * 5);
      bargeFramesRef.current = rms > bargeThreshold ? bargeFramesRef.current + 1 : 0;
      if (bargeFramesRef.current >= 4) {
        bargeFramesRef.current = 0;
        publishInputDiagnostics({ phase: "speech", speechDetected: true, lastError: "" });
        cancelPlayback();
        void bridge.interrupt().then(() => window.setTimeout(startRecorder, 50));
      }
      return;
    }
    bargeFramesRef.current = 0;
    if (current.state !== "LISTENING" || recorderRef.current?.state !== "recording") return;
    if (!speechSeenRef.current) {
      noiseFloorRef.current = (noiseFloorRef.current * 0.98) + (Math.min(rms, 0.02) * 0.02);
      speechFramesRef.current = rms > speechThreshold ? speechFramesRef.current + 1 : 0;
    }
    if (speechFramesRef.current >= 3 || (speechSeenRef.current && rms > Math.max(0.008, speechThreshold * 0.7))) {
      speechSeenRef.current = true;
      lastSpeechRef.current = now;
      publishInputDiagnostics({ phase: "speech", speechDetected: true, lastError: "" });
    }
    const silenceMs = current.settings.input.silenceMs;
    if (speechSeenRef.current && now - lastSpeechRef.current >= silenceMs) {
      stopRecorder(false);
    } else if (!speechSeenRef.current && now - recordingStartedRef.current >= 15_000) {
      stopRecorder(false);
    }
  }, [bridge, cancelPlayback, startRecorder, stopRecorder]);

  const armMicrophone = useCallback(async () => {
    if (streamRef.current) {
      if (captureContextRef.current?.state === "suspended") await captureContextRef.current.resume();
      setMicrophoneArmed(true);
      publishInputDiagnostics({ phase: "armed" });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone capture is unavailable.");
    publishInputDiagnostics({ phase: "requesting", lastError: "" });
    const deviceId = statusRef.current?.settings.input.microphoneId;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
    } catch (error) {
      publishInputDiagnostics({
        phase: "error",
        lastError: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    streamRef.current = stream;
    const context = new AudioContext({ latencyHint: "interactive" });
    captureContextRef.current = context;
    await context.resume();
    const workletSource = `class AkiraCapture extends AudioWorkletProcessor { process(inputs) { const input = inputs[0] && inputs[0][0]; if (input) this.port.postMessage(input); return true; } } registerProcessor('akira-capture', AkiraCapture);`;
    const url = URL.createObjectURL(new Blob([workletSource], { type: "text/javascript" }));
    try { await context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, "akira-capture", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    const silent = context.createGain();
    silent.gain.value = 0;
    source.connect(node).connect(silent).connect(context.destination);
    captureNodeRef.current = node;
    node.port.onmessage = event => handleCaptureSamples(new Float32Array(event.data));
    setMicrophoneArmed(true);
    publishInputDiagnostics({
      phase: "armed",
      deviceLabel: stream.getAudioTracks()[0]?.label || "Default microphone",
      lastError: "",
    });
  }, [handleCaptureSamples]);

  const disarmMicrophone = useCallback(async () => {
    stopRecorder(true);
    const node = captureNodeRef.current;
    const context = captureContextRef.current;
    const stream = streamRef.current;
    captureNodeRef.current = null;
    captureContextRef.current = null;
    streamRef.current = null;
    if (node) {
      node.port.onmessage = null;
      try { node.disconnect(); } catch { /* already disconnected */ }
    }
    stream?.getTracks().forEach(track => track.stop());
    if (context && context.state !== "closed") await context.close().catch(() => undefined);
    setMicrophoneArmed(false);
    publishInputDiagnostics({ phase: "standby", rms: 0, level: 0, speechDetected: false });
  }, [stopRecorder]);

  const activate = useCallback(async () => {
    if (!bridge) return;
    const next = await bridge.activate();
    setStatus(next);
    try {
      await armMicrophone();
    } catch (error) {
      setStatus(await bridge.standby());
      throw error;
    }
  }, [armMicrophone, bridge]);

  const standby = useCallback(async () => {
    if (!bridge) return;
    if (continueTimerRef.current) window.clearTimeout(continueTimerRef.current);
    continueTimerRef.current = null;
    stopRecorder(true);
    cancelPlayback();
    await disarmMicrophone();
    setStatus(await bridge.standby());
  }, [bridge, cancelPlayback, disarmMicrophone, stopRecorder]);

  const interrupt = useCallback(async () => {
    if (!bridge) return;
    cancelPlayback();
    const next = await bridge.interrupt();
    setStatus(next);
    await armMicrophone();
  }, [armMicrophone, bridge, cancelPlayback]);

  const submitText = useCallback(async (text: string) => {
    if (!bridge || !text.trim()) return;
    stopRecorder(true);
    setStatus(await bridge.submitText(text));
  }, [bridge, stopRecorder]);

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
      bridge.onWakeDetected(() => {
        void armMicrophone()
          .then(() => window.setTimeout(startRecorder, 30))
          .catch(() => void bridge.standby().then(value => setStatus(value)));
      }),
      bridge.onShortcut(value => { if (value?.action === "standby") void standby(); }),
    ];
    const keydown = (event: KeyboardEvent) => {
      const shortcut = statusRef.current?.settings.input.deactivationShortcut ?? "Control+Escape";
      const shiftMatches = shortcut === "Control+Shift+Escape" ? event.shiftKey : !event.shiftKey;
      if (event.key === "Escape" && event.ctrlKey && shiftMatches && !event.altKey && !event.metaKey) {
        event.preventDefault();
        void standby();
      }
    };
    window.addEventListener("keydown", keydown, true);
    return () => {
      active = false;
      remove.forEach(dispose => dispose());
      window.removeEventListener("keydown", keydown, true);
    };
  }, [armMicrophone, bridge, handleDataChanged, handleRendererCommand, playAudio, standby, startRecorder]);

  useEffect(() => {
    if (status?.state === "LISTENING" && microphoneArmed) {
      window.setTimeout(startRecorder, 30);
    } else if (status && !["LISTENING", "DORMANT", "SPEAKING"].includes(status.state)) {
      stopRecorder(true);
    }
    if (status?.state === "AWAKE_IDLE" && bridge) {
      if (continueTimerRef.current) window.clearTimeout(continueTimerRef.current);
      const context = playbackContextRef.current;
      const wait = context ? Math.max(120, (playbackTimeRef.current - context.currentTime) * 1_000 + 80) : 120;
      continueTimerRef.current = window.setTimeout(() => {
        continueTimerRef.current = null;
        if (statusRef.current?.state === "AWAKE_IDLE") {
          void activate().catch(error => publishInputDiagnostics({
            phase: "error",
            lastError: error instanceof Error ? error.message : String(error),
          }));
        }
      }, wait);
    }
  }, [activate, bridge, microphoneArmed, startRecorder, status, stopRecorder]);

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
    if (continueTimerRef.current) window.clearTimeout(continueTimerRef.current);
    stopRecorder(true);
    cancelPlayback();
    void disarmMicrophone();
    void playbackContextRef.current?.close();
  }, [cancelPlayback, disarmMicrophone, stopRecorder]);

  const value = useMemo<AkiraContextValue>(() => ({
    status, transcripts, approval, microphoneArmed, panelOpen, setPanelOpen,
    activate, standby, interrupt, submitText,
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
  }), [activate, approval, bridge, interrupt, microphoneArmed, panelOpen, standby, status, submitText, transcripts]);

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

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read microphone recording."));
    reader.readAsDataURL(blob);
  });
}
