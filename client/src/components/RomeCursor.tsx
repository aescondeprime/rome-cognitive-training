/**
 * RomeCursor — the app-wide circular cursor.
 *
 * A dot that is exactly under the pointer and a ring that trails it, lerped in
 * a single rAF loop. React state is never touched on mousemove: the loop writes
 * `transform` on two nodes it holds refs to, so the cursor costs one composite
 * per frame and cannot fall behind a re-render. The dot is never lerped — a
 * cursor that lags its own hotspot feels broken no matter how pretty the trail.
 *
 * Degrading gracefully is most of the work here:
 *
 * • Native cursor is hidden by an attribute on <html> (`data-rome-cursor`), not
 *   by a blanket stylesheet, so the moment this component decides it should not
 *   be running the real cursor comes straight back.
 * • Text inputs and textareas keep the native I-beam (see index.css) and the
 *   custom cursor hides itself over them.
 * • The World Browser paints a native WebContentsView over the DOM. This used
 *   to switch the whole cursor off for as long as /world was open, which is no
 *   longer right and was never quite the reason it looked that way. See the
 *   note on `enabled` below.
 * • Coarse pointers (touch) never activate it at all.
 */

import { useEffect, useRef, useState } from "react";

/** Things that should make the ring open up. */
const INTERACTIVE = [
  "a[href]", "button", "summary", "select", "label",
  '[role="button"]', '[role="tab"]', '[role="link"]', '[role="menuitem"]', '[role="switch"]',
  '[role="option"]', '[role="checkbox"]', '[role="radio"]', '[role="slider"]',
  'input[type="checkbox"]', 'input[type="radio"]', 'input[type="range"]',
  'input[type="button"]', 'input[type="submit"]', 'input[type="reset"]',
  ".cursor-pointer", "[data-cursor-target]",
].join(",");

/** Things that should hand the native I-beam back. */
const TEXTUAL = [
  'input:not([type="checkbox"]):not([type="radio"]):not([type="range"])'
    + ':not([type="button"]):not([type="submit"]):not([type="reset"])'
    + ':not([type="color"]):not([type="file"]):not([type="image"])',
  "textarea",
  '[contenteditable=""]',
  '[contenteditable="true"]',
].join(",");

const RING_LERP = 0.24;   // ring catch-up per frame; lower = longer tail
const MAX_RIPPLES = 6;

function climb(el: Element | null, test: (n: Element) => boolean): boolean {
  let n: Element | null = el;
  for (let i = 0; n && i < 8; i++, n = n.parentElement) {
    if (test(n)) return true;
  }
  return false;
}

export default function RomeCursor() {
  const layerRef = useRef<HTMLDivElement>(null);
  const dotRef   = useRef<HTMLDivElement>(null);
  const ringRef  = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(false);

  /**
   * Whether to run at all. Only the pointer type decides now.
   *
   * This used to switch off for the whole of /world, on the reasoning that a
   * DOM cursor is invisible under a native `WebContentsView` while the real one
   * is hidden. Two things make that wrong today:
   *
   * • ROME's `cursor: none` reaches ROME's document and nothing else. The guest
   *   page is a separate document, so it was never ROME that hid the cursor in
   *   there — the page either draws its own (`guest-cursor.ts`, injected on
   *   every web page) or keeps the native one, and neither cares what ROME's
   *   stylesheet says.
   * • The browser no longer owns the window. It can be one pane beside another
   *   (`PaneHost`), and it never covered the top bar or the footer even before
   *   that. Switching off globally meant the system cursor in ROME's own chrome
   *   the entire time the browser was open — which is exactly what you notice
   *   moving between the top bar and the page.
   *
   * Over the native view itself, ROME's DOM receives no mouse events at all —
   * they go to the guest — so `mouseleave` on the document fires and the layer
   * hides itself. That was always the mechanism doing the real work here.
   */
  useEffect(() => {
    const fine = typeof window.matchMedia !== "function"
      || window.matchMedia("(pointer: fine)").matches;
    setEnabled(fine);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    root.dataset.romeCursor = "on";

    const dot  = dotRef.current;
    const ring = ringRef.current;
    const layer = layerRef.current;
    if (!dot || !ring || !layer) return;

    const reduced = typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let px = window.innerWidth / 2, py = window.innerHeight / 2;   // pointer
    let rx = px, ry = py;                                          // ring
    let seen = false;
    let raf = 0;

    function frame() {
      // Reduced motion gets no trail: the ring is simply where the pointer is.
      const k = reduced ? 1 : RING_LERP;
      rx += (px - rx) * k;
      ry += (py - ry) * k;
      dot!.style.transform  = `translate3d(${px}px, ${py}px, 0)`;
      ring!.style.transform = `translate3d(${rx.toFixed(2)}px, ${ry.toFixed(2)}px, 0)`;
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    function show() {
      if (seen) return;
      seen = true;
      layer!.classList.add("is-live");
    }

    function onMove(e: MouseEvent) { px = e.clientX; py = e.clientY; show(); }

    // Hover / text state is resolved on mouseover, which fires only when the
    // element under the pointer actually changes — doing this per mousemove
    // would mean a DOM walk on every pixel.
    function onOver(e: MouseEvent) {
      const t = e.target as Element | null;
      const textual = climb(t, n => n.matches(TEXTUAL));
      layer!.classList.toggle("is-text", textual);
      layer!.classList.toggle(
        "is-hot",
        !textual && climb(t, n =>
          n.matches(INTERACTIVE)
          // The codebase writes `cursor: pointer` inline in a lot of places;
          // computed style is useless here because we have overridden it.
          || (n as HTMLElement).style?.cursor === "pointer"
          || (n as HTMLElement).style?.cursor === "grab"),
      );
    }

    function onDown() { layer!.classList.add("is-down"); }

    function onUp(e: MouseEvent) {
      layer!.classList.remove("is-down");
      if (reduced) return;
      if (layer!.querySelectorAll(".rome-cursor-ripple").length >= MAX_RIPPLES) return;
      const r = document.createElement("span");
      r.className = "rome-cursor-ripple";
      r.style.left = `${e.clientX}px`;
      r.style.top  = `${e.clientY}px`;
      r.addEventListener("animationend", () => r.remove(), { once: true });
      layer!.appendChild(r);
    }

    function hide() { seen = false; layer!.classList.remove("is-live", "is-down"); }

    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("mouseover", onOver, { passive: true, capture: true });
    window.addEventListener("mousedown", onDown, { passive: true, capture: true });
    window.addEventListener("mouseup", onUp, { passive: true, capture: true });
    document.addEventListener("mouseleave", hide);
    window.addEventListener("blur", hide);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseover", onOver, { capture: true } as any);
      window.removeEventListener("mousedown", onDown, { capture: true } as any);
      window.removeEventListener("mouseup", onUp, { capture: true } as any);
      document.removeEventListener("mouseleave", hide);
      window.removeEventListener("blur", hide);
      delete root.dataset.romeCursor;
      layer.querySelectorAll(".rome-cursor-ripple").forEach(n => n.remove());
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div className="rome-cursor-layer" ref={layerRef} aria-hidden>
      <div className="rome-cursor-ring" ref={ringRef}><i /></div>
      <div className="rome-cursor-dot"  ref={dotRef}><i /></div>
    </div>
  );
}
