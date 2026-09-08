/**
 * The focus cycle — one task, one clock, one source of truth.
 *
 * The cycle used to live inside `TaskStabilizerWidget` as local React state.
 * That was fine while the widget was the only thing that cared, and stopped
 * being fine the moment three other things did: the top bar draws the clock,
 * Akira starts and extends and cancels cycles by voice, and something has to
 * speak at five minutes, one minute, and zero whether either of those is on
 * screen or not.
 *
 * So the cycle lives here, over the same profile-scoped localStorage the
 * stabilizer already used, and every writer goes through these functions.
 * Writes announce themselves with `rome:task-stabilizer:refresh`, which the
 * widget already listens for — two writers, one file, no shared state to get
 * out of step.
 *
 * Kronos stays in step the same way it always did: a running cycle owns an
 * assignment on today's calendar, extended when the cycle is extended and
 * squared up to the real elapsed time when it completes.
 */

import { matchByLabel } from "@shared/akira";
import {
  elapsedSeconds, extendTimer, formatRemaining, normalizeTimer, remainingSeconds, spokenRemaining,
  type FocusTimer,
} from "@shared/focusClock";
import { apiRequest } from "@/lib/queryClient";
import {
  addEntry, loadCapability, notifyCapabilityChanged, removeEntryForTask, saveCapability,
} from "@/lib/capabilityStore";

export const DEFAULT_CREDIT = 10;

// Re-exported so the widget, the top bar and Akira all take the clock from one
// place rather than each importing half of it.
export {
  elapsedSeconds, formatRemaining, normalizeTimer, remainingSeconds, spokenRemaining,
  type FocusTimer,
};

export interface StabilizerTask {
  id: string;
  title: string;
  createdAt: number;
  completedAt: number | null;
  timer: FocusTimer | null;
  /** "YYYY-MM-DD", or null for undated. Mirrored into Kronos when set. */
  dueDate: string | null;
  /** The Kronos assignment this task's due date owns, if any. */
  kronosItemId: number | null;
  /** What finishing this task is worth in the Capability ledger. */
  credit: number;
}

export interface FocusStatus {
  active: boolean;
  awaitingAnswer: boolean;
  paused: boolean;
  taskId: string | null;
  taskName: string;
  remainingSeconds: number;
  elapsedSeconds: number;
  durationMinutes: number;
  progress: number;
}

export const IDLE_FOCUS: FocusStatus = {
  active: false, awaitingAnswer: false, paused: false, taskId: null,
  taskName: "", remainingSeconds: 0, elapsedSeconds: 0, durationMinutes: 0, progress: 0,
};

export function storageKey(profileId: number | undefined): string {
  return `rome_task_stabilizer_v1:${profileId ?? "default"}`;
}

const emptyAnnounced = (): FocusTimer["announced"] => ({});

/**
 * Read and normalise.
 *
 * Tasks written before due dates, credit, or pausing existed are missing those
 * fields entirely, so every read backfills them. Without this, `task.credit` is
 * `undefined`, `clampCredit` turns that into 0, and every task you had before
 * today silently becomes worth nothing.
 */
export function readTasks(profileId: number | undefined): StabilizerTask[] {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(profileId)) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.map((t: any): StabilizerTask => ({
      id: String(t?.id ?? crypto.randomUUID()),
      title: String(t?.title ?? ""),
      createdAt: Number(t?.createdAt) || Date.now(),
      completedAt: t?.completedAt ?? null,
      timer: normalizeTimer(t?.timer),
      dueDate: typeof t?.dueDate === "string" && t.dueDate ? t.dueDate : null,
      kronosItemId: typeof t?.kronosItemId === "number" ? t.kronosItemId : null,
      credit: Number.isFinite(Number(t?.credit)) ? Math.max(0, Math.round(Number(t.credit))) : DEFAULT_CREDIT,
    }));
  } catch {
    return [];
  }
}

export function writeTasks(profileId: number | undefined, tasks: StabilizerTask[]): void {
  localStorage.setItem(storageKey(profileId), JSON.stringify(tasks));
  window.dispatchEvent(new CustomEvent("rome:task-stabilizer:refresh"));
}

/** Apply a change to one task and persist it. Returns the updated task. */
function patch(
  profileId: number | undefined,
  taskId: string,
  change: (task: StabilizerTask) => StabilizerTask,
): StabilizerTask | null {
  const tasks = readTasks(profileId);
  let updated: StabilizerTask | null = null;
  const next = tasks.map(task => {
    if (task.id !== taskId) return task;
    updated = change(task);
    return updated;
  });
  if (!updated) return null;
  writeTasks(profileId, next);
  return updated;
}

export function runningTask(tasks: StabilizerTask[]): StabilizerTask | null {
  return tasks.find(task => task.timer && !task.completedAt) ?? null;
}

export function focusStatus(profileId: number | undefined, now = Date.now()): FocusStatus {
  const task = runningTask(readTasks(profileId));
  if (!task?.timer) return IDLE_FOCUS;
  const elapsed = elapsedSeconds(task.timer, now);
  const remaining = remainingSeconds(task.timer, now);
  return {
    active: true,
    awaitingAnswer: Boolean(task.timer.endedAt),
    paused: task.timer.pausedAt !== null,
    taskId: task.id,
    taskName: task.title,
    remainingSeconds: remaining,
    elapsedSeconds: elapsed,
    durationMinutes: Math.round(task.timer.durationSeconds / 60),
    progress: Math.min(1, elapsed / Math.max(1, task.timer.durationSeconds)),
  };
}

function localDateStr(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localTimeStr(date = new Date()): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

async function ensureCalendarId(): Promise<number | null> {
  try {
    const existing = await apiRequest("GET", "/api/kronos/calendars").then(r => r.json());
    if (Array.isArray(existing) && existing[0]?.id) return Number(existing[0].id);
    const created = await apiRequest("POST", "/api/kronos/calendars", { name: "My Calendar" }).then(r => r.json());
    return created?.id ? Number(created.id) : null;
  } catch {
    return null;
  }
}

function notifyKronos(): void {
  window.dispatchEvent(new CustomEvent("rome:kronos:refresh"));
}

/**
 * Start a cycle.
 *
 * One cycle at a time, by design: the whole point of the stabilizer is that
 * focus is singular. Starting a second one while the first runs is a mistake
 * worth refusing rather than silently resolving.
 */
export async function startFocus(
  profileId: number | undefined,
  taskId: string,
  minutes: number,
): Promise<StabilizerTask> {
  const tasks = readTasks(profileId);
  const existing = runningTask(tasks);
  if (existing && existing.id !== taskId) {
    throw new Error(`A focus cycle is already running on "${existing.title}". Finish or cancel it first.`);
  }
  const task = tasks.find(item => item.id === taskId);
  if (!task) throw new Error("That task is no longer in the focus queue.");
  const planned = Math.max(1, Math.round(minutes));

  // The clock starts now. The calendar row is a convenience, not a
  // precondition, and it used to be awaited — which put a Supabase round trip
  // between "start twenty-five minutes" and anything happening, long enough
  // that Akira reported the action as still running.
  const started = patch(profileId, taskId, item => ({
    ...item,
    completedAt: null,
    timer: {
      startedAt: Date.now(),
      durationSeconds: planned * 60,
      kronosAssignmentId: null,
      pausedAt: null,
      pausedMs: 0,
      endedAt: null,
      announced: emptyAnnounced(),
    },
  }));
  if (!started) throw new Error("That task is no longer in the focus queue.");
  void attachCalendarRow(profileId, taskId, task.title, planned);
  return started;
}

/**
 * Put the cycle on today's calendar, after the fact.
 *
 * Written back onto whatever timer is running when it returns, and quietly
 * abandoned if the cycle was already cancelled or finished by then — a
 * calendar row for a cycle that no longer exists is worse than none.
 */
async function attachCalendarRow(
  profileId: number | undefined,
  taskId: string,
  title: string,
  planned: number,
): Promise<void> {
  try {
    const calendarId = await ensureCalendarId();
    if (!calendarId) return;
    const response = await apiRequest("POST", `/api/kronos/calendars/${calendarId}/assignments`, {
      title,
      color: "hsl(43 88% 60%)",
      start_time: localTimeStr(),
      duration_minutes: planned,
      due_date: localDateStr(),
      instructions: `Task Stabilizer focus cycle · planned ${planned} minutes`,
      saved: false,
    });
    const assignment = await response.json();
    const id = assignment?.id ?? null;
    if (id === null) return;
    const current = runningTask(readTasks(profileId));
    if (current?.id !== taskId || !current.timer || current.timer.kronosAssignmentId !== null) return;
    patch(profileId, taskId, item => ({ ...item, timer: { ...item.timer!, kronosAssignmentId: id } }));
    notifyKronos();
  } catch { /* the cycle runs offline */ }
}

export function pauseFocus(profileId: number | undefined): FocusStatus {
  const task = runningTask(readTasks(profileId));
  if (!task?.timer) throw new Error("No focus cycle is running.");
  if (task.timer.pausedAt) return focusStatus(profileId);
  patch(profileId, task.id, item => ({ ...item, timer: { ...item.timer!, pausedAt: Date.now() } }));
  return focusStatus(profileId);
}

export function resumeFocus(profileId: number | undefined): FocusStatus {
  const task = runningTask(readTasks(profileId));
  if (!task?.timer) throw new Error("No focus cycle is running.");
  const pausedAt = task.timer.pausedAt;
  if (!pausedAt) return focusStatus(profileId);
  patch(profileId, task.id, item => ({
    ...item,
    timer: { ...item.timer!, pausedAt: null, pausedMs: item.timer!.pausedMs + Math.max(0, Date.now() - pausedAt) },
  }));
  return focusStatus(profileId);
}

/**
 * Add time.
 *
 * Also the answer to "no, I didn't finish": the clock reopens from where it
 * stopped, the announcements for the new stretch are re-armed, and the Kronos
 * row grows rather than a second one appearing beside it.
 */
export async function extendFocus(profileId: number | undefined, minutes: number): Promise<FocusStatus> {
  const task = runningTask(readTasks(profileId));
  if (!task?.timer) throw new Error("No focus cycle is running.");
  patch(profileId, task.id, item => ({ ...item, timer: extendTimer(item.timer!, minutes) }));

  const timer = runningTask(readTasks(profileId))?.timer;
  if (timer?.kronosAssignmentId) {
    void apiRequest("PATCH", `/api/kronos/assignments/${timer.kronosAssignmentId}`, {
      duration_minutes: Math.max(1, Math.round(timer.durationSeconds / 60)),
    }).then(notifyKronos).catch(() => undefined);
  }
  return focusStatus(profileId);
}

/** Stop the clock and leave the task where it was. */
export async function cancelFocus(profileId: number | undefined): Promise<{ taskId: string; taskName: string }> {
  const task = runningTask(readTasks(profileId));
  if (!task?.timer) throw new Error("No focus cycle is running.");
  const assignmentId = task.timer.kronosAssignmentId;
  patch(profileId, task.id, item => ({ ...item, timer: null }));
  if (assignmentId) {
    void apiRequest("DELETE", `/api/kronos/assignments/${assignmentId}`)
      .then(notifyKronos)
      .catch(() => undefined);
  }
  return { taskId: task.id, taskName: task.title };
}

/**
 * Finish a task, with or without a cycle behind it.
 *
 * Banks its credit in the Capability ledger, and squares the Kronos row up to
 * the time actually spent rather than the time planned — a 25-minute cycle
 * finished in nine minutes should read as nine.
 */
export async function completeTask(
  profileId: number | undefined,
  taskId: string,
): Promise<{ taskId: string; taskName: string; minutes: number }> {
  const tasks = readTasks(profileId);
  const task = tasks.find(item => item.id === taskId);
  if (!task) throw new Error("That task is no longer in the focus queue.");
  const timer = task.timer;
  const seconds = timer ? Math.max(1, elapsedSeconds(timer)) : 0;

  patch(profileId, taskId, item => ({ ...item, completedAt: Date.now(), timer: null }));
  saveCapability(profileId, addEntry(loadCapability(profileId), task.title, task.credit, "stabilizer", task.id));
  notifyCapabilityChanged();

  if (timer?.kronosAssignmentId) {
    const minutes = Math.max(1, Math.ceil(seconds / 60));
    // Fire and forget, like the rest: the task is finished the moment it is
    // marked finished, and Akira should be able to say so immediately.
    void apiRequest("PATCH", `/api/kronos/assignments/${timer.kronosAssignmentId}`, {
      duration_minutes: minutes,
      instructions: `Completed through Task Stabilizer · ${minutes} minute focus cycle`,
    }).then(notifyKronos).catch(() => undefined);
  }
  return { taskId, taskName: task.title, minutes: Math.max(0, Math.round(seconds / 60)) };
}

/**
 * Put a cancelled cycle back exactly as it was.
 *
 * Only used by undo. The Kronos row is gone by then and is not recreated: the
 * clock is what someone wants back, and a duplicate calendar entry is not.
 */
export function restoreFocus(profileId: number | undefined, taskId: string, timer: FocusTimer): FocusStatus {
  const restored = normalizeTimer(timer);
  if (!restored) throw new Error("That focus cycle cannot be restored.");
  patch(profileId, taskId, item => ({ ...item, completedAt: null, timer: restored }));
  return focusStatus(profileId);
}

export function restoreTask(profileId: number | undefined, taskId: string): void {
  patch(profileId, taskId, item => ({ ...item, completedAt: null }));
  saveCapability(profileId, removeEntryForTask(loadCapability(profileId), taskId));
  notifyCapabilityChanged();
}

/**
 * Find the task a spoken name refers to.
 *
 * Uses the same matcher Akira's capabilities use on the main-process side, so
 * "start the dentist one" resolves identically whether it arrives by voice or
 * by hand. Unfinished tasks are searched first.
 */
export function findTask(tasks: StabilizerTask[], label: string): StabilizerTask[] {
  const open = tasks.filter(task => !task.completedAt);
  const matches = matchByLabel(open, label, task => task.title);
  return matches.length ? matches : matchByLabel(tasks, label, task => task.title);
}

/** Add a task to the queue. Akira creates tasks it is asked to start. */
export function createTask(profileId: number | undefined, title: string, credit = DEFAULT_CREDIT): StabilizerTask {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("A task title is required.");
  const task: StabilizerTask = {
    id: crypto.randomUUID(), title: trimmed, createdAt: Date.now(),
    completedAt: null, timer: null, dueDate: null, kronosItemId: null,
    credit: Math.max(0, Math.round(credit)),
  };
  writeTasks(profileId, [task, ...readTasks(profileId)]);
  return task;
}

/** Record that something has been said, so it is said exactly once. */
export function markAnnounced(profileId: number | undefined, key: keyof FocusTimer["announced"]): void {
  const task = runningTask(readTasks(profileId));
  if (!task?.timer) return;
  patch(profileId, task.id, item => ({
    ...item,
    timer: { ...item.timer!, announced: { ...item.timer!.announced, [key]: true } },
  }));
}

/** Stamp the moment the clock hit zero, which is what starts the asking. */
export function markEnded(profileId: number | undefined): void {
  const task = runningTask(readTasks(profileId));
  if (!task?.timer || task.timer.endedAt) return;
  patch(profileId, task.id, item => ({ ...item, timer: { ...item.timer!, endedAt: Date.now() } }));
}
