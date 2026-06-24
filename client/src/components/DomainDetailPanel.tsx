import { useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ArrowRight } from "lucide-react";
import type { ConstellationNode } from "@/lib/constellationData";

interface Props {
  node: ConstellationNode | null;
  onClose: () => void;           // closes panel (deselects node)
  onNavigate?: () => void;       // closes the whole constellation overlay
}

export default function DomainDetailPanel({ node, onClose, onNavigate }: Props) {
  // Navigate via hash — works outside Router context (portal)
  const go = useCallback((href: string) => {
    onClose();
    onNavigate?.();
    // Wouter uses hash routing; push to hash
    window.location.hash = href;
  }, [onClose, onNavigate]);

  return (
    <AnimatePresence>
      {node && (
        <motion.div
          key={node.id}
          initial={{ opacity: 0, x: 24, scale: 0.97 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 16, scale: 0.97 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="absolute right-6 top-1/2 -translate-y-1/2 w-72 pointer-events-auto"
          style={{ zIndex: 30 }}
        >
          <div
            className="rounded-xl border overflow-hidden"
            style={{
              background: "hsl(222 20% 5% / 0.92)",
              backdropFilter: "blur(24px)",
              borderColor: `${node.accent}35`,
              boxShadow: `0 0 48px ${node.accent}14, 0 12px 40px hsl(220 20% 2% / 0.75), inset 0 1px 0 ${node.accent}12`,
            }}
          >
            {/* Header */}
            <div
              className="px-5 pt-4 pb-3 flex items-start justify-between"
              style={{
                background: `linear-gradient(135deg, ${node.accent}10 0%, transparent 65%)`,
                borderBottom: `1px solid ${node.accent}18`,
              }}
            >
              <div className="flex-1 min-w-0 pr-3">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="text-xl leading-none"
                    style={{ filter: `drop-shadow(0 0 5px ${node.accent})` }}
                  >
                    {node.symbol}
                  </span>
                  <span
                    className="text-[11px] font-semibold tracking-widest uppercase truncate"
                    style={{ fontFamily: "'Cinzel', serif", color: node.accent }}
                  >
                    {node.label}
                  </span>
                </div>
                <p className="text-[11px] leading-snug" style={{ color: "hsl(214 20% 50%)" }}>
                  {node.tagline}
                </p>
              </div>
              <button
                onClick={onClose}
                className="shrink-0 mt-0.5 transition-opacity opacity-40 hover:opacity-80"
                style={{ color: "hsl(43 40% 50%)" }}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Actions */}
            <div className="p-4 space-y-1.5">
              {/* Primary CTA */}
              <button
                onClick={() => go(node.href)}
                className="group w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg border transition-all text-left"
                style={{
                  background: `${node.accent}0C`,
                  borderColor: `${node.accent}30`,
                }}
              >
                <span
                  className="text-[11px] font-semibold tracking-wider uppercase"
                  style={{ fontFamily: "'Cinzel', serif", color: node.accent }}
                >
                  Enter Domain
                </span>
                <ArrowRight
                  className="w-3 h-3 transition-transform group-hover:translate-x-0.5"
                  style={{ color: node.accent }}
                />
              </button>

              {/* Subnodes */}
              {node.subnodes.map(sub => (
                <button
                  key={sub.id}
                  onClick={() => go(sub.href)}
                  title={sub.description}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg border border-transparent transition-all text-left"
                  style={{ cursor: "pointer" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "hsl(43 20% 9%)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >
                  <span
                    className="w-6 h-6 shrink-0 flex items-center justify-center rounded text-sm"
                    style={{ background: `${node.accent}12`, color: node.accent }}
                  >
                    {sub.icon}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium truncate" style={{ color: "hsl(46 45% 72%)" }}>
                      {sub.label}
                    </p>
                    <p className="text-[10px] truncate" style={{ color: "hsl(214 20% 42%)" }}>
                      {sub.description}
                    </p>
                  </div>
                </button>
              ))}
            </div>

            {/* Connection hint */}
            {node.connections.length > 0 && (
              <div
                className="px-4 pb-3"
                style={{ borderTop: `1px solid ${node.accent}10` }}
              >
                <p
                  className="mt-2 text-[9px] tracking-widest uppercase"
                  style={{ color: "hsl(214 20% 30%)", fontFamily: "DM Mono, monospace" }}
                >
                  linked · {node.connections.map(c => c.replace(/_/g, " ")).join(" · ")}
                </p>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
