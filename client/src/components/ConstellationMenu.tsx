import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { motion, useMotionValue, useSpring, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { CONSTELLATION_NODES, getConnectionPairs } from "@/lib/constellationData";
import ConstellationNode from "./ConstellationNode";
import DomainDetailPanel from "./DomainDetailPanel";

// ── Particle canvas ────────────────────────────────────────────────────────
function ParticleCanvas({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0 || height === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf: number;
    const particles = Array.from({ length: 260 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: Math.random() * 1.6 + 0.25,
      alpha: Math.random() * 0.65 + 0.15,
      speed: Math.random() * 0.015 + 0.004,
      phase: Math.random() * Math.PI * 2,
    }));

    let t = 0;
    function draw() {
      ctx!.clearRect(0, 0, width, height);
      t += 1;
      for (const p of particles) {
        const flicker = Math.sin(t * p.speed + p.phase) * 0.3 + 0.7;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx!.fillStyle = `hsla(43, 55%, 78%, ${p.alpha * flicker})`;
        ctx!.fill();
      }
      raf = requestAnimationFrame(draw);
    }
    draw();
    return () => cancelAnimationFrame(raf);
  }, [width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="absolute inset-0 pointer-events-none"
    />
  );
}

// ── Props ──────────────────────────────────────────────────────────────────
interface Props {
  onClose: () => void;
}

// ── Main ───────────────────────────────────────────────────────────────────
export default function ConstellationMenu({ onClose }: Props) {
  const [hoveredId, setHoveredId]   = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Use window dimensions directly — reliable regardless of container sizing
  const [dims, setDims] = useState({
    w: window.innerWidth,
    h: window.innerHeight,
  });

  useEffect(() => {
    function onResize() {
      setDims({ w: window.innerWidth, h: window.innerHeight });
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Parallax spring
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const springX = useSpring(mx, { stiffness: 55, damping: 28 });
  const springY = useSpring(my, { stiffness: 55, damping: 28 });

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const cx = (e.clientX / dims.w) - 0.5;
    const cy = (e.clientY / dims.h) - 0.5;
    mx.set(cx * 16);
    my.set(cy * 11);
  }, [dims, mx, my]);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" || e.key === "Tab") {
        e.preventDefault();
        if (selectedId) setSelectedId(null);
        else onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, onClose]);

  // Data
  const { data: activeProfile } = useQuery<any>({
    queryKey: ["/api/active-profile"],
    queryFn: () => apiRequest("GET", "/api/active-profile").then(r => r.json()),
  });

  // Node pixel positions
  const nodePositions = useMemo(() =>
    Object.fromEntries(
      CONSTELLATION_NODES.map(n => [
        n.id,
        {
          x: (n.x / 100) * dims.w,
          y: (n.y / 100) * dims.h,
        },
      ])
    ),
    [dims]
  );

  const connectionPairs = useMemo(() => getConnectionPairs(), []);
  const selectedNode = CONSTELLATION_NODES.find(n => n.id === selectedId) ?? null;
  const activeId = hoveredId ?? selectedId;

  const handleSelect = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) setHoveredId(null);
  }, []);

  return (
    <div
      className="fixed inset-0 overflow-hidden"
      style={{ zIndex: 200 }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => { mx.set(0); my.set(0); }}
    >
      {/* Cave background */}
      <div className="rome-bg absolute inset-0" />

      {/* Particles */}
      <ParticleCanvas width={dims.w} height={dims.h} />

      {/* Parallax SVG layer */}
      <motion.div
        className="absolute inset-0"
        style={{ x: springX, y: springY }}
      >
        <svg
          width={dims.w}
          height={dims.h}
          viewBox={`0 0 ${dims.w} ${dims.h}`}
          className="absolute inset-0 overflow-visible"
        >
          {/* Connection lines */}
          {connectionPairs.map(([aId, bId]) => {
            const a = nodePositions[aId];
            const b = nodePositions[bId];
            if (!a || !b) return null;
            const nodeA = CONSTELLATION_NODES.find(n => n.id === aId)!;
            const lit = activeId === aId || activeId === bId;

            return (
              <motion.line
                key={`${aId}-${bId}`}
                x1={a.x} y1={a.y}
                x2={b.x} y2={b.y}
                stroke={lit ? nodeA.accent : "hsl(43 30% 40%)"}
                strokeWidth={lit ? 1 : 0.35}
                strokeOpacity={lit ? 0.6 : 0.15}
                strokeDasharray={lit ? undefined : "3 10"}
                animate={{
                  strokeOpacity: lit ? 0.6 : 0.15,
                  strokeWidth:   lit ? 1 : 0.35,
                }}
                transition={{ duration: 0.35 }}
              />
            );
          })}

          {/* Nodes */}
          {CONSTELLATION_NODES.map((node, i) => {
            const pos = nodePositions[node.id];
            if (!pos) return null;
            return (
              <motion.g
                key={node.id}
                transform={`translate(${pos.x}, ${pos.y})`}
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{
                  delay: 0.05 + i * 0.06,
                  duration: 0.45,
                  ease: [0.34, 1.56, 0.64, 1],
                }}
              >
                <ConstellationNode
                  node={node}
                  isHovered={hoveredId === node.id}
                  isSelected={selectedId === node.id}
                  isActive={activeId !== null}
                  onHover={setHoveredId}
                  onSelect={handleSelect}
                />
              </motion.g>
            );
          })}
        </svg>
      </motion.div>

      {/* Detail panel */}
      <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 10 }}>
        <div className="relative w-full h-full pointer-events-none">
          <DomainDetailPanel
            node={selectedNode}
            onClose={() => setSelectedId(null)}
            onNavigate={onClose}
          />
        </div>
      </div>

      {/* Profile badge — bottom left */}
      {activeProfile && (
        <div className="absolute bottom-8 left-8 pointer-events-none" style={{ zIndex: 10 }}>
          <div className="flex items-center gap-2">
            <div
              className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
              style={{
                background: "hsl(43 40% 14%)",
                border: "1px solid hsl(43 50% 28%)",
              }}
            >
              <span style={{ fontFamily: "'Cinzel', serif", fontSize: 9, color: "hsl(43 80% 60%)", fontWeight: 700 }}>
                {(activeProfile.name || "T")[0].toUpperCase()}
              </span>
            </div>
            <p style={{ fontFamily: "'Cinzel', serif", fontSize: 10, color: "hsl(43 35% 42%)", letterSpacing: "0.12em", textTransform: "uppercase" }}>
              {activeProfile.name}
            </p>
          </div>
        </div>
      )}

      {/* Close hint — bottom center */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 pointer-events-none" style={{ zIndex: 10 }}>
        <p style={{ fontFamily: "DM Mono, monospace", fontSize: 9, color: "hsl(214 20% 32%)", letterSpacing: "0.18em", textTransform: "uppercase" }}>
          ESC to close · click node to navigate
        </p>
      </div>

      {/* Click-away to deselect panel */}
      {selectedId && (
        <div
          className="absolute inset-0"
          style={{ zIndex: 5 }}
          onClick={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
