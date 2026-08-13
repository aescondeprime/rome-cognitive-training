import { EventEmitter } from "node:events";
import type { AkiraState } from "../../shared/akira";

const transitions: Record<AkiraState, ReadonlySet<AkiraState>> = {
  DORMANT: new Set(["WAKE_DETECTED", "LISTENING", "UNAVAILABLE", "ERROR", "DEACTIVATING"]),
  WAKE_DETECTED: new Set(["LISTENING", "PROCESSING", "DORMANT", "ERROR", "UNAVAILABLE"]),
  LISTENING: new Set(["PROCESSING", "DORMANT", "DEACTIVATING", "ERROR", "UNAVAILABLE"]),
  PROCESSING: new Set(["SPEAKING", "ACTING", "AWAITING_APPROVAL", "AWAKE_IDLE", "LISTENING", "DORMANT", "ERROR", "UNAVAILABLE"]),
  SPEAKING: new Set(["LISTENING", "PROCESSING", "ACTING", "AWAKE_IDLE", "DEACTIVATING", "DORMANT", "ERROR", "UNAVAILABLE"]),
  ACTING: new Set(["PROCESSING", "SPEAKING", "AWAITING_APPROVAL", "AWAKE_IDLE", "DORMANT", "ERROR", "UNAVAILABLE"]),
  AWAITING_APPROVAL: new Set(["ACTING", "PROCESSING", "SPEAKING", "AWAKE_IDLE", "DORMANT", "ERROR", "UNAVAILABLE"]),
  AWAKE_IDLE: new Set(["LISTENING", "PROCESSING", "SPEAKING", "DEACTIVATING", "DORMANT", "ERROR", "UNAVAILABLE"]),
  DEACTIVATING: new Set(["DORMANT", "UNAVAILABLE", "ERROR"]),
  ERROR: new Set(["DORMANT", "UNAVAILABLE", "LISTENING", "DEACTIVATING"]),
  UNAVAILABLE: new Set(["DORMANT", "ERROR"]),
};

export interface AkiraStateChange {
  state: AkiraState;
  previous: AkiraState;
  reason: string | null;
  at: number;
}

export class AkiraStateMachine extends EventEmitter {
  private current: AkiraState;

  constructor(initial: AkiraState = "DORMANT") {
    super();
    this.current = initial;
  }

  get state(): AkiraState {
    return this.current;
  }

  can(next: AkiraState): boolean {
    return next === this.current || transitions[this.current].has(next);
  }

  transition(next: AkiraState, reason: string | null = null): AkiraStateChange {
    const previous = this.current;
    if (next === previous) return { state: next, previous, reason, at: Date.now() };
    if (!this.can(next)) {
      throw new Error(`Invalid Akira transition: ${previous} -> ${next}`);
    }
    this.current = next;
    const change = { state: next, previous, reason, at: Date.now() };
    this.emit("change", change);
    return change;
  }

  force(next: AkiraState, reason: string | null = null): AkiraStateChange {
    const previous = this.current;
    this.current = next;
    const change = { state: next, previous, reason, at: Date.now() };
    if (next !== previous) this.emit("change", change);
    return change;
  }
}

