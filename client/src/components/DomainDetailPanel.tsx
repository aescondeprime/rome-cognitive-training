import { useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { X, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConstellationNode } from "@/lib/constellationData";

interface Props {
  node: ConstellationNode | null;
  onClose: () => void;
}

export default function DomainDetailPanel({ node, onClose }: Props) {
  const [, navigate] = useLocation();

  const go = useCallback((href: string) => {
    onClose();
    navigate(href);
  }, [navigate, onClose]);

  return (
    <AnimatePresence>
      {node && (
        <motion.div
          key={node.id}
          initial={{ opacity: 0, x: 24, scale: 0.97 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 16, scale: 0.97 }}
          transition={{ duration: 0.28, ease: "easeOut" }}
          className="absolute right-6 top-1/2 -translate-y-1/2 w-72 pointer-events-auto z-30"
          style={{ transformOrigin: "right center" }}
        >
          <div
            className="rounded-xl border bg-[hsl(222_18%_6%/0.92)] backdrop-blur-xl overflow-hidden"
            style={{
              borderColor: `${node.accent}40`,
              boxShadow: `0 0 40px ${node.accent}18, 0 8px 32px hsl(220 20% 2% / 0.7), inset 0 1px 0 ${node.accent}15`,
            }}
          >
            {/* Header stripe */}
            <div
              className="px-5 pt-4 pb-3 flex items-start justify-between"
              style={{
                background: `linear-gradient(135deg, ${node.accent}12 0%, transparent 70%)`,
                borderBottom: `1px solid ${node.accent}20`,
              }}
            >
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <span
                    className="text-2xl"
                    style={{ filter: `drop-shadow(0 0 6px ${node.accent})` }}
                  >
                    {node.symbol}
                  </span>
                  <span
                    className="text-xs tracking-widest uppercase font-semibold"
                    style={{
                      fontFamily: "'Cinzel', serif",
                      color: node.accent,
                    }}
                  >
                    {node.label}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-snug mt-1">{node.tagline}</p>
              </div>

              <button
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground transition-colors mt-0.5 shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Actions */}
            <div className="p-4 space-y-1.5">
              {/* Primary action */}
              <button
                onClick={() => go(node.href)}
                className="group w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg border transition-all text-left"
                style={{
                  background: `${node.accent}0D`,
                  borderColor: `${node.accent}35`,
                }}
              >
                <span
                  className="text-xs font-semibold tracking-wider uppercase"
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
                  className="group w-full flex items-center gap-3 px-3 py-2 rounded-lg border border-transparent hover:border-white/8 hover:bg-white/4 transition-all text-left"
                >
                  <span
                    className="w-6 h-6 shrink-0 flex items-center justify-center rounded text-sm"
                    style={{
                      background: `${node.accent}15`,
                      color: node.accent,
                    }}
                  >
                    {sub.icon}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground/80 truncate group-hover:text-foreground transition-colors">
                      {sub.label}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">{sub.description}</p>
                  </div>
                </button>
              ))}
            </div>

            {/* Connection hint */}
            {node.connections.length > 0 && (
              <div
                className="px-4 pb-3 text-[10px] text-muted-foreground/50 font-mono tracking-wider"
                style={{ borderTop: `1px solid ${node.accent}12` }}
              >
                <span className="mt-2 block">
                  LINKED · {node.connections.join(" · ").toUpperCase().replace(/_/g, " ")}
                </span>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
