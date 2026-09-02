/**
 * layoutStore — one live copy of the constellation layout, shared by everything
 * that reads or writes it.
 *
 * It used to live as `useState(loadLayout)` inside `ConstellationMenu`, which
 * was fine while the menu was the only thing that rendered widgets. Pinned
 * widgets break that assumption: they are mounted at the app root and outlive
 * the map, so the editor and the widget layer have to be looking at the same
 * object. Two `useState(loadLayout)` copies would drift the moment either side
 * wrote — the editor would move a widget the layer never heard about, and the
 * next write from the layer would clobber it on the way to localStorage.
 *
 * Writes are debounced. Dragging a widget rewrites the layout on every pointer
 * move, and the previous `useEffect(() => saveLayout(layout), [layout])` turned
 * that into a `JSON.stringify` plus a synchronous localStorage write sixty
 * times a second. Subscribers still see every frame; only the disk lags, and it
 * is flushed on the two events that can end a session.
 */
import { useSyncExternalStore } from "react";
import { loadLayout, saveLayout, type ConstellationLayout } from "./constellationLayout";

let current: ConstellationLayout = loadLayout();
const listeners = new Set<() => void>();

/** Trailing debounce on the disk write, ms. */
const WRITE_DELAY = 220;
let writeTimer: number | null = null;

function scheduleWrite() {
  if (typeof window === "undefined") { saveLayout(current); return; }
  if (writeTimer !== null) window.clearTimeout(writeTimer);
  writeTimer = window.setTimeout(() => { writeTimer = null; saveLayout(current); }, WRITE_DELAY);
}

/** Write immediately, if a write is pending. Called on the ways out of a session. */
export function flushLayout() {
  if (writeTimer === null) return;
  window.clearTimeout(writeTimer);
  writeTimer = null;
  saveLayout(current);
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", flushLayout);
  // `beforeunload` is unreliable on mobile and in some Electron teardowns;
  // a backgrounded window is the other moment worth persisting at.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushLayout();
  });
}

export type LayoutUpdater =
  | ConstellationLayout
  | ((prev: ConstellationLayout) => ConstellationLayout);

export function getLayout(): ConstellationLayout {
  return current;
}

export function setLayout(next: LayoutUpdater) {
  const value = typeof next === "function" ? next(current) : next;
  // Identity means nothing changed. `refitWidgetPositions` relies on this —
  // it returns its input when no widget moved, and re-notifying would loop it.
  if (value === current) return;
  current = value;
  scheduleWrite();
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * The layout, as a `useState`-shaped pair so call sites read exactly as they did
 * when this was component state.
 */
export function useConstellationLayout(): [ConstellationLayout, (next: LayoutUpdater) => void] {
  const layout = useSyncExternalStore(subscribe, getLayout, getLayout);
  return [layout, setLayout];
}

/** Re-read from disk — used by the editor's Reset, which clears the key first. */
export function reloadLayout() {
  if (writeTimer !== null) { window.clearTimeout(writeTimer); writeTimer = null; }
  current = loadLayout();
  listeners.forEach(listener => listener());
}
