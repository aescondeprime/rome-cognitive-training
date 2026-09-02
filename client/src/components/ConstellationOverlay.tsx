// ConstellationOverlay.tsx
// Global full-screen overlay toggled by:
//   1. Pressing Tab anywhere in the app
//   2. Clicking the subtle ⊕ trigger button at bottom-center of AppShell
//
// Lives at the root of the app (above AppShell) via a React Portal.

import { useEffect, useCallback, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import ConstellationMenu from "./ConstellationMenu";
import NanoTransition from "./NanoTransition";
import { playCue } from "@/lib/sound";
import { setConstellationUi, resetConstellationUi } from "@/lib/constellationUiState";

/**
 * Assembly and disassembly timings, ms.
 *
 * Both are deliberately short. This is a transition the user makes constantly —
 * Tab in, Tab out — and anything that reads as "an animation you wait through"
 * would grate within a day. Build gets slightly longer than deconstruct because
 * arriving somewhere deserves more ceremony than leaving it.
 */
const BUILD_MS = 560;
const DECON_MS = 420;
/** Reduced motion still gets a beat, just not a performance. */
const REDUCED_MS = 150;

type Phase = "idle" | "building" | "open" | "deconstructing";

// Exported trigger button — rendered inside AppShell footer
export function ConstellationTrigger({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      title="Open Constellation (Tab)"
      className="group flex flex-col items-center gap-1 w-full py-2 transition-opacity opacity-30 hover:opacity-70"
      style={{ cursor: "pointer" }}
    >
      {/* The subtle ring symbol */}
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <circle
          cx="9" cy="9" r="7"
          stroke="hsl(var(--accent-h) 60% 50%)"
          strokeWidth="0.8"
          className="transition-all group-hover:stroke-[hsl(var(--accent-h),80%,65%)]"
        />
        <circle
          cx="9" cy="9" r="3"
          stroke="hsl(var(--accent-h) 60% 50%)"
          strokeWidth="0.8"
          className="transition-all group-hover:stroke-[hsl(var(--accent-h),80%,65%)]"
        />
        <line x1="9" y1="2" x2="9" y2="5"   stroke="hsl(var(--accent-h) 60% 50%)" strokeWidth="0.8" />
        <line x1="9" y1="13" x2="9" y2="16" stroke="hsl(var(--accent-h) 60% 50%)" strokeWidth="0.8" />
        <line x1="2" y1="9" x2="5" y2="9"   stroke="hsl(var(--accent-h) 60% 50%)" strokeWidth="0.8" />
        <line x1="13" y1="9" x2="16" y2="9" stroke="hsl(var(--accent-h) 60% 50%)" strokeWidth="0.8" />
      </svg>
      <span
        style={{
          fontFamily: "DM Mono, monospace",
          fontSize: 8,
          color: "hsl(var(--accent-h) 40% 40%)",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        Map
      </span>
    </button>
  );
}

// The portal overlay — mount this once at app root
export function ConstellationPortal() {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const timer = useRef<number | null>(null);

  const reduced = typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const buildMs = reduced ? REDUCED_MS : BUILD_MS;
  const deconMs = reduced ? REDUCED_MS : DECON_MS;

  // The cue needs to know which way the map is moving, and a functional
  // setState updater is the wrong place to ask: React runs it twice under
  // StrictMode, which would fire the sound twice. A ref beside the state gives
  // one synchronous answer, and also lets the toggle skip a no-op transition.
  const openRef = useRef(false);

  /**
   * Drive the phase machine.
   *
   * The map stays mounted through `deconstructing` on purpose: you should watch
   * it come apart, not watch a blank screen where it used to be. The pending
   * timer is always cleared first, so hammering Tab mid-transition reverses
   * cleanly instead of leaving a stale callback to unmount the map underneath a
   * fresh build.
   */
  const applyOpen = useCallback((next: boolean) => {
    if (openRef.current === next) return;
    openRef.current = next;
    playCue(next ? "constellationOpen" : "constellationClose");

    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }

    if (next) {
      setOpen(true);
      setPhase("building");
      timer.current = window.setTimeout(() => {
        timer.current = null;
        setPhase("open");
      }, buildMs);
    } else {
      setPhase("deconstructing");
      timer.current = window.setTimeout(() => {
        timer.current = null;
        setOpen(false);
        setPhase("idle");
      }, deconMs);
    }
  }, [buildMs, deconMs]);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const openMap   = useCallback(() => applyOpen(true),  [applyOpen]);
  const closeMap  = useCallback(() => applyOpen(false), [applyOpen]);
  const toggleMap = useCallback(() => applyOpen(!openRef.current), [applyOpen]);

  // Tab key toggles
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Tab" && !e.shiftKey) {
        // Don't steal Tab from focused form inputs
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        e.preventDefault();
        toggleMap();
      }
    }
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [toggleMap]);

  // Native WebContentsViews render above the React compositor regardless of
  // CSS z-index. Keep the browser page detached while the map owns the screen.
  useEffect(() => {
    document.documentElement.dataset.romeConstellationOpen = open ? "true" : "false";
    window.dispatchEvent(new CustomEvent("rome:constellation-visibility", { detail: { visible: open } }));
    return () => {
      if (open) document.documentElement.dataset.romeConstellationOpen = "false";
    };
  }, [open]);

  // When a remote page has focus its key events never reach this renderer.
  // Electron main intercepts ROME's Tab shortcut and forwards only this toggle.
  useEffect(() => {
    return window.romeDesktop?.browser.onConstellationToggle(toggleMap);
  }, [toggleMap]);

  // Expose openMap so the trigger button inside AppShell can call it, and
  // closeMap so a widget that navigates somewhere can take the map with it —
  // the widgets are no longer children of the menu and cannot be handed its
  // `onClose` as a prop.
  useEffect(() => {
    (window as any).__romeOpenConstellation = openMap;
    (window as any).__romeCloseConstellation = closeMap;
    return () => {
      delete (window as any).__romeOpenConstellation;
      delete (window as any).__romeCloseConstellation;
    };
  }, [openMap, closeMap]);

  /**
   * Tell the widget layer whether the map is up.
   *
   * `open` rather than `phase === "open"`: the widgets should be on screen
   * through the build and the teardown, not appear once the plates have
   * finished landing and vanish the instant they start to come apart.
   */
  useEffect(() => {
    if (open) setConstellationUi({ mapOpen: true });
    else resetConstellationUi();
  }, [open]);

  const assembling = phase === "building" || phase === "deconstructing";

  return createPortal(
    <>
      {open && (
        <motion.div
          key="constellation-overlay"
          // The map itself only ever fades and breathes a little; the plates
          // carry the gesture. Two competing animations would read as mush.
          initial={{ opacity: 0, scale: 1.04 }}
          animate={
            phase === "deconstructing"
              ? { opacity: 0, scale: 1.03 }
              : { opacity: 1, scale: 1 }
          }
          transition={{
            duration: (phase === "deconstructing" ? deconMs : buildMs) / 1000,
            // Arrive fast and settle; leave by falling away.
            ease: phase === "deconstructing" ? [0.4, 0, 1, 1] : [0.16, 0.9, 0.3, 1],
          }}
          style={{ position: "fixed", inset: 0, zIndex: 200 }}
        >
          <ConstellationMenu onClose={closeMap} />
        </motion.div>
      )}
      {assembling && !reduced && (
        <NanoTransition
          // Remounting per pass is the point: each transition wants a freshly
          // scattered field, and the key is what forces it.
          key={`nano-${phase}-${open}`}
          mode={phase === "building" ? "build" : "deconstruct"}
          duration={phase === "building" ? buildMs : deconMs}
        />
      )}
    </>,
    document.body
  );
}
