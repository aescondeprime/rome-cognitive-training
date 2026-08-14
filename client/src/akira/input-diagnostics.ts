import { useSyncExternalStore } from "react";

export type AkiraInputPhase =
  | "standby"
  | "requesting"
  | "armed"
  | "recording"
  | "speech"
  | "transcribing"
  | "recognized"
  | "error";

export interface AkiraInputDiagnostics {
  phase: AkiraInputPhase;
  rms: number;
  level: number;
  threshold: number;
  speechDetected: boolean;
  deviceLabel: string;
  lastTranscript: string;
  lastError: string;
  updatedAt: number;
}

let current: AkiraInputDiagnostics = {
  phase: "standby",
  rms: 0,
  level: 0,
  threshold: 0.012,
  speechDetected: false,
  deviceLabel: "",
  lastTranscript: "",
  lastError: "",
  updatedAt: Date.now(),
};

const listeners = new Set<() => void>();

export function publishInputDiagnostics(patch: Partial<AkiraInputDiagnostics>): void {
  current = { ...current, ...patch, updatedAt: Date.now() };
  listeners.forEach(listener => listener());
}

export function useInputDiagnostics(): AkiraInputDiagnostics {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => current,
  );
}
