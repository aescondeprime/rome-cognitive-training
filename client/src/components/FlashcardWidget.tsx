/**
 * FlashcardWidget — the Flashcard Archive on the constellation.
 *
 * A card at a time, front first: click to turn it over, then say whether you
 * had it. That is the whole interaction, and it is deliberately the smallest
 * one that still counts — the widget floats over the map, so anything needing
 * more than a glance and two clicks would not get used.
 *
 * **It draws what is due, not what exists.** ROME's `recall_items` already
 * carry SM-2 scheduling and expose a `/due` endpoint, so the widget shows the
 * cards whose interval has elapsed and answers with a quality that advances the
 * schedule. The Flashcard Archive writes these rows, the Memory Vault lists
 * them, and the memorization drills in Athena Trials will read the same ones.
 * One store, several surfaces.
 *
 * **A folder can be chosen, and the choice sticks.** Studying is usually one
 * subject at a time, and a widget that hands you a card from whatever happened
 * to come due makes the two subjects interleave whether you wanted that or not.
 * The choice is stored rather than held in state because the widget unmounts
 * every time the constellation closes.
 *
 * Drag, collapse and the corner brackets follow the other widgets exactly; the
 * accent is the Archive's amber rather than a fifth colour on the map.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  DEFAULT_FOLDER, fetchDueFlashcards, fetchFlashcards, FLASHCARDS_DUE_KEY, FLASHCARDS_KEY,
  foldersOf, type Flashcard,
} from "@/lib/flashcards";
import {
  widgetRootStyle,
  useWidgetFit,
  useWidgetWheelScale,
  useWidgetYield,
  widgetYieldStyle,
  WidgetScaleHandle,
  WidgetPinButton,
  type FocusRect,
} from "./WidgetChrome";

interface Props {
  pos: { x: number; y: number } | null;
  collapsed: boolean;
  onPosChange: (p: { x: number; y: number }) => void;
  onCollapsedChange: (c: boolean) => void;
  /** Uniform scale and the editor's resize affordances. See `WidgetChrome`. */
  scale?: number;
  editing?: boolean;
  onScaleChange?: (scale: number) => void;
  /** Set while the camera has flown to a node; `focus` is the space it claims. */
  zoomed?: boolean;
  focus?: FocusRect | null;
  /** Pinned widgets stay on screen away from the constellation. */
  pinned?: boolean;
  onPinnedChange?: (pinned: boolean) => void;
}

const W = 250;
const AMBER = "hsl(35 80% 62%)";
/** Which folder this widget is showing. Null, or absent, means all of them. */
const FOLDER_KEY = "rome.flashcards.widgetFolder";

function storedFolder(): string | null {
  try { return window.localStorage.getItem(FOLDER_KEY); } catch { return null; }
}

function rememberFolder(name: string | null): void {
  try {
    if (name) window.localStorage.setItem(FOLDER_KEY, name);
    else window.localStorage.removeItem(FOLDER_KEY);
  } catch { /* private mode */ }
}

/**
 * SM-2 quality, from the two answers a person can honestly give at a glance.
 *
 * The algorithm takes 0–5. Offering five buttons on a floating widget would be
 * a questionnaire; 5 and 2 are "knew it" and "did not", and 2 is below the
 * threshold that resets the interval, which is the behaviour that matters.
 */
const KNEW = 5;
const MISSED = 2;

function Corner() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ opacity: 0.7, flexShrink: 0 }}>
      <path d="M2 12 L2 2 L12 2" stroke={AMBER} strokeWidth="1.5" />
      <circle cx="2" cy="2" r="1.2" fill={AMBER} />
    </svg>
  );
}

export default function FlashcardWidget({ pos, collapsed, onPosChange, onCollapsedChange, scale = 1, editing = false, onScaleChange, zoomed = false, focus = null, pinned = false, onPinnedChange }: Props) {
  const DEFAULT_X = 24;
  const DEFAULT_Y = 560;
  const x = pos?.x ?? DEFAULT_X;
  const y = pos?.y ?? DEFAULT_Y;

  // Editor sizing and keep-on-screen. Scale is a transform, not a re-layout —
  // see the note at the top of `WidgetChrome`. `useWidgetFit` is what stops a
  // widget saved on a larger display from sitting past the edge of this one.
  const rootRef = useRef<HTMLDivElement>(null);
  const onWheelScale = useWidgetWheelScale(editing, scale, onScaleChange);
  useWidgetFit(rootRef, x, y, onPosChange, [scale, collapsed]);
  // Selecting a node flies it to screen centre, straight under any widget
  // parked there. Yielding is a fade, not a move — see `useWidgetYield`.
  const yielding = useWidgetYield(rootRef, zoomed, focus, [x, y, scale, collapsed]);

  const qc = useQueryClient();
  const [index, setIndex] = useState(0);
  const [turned, setTurned] = useState(false);
  const [folder, setFolder] = useState<string | null>(() => storedFolder());

  const { data: dueAll = [], isLoading } = useQuery<Flashcard[]>({
    queryKey: FLASHCARDS_DUE_KEY,
    queryFn: fetchDueFlashcards,
    staleTime: 30_000,
  });
  const { data: all = [] } = useQuery<Flashcard[]>({
    queryKey: FLASHCARDS_KEY,
    queryFn: fetchFlashcards,
    staleTime: 60_000,
  });

  const folders = useMemo(() => foldersOf(all), [all]);
  const inFolder = (item: Flashcard) => !folder || (item.category || DEFAULT_FOLDER) === folder;
  const due = dueAll.filter(inFolder);

  const card: Flashcard | undefined = due[index];

  // A folder emptied or renamed elsewhere must not leave the widget filtering
  // on something that no longer exists and showing nothing for ever.
  useEffect(() => {
    if (folder && all.length && !folders.some(item => item.name === folder)) {
      setFolder(null);
      rememberFolder(null);
    }
  }, [all.length, folder, folders]);

  // A card answered leaves the due list, so the index would skip the one that
  // slid into its place.
  useEffect(() => { if (index >= due.length) setIndex(0); }, [due.length, index]);

  const review = useMutation({
    mutationFn: ({ id, quality }: { id: number; quality: number }) =>
      apiRequest("PATCH", `/api/recall-items/${id}/review`, { quality }).then(r => r.json()),
    onSuccess: () => {
      setTurned(false);
      qc.invalidateQueries({ queryKey: FLASHCARDS_DUE_KEY });
      qc.invalidateQueries({ queryKey: FLASHCARDS_KEY });
    },
  });

  /* ── Drag, identical to the other widgets ──────────────────────────── */

  const dragging = useRef(false);
  const dragOffset = useRef({ dx: 0, dy: 0 });

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-nodrag]")) return;
    e.preventDefault();
    dragging.current = true;
    dragOffset.current = { dx: e.clientX - x, dy: e.clientY - y };
    const onMove = (me: MouseEvent) => {
      if (!dragging.current) return;
      onPosChange({
        x: Math.max(0, Math.min(window.innerWidth - W, me.clientX - dragOffset.current.dx)),
        y: Math.max(0, Math.min(window.innerHeight - 60, me.clientY - dragOffset.current.dy)),
      });
    };
    const onUp = () => { dragging.current = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [x, y, onPosChange]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest("[data-nodrag]")) return;
    const touch = e.touches[0];
    dragging.current = true;
    dragOffset.current = { dx: touch.clientX - x, dy: touch.clientY - y };
    const onMove = (te: TouchEvent) => {
      if (!dragging.current) return;
      const t = te.touches[0];
      onPosChange({
        x: Math.max(0, Math.min(window.innerWidth - W, t.clientX - dragOffset.current.dx)),
        y: Math.max(0, Math.min(window.innerHeight - 60, t.clientY - dragOffset.current.dy)),
      });
    };
    const onEnd = () => { dragging.current = false; window.removeEventListener("touchmove", onMove); window.removeEventListener("touchend", onEnd); };
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
  }, [x, y, onPosChange]);

  return (
    <div
      ref={rootRef}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      onWheel={editing ? onWheelScale : undefined}
      style={widgetRootStyle(x, y, W, scale, widgetYieldStyle(yielding))}
    >
      {editing && <WidgetScaleHandle scale={scale} onScaleChange={onScaleChange} width={W} />}
      <div className={`rome-widget-shell${editing ? " is-editing" : ""}${zoomed ? " is-zoomed" : ""}`}>

        <div
          className={collapsed ? undefined : "rome-widget-rule"}
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "6px 10px 5px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Corner />
            <span style={{ fontSize: 9, letterSpacing: "0.22em", color: AMBER, textTransform: "uppercase" }}>Flashcards</span>
            {!isLoading && due.length > 0 && (
              <span style={{
                fontSize: 7.5, letterSpacing: "0.1em", color: AMBER,
                background: "hsl(35 40% 10% / 0.8)", border: "1px solid hsl(35 40% 22% / 0.6)",
                borderRadius: 2, padding: "1px 5px",
              }}>{due.length}</span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {!collapsed && folders.length > 1 && (
              <select
                data-nodrag="1"
                value={folder ?? ""}
                onChange={event => { const next = event.target.value || null; setFolder(next); rememberFolder(next); setIndex(0); setTurned(false); }}
                title="Which folder this widget draws from"
                style={{
                  maxWidth: 96, background: "hsl(222 20% 4%)", color: "hsl(35 40% 62%)",
                  border: "1px solid hsl(35 30% 20%)", borderRadius: 2, fontSize: 7.5,
                  letterSpacing: "0.1em", padding: "1px 3px", outline: "none",
                  fontFamily: "DM Mono, monospace",
                }}>
                <option value="">ALL</option>
                {folders.map(item => <option key={item.name} value={item.name}>{item.name.toUpperCase()}</option>)}
              </select>
            )}
            <WidgetPinButton pinned={pinned} onPinnedChange={onPinnedChange} />
            <button data-nodrag="1" onClick={() => onCollapsedChange(!collapsed)} title={collapsed ? "Expand" : "Collapse"}
            style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 4px", color: "hsl(35 30% 45%)", fontSize: 11, lineHeight: 1 }}>
            {collapsed ? "▸" : "▾"}
            </button>
          </div>
        </div>

        {!collapsed && (
          <div style={{ padding: "10px 10px 9px" }}>
            {isLoading && <p style={{ fontSize: 8.5, color: "hsl(35 20% 40%)", letterSpacing: "0.12em" }}>LOADING…</p>}

            {!isLoading && !card && (
              <div style={{ textAlign: "center", padding: "10px 4px" }}>
                <p style={{ fontSize: 9, color: "hsl(35 25% 48%)", letterSpacing: "0.1em" }}>
                  {all.length === 0 ? "NO CARDS YET" : "NOTHING DUE"}
                </p>
                <p style={{ fontSize: 7.5, lineHeight: 1.5, color: "hsl(220 10% 38%)", marginTop: 5 }}>
                  {all.length === 0
                    ? "Write one in the Flashcard Archive, or keep a question after a Quantum Recall round."
                    : folder
                      ? `Nothing due in ${folder}.`
                      : `${all.length} card${all.length === 1 ? "" : "s"} waiting on their interval.`}
                </p>
              </div>
            )}

            {card && (
              <div data-nodrag="1">
                <button
                  onClick={() => setTurned(t => !t)}
                  title={turned ? "Show the front" : "Turn it over"}
                  style={{
                    display: "block", width: "100%", textAlign: "left", cursor: "pointer",
                    background: turned ? "hsl(35 30% 9% / 0.6)" : "hsl(222 20% 4% / 0.7)",
                    border: `1px solid ${turned ? "hsl(35 40% 26% / 0.7)" : "hsl(220 18% 15%)"}`,
                    borderRadius: 2, padding: "10px 10px", minHeight: 78,
                    transition: "background 0.15s, border-color 0.15s",
                  }}>
                  <p style={{ fontSize: 7, letterSpacing: "0.2em", color: "hsl(220 10% 34%)", marginBottom: 5 }}>
                    {turned ? "BACK" : "FRONT"}
                  </p>
                  <p style={{
                    fontSize: 10.5, lineHeight: 1.55, whiteSpace: "pre-wrap",
                    color: turned ? "hsl(35 30% 78%)" : "hsl(214 20% 76%)",
                  }}>
                    {turned ? card.back : card.front}
                  </p>
                </button>

                {turned ? (
                  <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                    <button onClick={() => review.mutate({ id: card.id, quality: MISSED })} disabled={review.isPending}
                      style={{
                        flex: 1, cursor: "pointer", borderRadius: 2, padding: "5px 0",
                        background: "hsl(350 30% 9%)", border: "1px solid hsl(350 40% 28%)",
                        color: "hsl(350 60% 70%)", fontSize: 8, letterSpacing: "0.16em",
                      }}>MISSED</button>
                    <button onClick={() => review.mutate({ id: card.id, quality: KNEW })} disabled={review.isPending}
                      style={{
                        flex: 1, cursor: "pointer", borderRadius: 2, padding: "5px 0",
                        background: "hsl(150 28% 9%)", border: "1px solid hsl(150 38% 26%)",
                        color: "hsl(150 50% 66%)", fontSize: 8, letterSpacing: "0.16em",
                      }}>KNEW IT</button>
                  </div>
                ) : (
                  <p style={{ fontSize: 7.5, letterSpacing: "0.14em", color: "hsl(220 10% 34%)", marginTop: 7, textAlign: "center" }}>
                    CLICK TO TURN OVER
                  </p>
                )}

                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
                  <span style={{ fontSize: 7, letterSpacing: "0.14em", color: "hsl(220 10% 32%)", textTransform: "uppercase" }}>
                    {card.category || "general"}
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 7, color: "hsl(220 10% 30%)" }}>
                    {index + 1}/{due.length}
                  </span>
                  <button onClick={() => { setTurned(false); setIndex(i => (i + 1) % Math.max(1, due.length)); }}
                    title="Skip for now"
                    style={{ background: "none", border: "none", cursor: "pointer", color: "hsl(35 25% 42%)", fontSize: 9, padding: 0 }}>
                    SKIP ▸
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
