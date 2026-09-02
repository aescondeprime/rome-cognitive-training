/**
 * Which note the Knowledge Forge has open.
 *
 * Recall State drills the current note, and "current" has to mean the note the
 * Forge is showing *now* — not the one that happened to be open when the run
 * was entered. That was the bug behind THIS NOTE naming a note you had since
 * navigated away from: the id was written once, on the way in, and nothing ever
 * updated it.
 *
 * So the pointer lives outside both screens and is written every time the
 * selection changes. It is a single id in storage plus a subscription, rather
 * than React state, because the two readers are on different sides of the
 * router and one of them (the session provider) outlives the page that sets it.
 *
 * Storage events do not fire in the tab that wrote the value, so a same-tab
 * event is dispatched alongside; a second window still hears the storage one.
 */

const KEY = "rome.academia.activeNote";
const EVENT = "rome:academia:active-note";

function store(): Storage | null {
  try {
    const value = window.localStorage;
    value.setItem("__rome_probe__", "1");
    value.removeItem("__rome_probe__");
    return value;
  } catch {
    return null;
  }
}

export function getActiveNoteId(): string | null {
  return store()?.getItem(KEY) || null;
}

export function setActiveNoteId(id: string | null): void {
  const current = getActiveNoteId();
  if (current === id) return;
  try {
    if (id) store()?.setItem(KEY, id);
    else store()?.removeItem(KEY);
  } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: id }));
}

/** Returns the unsubscribe, so a caller can be an ordinary effect. */
export function onActiveNoteChange(listener: (id: string | null) => void): () => void {
  const local = () => listener(getActiveNoteId());
  const remote = (event: StorageEvent) => { if (event.key === KEY) listener(getActiveNoteId()); };
  window.addEventListener(EVENT, local);
  window.addEventListener("storage", remote);
  return () => {
    window.removeEventListener(EVENT, local);
    window.removeEventListener("storage", remote);
  };
}
