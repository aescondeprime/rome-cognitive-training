/**
 * constellationUiState — the three facts about the map that things outside it
 * need to know.
 *
 * The widgets now live at the app root rather than inside `ConstellationMenu`
 * (see `WidgetLayer`), but they still have to behave differently while the map
 * is up: every widget is visible there, the editor's resize grips appear, and
 * a widget sitting over a zoomed node fades out of the way. None of that can be
 * passed down as props any more — the menu is a sibling of the layer, not its
 * parent — so it is published here instead.
 *
 * Deliberately not React context: the publisher is inside a portal that mounts
 * and unmounts, and a provider that comes and goes cannot wrap a consumer that
 * never does.
 */
import { useSyncExternalStore } from "react";

export interface ConstellationUiState {
  /** The map overlay is on screen (including its build/teardown transitions). */
  mapOpen: boolean;
  /** The layout editor is open, so widgets show their resize affordances. */
  editMode: boolean;
  /** The camera has flown to a node and it owns the middle of the screen. */
  zoomed: boolean;
}

let current: ConstellationUiState = { mapOpen: false, editMode: false, zoomed: false };
const listeners = new Set<() => void>();

function emit() { listeners.forEach(listener => listener()); }

export function setConstellationUi(patch: Partial<ConstellationUiState>) {
  const next = { ...current, ...patch };
  if (next.mapOpen === current.mapOpen
    && next.editMode === current.editMode
    && next.zoomed === current.zoomed) return;
  current = next;
  emit();
}

/** The map is gone: nothing about it can still be true. */
export function resetConstellationUi() {
  setConstellationUi({ mapOpen: false, editMode: false, zoomed: false });
}

export function getConstellationUi(): ConstellationUiState { return current; }

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useConstellationUi(): ConstellationUiState {
  return useSyncExternalStore(subscribe, getConstellationUi, getConstellationUi);
}
