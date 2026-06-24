// ConstellationOverlay.tsx
// Global full-screen overlay toggled by:
//   1. Pressing Tab anywhere in the app
//   2. Clicking the subtle ⊕ trigger button at bottom-center of AppShell
//
// Lives at the root of the app (above AppShell) via a React Portal.

import { useEffect, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import ConstellationMenu from "./ConstellationMenu";

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
          stroke="hsl(43 60% 50%)"
          strokeWidth="0.8"
          className="transition-all group-hover:stroke-[hsl(43,80%,65%)]"
        />
        <circle
          cx="9" cy="9" r="3"
          stroke="hsl(43 60% 50%)"
          strokeWidth="0.8"
          className="transition-all group-hover:stroke-[hsl(43,80%,65%)]"
        />
        <line x1="9" y1="2" x2="9" y2="5"   stroke="hsl(43 60% 50%)" strokeWidth="0.8" />
        <line x1="9" y1="13" x2="9" y2="16" stroke="hsl(43 60% 50%)" strokeWidth="0.8" />
        <line x1="2" y1="9" x2="5" y2="9"   stroke="hsl(43 60% 50%)" strokeWidth="0.8" />
        <line x1="13" y1="9" x2="16" y2="9" stroke="hsl(43 60% 50%)" strokeWidth="0.8" />
      </svg>
      <span
        style={{
          fontFamily: "DM Mono, monospace",
          fontSize: 8,
          color: "hsl(43 40% 40%)",
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

  const openMap  = useCallback(() => setOpen(true), []);
  const closeMap = useCallback(() => setOpen(false), []);

  // Tab key toggles
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Tab" && !e.shiftKey) {
        // Don't steal Tab from focused form inputs
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        e.preventDefault();
        setOpen(v => !v);
      }
    }
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, []);

  // Expose openMap so the trigger button inside AppShell can call it
  useEffect(() => {
    (window as any).__romeOpenConstellation = openMap;
    return () => { delete (window as any).__romeOpenConstellation; };
  }, [openMap]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="constellation-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          style={{ position: "fixed", inset: 0, zIndex: 200 }}
        >
          <ConstellationMenu onClose={closeMap} />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
