/**
 * WidgetChrome — the pieces every floating constellation widget shares.
 *
 * There are five of these widgets and they were each carrying their own copy of
 * the shell styling, the drag clamp and (soon) the resize handle. The shell
 * itself now lives in `index.css` as `.rome-widget-shell`; what has to be
 * JavaScript lives here:
 *
 *   - `widgetRootStyle`  — the fixed-position root, including the uniform scale
 *   - `useWidgetFit`     — pulls a widget back inside the viewport
 *   - `WidgetScaleHandle`— the corner grip shown only in editor mode
 *
 * Scale is a `transform`, not a re-layout. Every widget's internals are sized in
 * fixed pixels (28px clocks, 9px labels, hard-coded column widths), so letting
 * the box reflow at a new width would degrade five different layouts in five
 * different ways. Scaling the rendered result keeps each one exactly as designed
 * and simply makes it bigger or smaller.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  clampWidgetScale,
  MAX_WIDGET_SCALE,
  MIN_WIDGET_SCALE,
} from "@/lib/constellationLayout";

export interface WidgetSizingProps {
  /** Uniform scale, 0.6–1.6. Undefined is treated as 1. */
  scale?: number;
  /** True while the constellation editor is open. */
  editing?: boolean;
  onScaleChange?: (scale: number) => void;
  /** True while the camera has flown to a node. */
  zoomed?: boolean;
  /** The screen rectangle the zoomed node and its branches occupy. */
  focus?: FocusRect | null;
}

/** A screen-space rectangle, in CSS pixels from the top-left of the viewport. */
export interface FocusRect { x: number; y: number; w: number; h: number }

/** Margin kept between a widget and the edge of the screen. */
const EDGE = 10;

/**
 * The rectangle a zoomed node claims for itself.
 *
 * Selecting a node flies it to the exact centre of the screen, so a widget
 * parked in the middle of the map lands on top of the thing you just zoomed
 * into. The widget never moved — it is `position: fixed` and outside the camera
 * layer entirely — but from where you are sitting it is in the way, and that is
 * the same problem.
 *
 * Sized from what is actually drawn around a selected node: the branch fan
 * (`BRANCH_LEN` 88 + label, kept at constant screen size by the menu's `inv`
 * factor) and the hologram panel (`PANEL_W` 272 at `RADIUS` 268 from centre, on
 * whichever side the fan leaves empty — so the rectangle is symmetric, since
 * either side is possible).
 *
 * Capped as a fraction of the viewport on purpose. Uncapped, the hologram's
 * reach alone is wide enough that on a 1440px laptop a widget docked at the
 * right edge would intersect it and fade on every single zoom — which is
 * exactly the twitchiness this is supposed to prevent.
 */
export function nodeFocusRect(viewport: { w: number; h: number }): FocusRect {
  const halfW = Math.min(430, viewport.w * 0.30);
  const halfH = Math.min(250, viewport.h * 0.34);
  return {
    x: viewport.w / 2 - halfW,
    y: viewport.h / 2 - halfH,
    w: halfW * 2,
    h: halfH * 2,
  };
}

/**
 * True when this widget overlaps the zoomed node's rectangle.
 *
 * Measured rather than computed from `x`/`y`/`W`: a widget's height depends on
 * how much data loaded, and a tall agenda reaches into the middle of the screen
 * from a position that looks perfectly safe on paper.
 *
 * Deliberately *not* a reposition. Sliding widgets out of the way and back
 * would fight the placement you chose and risks persisting a position you never
 * picked. They stay exactly where you put them and simply stop being opaque.
 */
export function useWidgetYield(
  ref: React.RefObject<HTMLElement | null>,
  zoomed: boolean | undefined,
  focus: FocusRect | null | undefined,
  deps: unknown[] = [],
): boolean {
  const [yielding, setYielding] = useState(false);

  useEffect(() => {
    if (!zoomed || !focus) { setYielding(false); return; }
    const node = ref.current;
    if (!node) return;
    const r = node.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    const overlaps =
      r.left < focus.x + focus.w &&
      r.right > focus.x &&
      r.top < focus.y + focus.h &&
      r.bottom > focus.y;
    setYielding(overlaps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, zoomed, focus?.x, focus?.y, focus?.w, focus?.h, ...deps]);

  return yielding;
}

/**
 * What a yielding widget looks like. Not `display: none` — the widget fading
 * out and back is what tells you it is still there and still yours; vanishing
 * outright reads as having lost it.
 */
export function widgetYieldStyle(yielding: boolean): React.CSSProperties {
  return {
    opacity: yielding ? 0.06 : 1,
    pointerEvents: yielding ? "none" : undefined,
    transition: "opacity 320ms ease",
  };
}

/**
 * The root style shared by every widget: fixed placement, nominal width, and
 * the scale transform anchored top-left so the stored position still means the
 * widget's top-left corner at any size.
 */
export function widgetRootStyle(
  x: number,
  y: number,
  width: number,
  scale = 1,
  extra: React.CSSProperties = {},
): React.CSSProperties {
  const s = clampWidgetScale(scale);
  return {
    position: "fixed",
    left: x,
    top: y,
    width,
    zIndex: 202,
    cursor: "grab",
    userSelect: "none",
    fontFamily: "DM Mono, monospace",
    transform: s === 1 ? undefined : `scale(${s})`,
    transformOrigin: "top left",
    ...extra,
  };
}

/**
 * Keep a widget inside the window.
 *
 * The proportional remap in `refitWidgetPositions` runs first and knows only
 * each widget's nominal width; this is the pass that knows the box that
 * actually rendered — height included, scale included — and is what stops a
 * widget from hanging off the bottom of a shorter screen.
 *
 * It measures rather than computes because a widget's height depends on data
 * that arrived over the network: today's agenda has three rows or ten.
 */
export function useWidgetFit(
  ref: React.RefObject<HTMLElement | null>,
  x: number,
  y: number,
  onPosChange: (p: { x: number; y: number }) => void,
  deps: unknown[] = [],
) {
  // Read the live position inside the observer without re-subscribing on every
  // pointer move — a drag rewrites x/y sixty times a second.
  const posRef = useRef({ x, y });
  posRef.current = { x, y };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const fit = () => {
      const node = ref.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;   // not painted yet
      const maxX = Math.max(EDGE, window.innerWidth  - rect.width  - EDGE);
      const maxY = Math.max(EDGE, window.innerHeight - rect.height - EDGE);
      const { x: cx, y: cy } = posRef.current;
      const nx = Math.round(Math.min(Math.max(EDGE, cx), maxX));
      const ny = Math.round(Math.min(Math.max(EDGE, cy), maxY));
      if (nx !== Math.round(cx) || ny !== Math.round(cy)) onPosChange({ x: nx, y: ny });
    };

    // One frame of slack: on a cold start the fonts have not settled and the
    // first measurement of a text-heavy widget comes back short.
    const raf = requestAnimationFrame(fit);
    window.addEventListener("resize", fit);

    // The widget grows when its query resolves or the user expands it, and a
    // widget that was inside the screen collapsed can be outside it expanded.
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    observer?.observe(el);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", fit);
      observer?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, onPosChange, ...deps]);
}

/**
 * The corner grip. Drag it out to grow the widget, in to shrink it; double-click
 * resets to 100%. Only rendered in editor mode — the rest of the time the
 * corner belongs to the widget's own content.
 */
export function WidgetScaleHandle({
  scale = 1,
  onScaleChange,
  width,
}: {
  scale?: number;
  onScaleChange?: (scale: number) => void;
  /** Nominal (unscaled) widget width — the reference the drag is measured against. */
  width: number;
}) {
  const start = useRef({ x: 0, y: 0, scale: 1 });

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (!onScaleChange) return;
    e.preventDefault();
    e.stopPropagation();
    start.current = { x: e.clientX, y: e.clientY, scale: clampWidgetScale(scale) };

    const onMove = (ev: MouseEvent) => {
      // Diagonal distance, so pulling down-right grows and up-left shrinks.
      const delta = (ev.clientX - start.current.x + ev.clientY - start.current.y) / 2;
      onScaleChange(clampWidgetScale(start.current.scale + delta / width));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [scale, onScaleChange, width]);

  const pct = Math.round(clampWidgetScale(scale) * 100);

  return (
    <div
      data-nodrag="1"
      onMouseDown={onMouseDown}
      onDoubleClick={e => { e.stopPropagation(); onScaleChange?.(1); }}
      title={`Drag to resize · double-click to reset (${pct}%)`}
      className="rome-widget-grip"
      style={{
        position: "absolute",
        right: -7,
        bottom: -7,
        width: 16,
        height: 16,
        cursor: "nwse-resize",
        zIndex: 3,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M15 5 L15 15 L5 15" stroke="hsl(var(--accent-h) var(--accent-s) 58%)" strokeWidth="1.2" />
        <path d="M15 10 L10 15"      stroke="hsl(var(--accent-h) var(--accent-s) 58%)" strokeWidth="1"   opacity="0.75" />
        <circle cx="15" cy="15" r="1.6" fill="hsl(var(--accent-h) var(--accent-s) 62%)" />
      </svg>
      <span
        style={{
          position: "absolute",
          right: 18,
          bottom: 1,
          font: "7px 'DM Mono', monospace",
          letterSpacing: "0.1em",
          color: "hsl(var(--accent-h) 45% 52%)",
          whiteSpace: "nowrap",
          pointerEvents: "none",
        }}
      >
        {pct}%
      </span>
    </div>
  );
}

/**
 * Scroll-to-resize over a widget, mirroring what the editor already does for
 * constellation nodes. Returns undefined when not editing so the handler is not
 * attached at all outside editor mode — the page still scrolls normally.
 */
export function useWidgetWheelScale(
  editing: boolean | undefined,
  scale: number | undefined,
  onScaleChange: ((scale: number) => void) | undefined,
) {
  return useCallback((e: React.WheelEvent) => {
    if (!editing || !onScaleChange) return;
    e.preventDefault();
    e.stopPropagation();
    const step = e.deltaY < 0 ? 0.04 : -0.04;
    onScaleChange(clampWidgetScale(clampWidgetScale(scale ?? 1) + step));
  }, [editing, scale, onScaleChange]);
}

export { MIN_WIDGET_SCALE, MAX_WIDGET_SCALE, clampWidgetScale };
