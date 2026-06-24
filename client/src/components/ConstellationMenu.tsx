import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { motion, useMotionValue, useSpring } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { CONSTELLATION_NODES, getConnectionPairs } from "@/lib/constellationData";
import ConstellationNode from "./ConstellationNode";
import DomainDetailPanel from "./DomainDetailPanel";

// ── Particle canvas for cave-speck background ──────────────────────────────
function useParticleCanvas(canvasRef: React.RefObject<HTMLCanvasElement>) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf: number;
    const W = canvas.width;
    const H = canvas.height;

    // Brighter, more particles than before per design brief
    const particles = Array.from({ length: 220 }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 1.4 + 0.3,
      alpha: Math.random() * 0.55 + 0.1,
      speed: Math.random() * 0.12 + 0.02,
      phase: Math.random() * Math.PI * 2,
    }));

    let t = 0;
    function draw() {
      ctx.clearRect(0, 0, W, H);
      t += 0.006;
      for (const p of particles) {
        const flicker = Math.sin(t * p.speed * 60 + p.phase) * 0.25 + 0.75;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(43, 60%, 75%, ${p.alpha * flicker})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(raf);
  }, [canvasRef]);
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function ConstellationMenu() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const [hoveredId, setHoveredId]   = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dims, setDims] = useState({ w: 1280, h: 820 });

  // Framer spring for subtle mouse parallax
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const springX = useSpring(mx, { stiffness: 60, damping: 30 });
  const springY = useSpring(my, { stiffness: 60, damping: 30 });

  // Data for profile name display
  const { data: activeProfile } = useQuery<any>({
    queryKey: ["/api/active-profile"],
    queryFn: () => apiRequest("GET", "/api/active-profile").then(r => r.json()),
  });

  const { data: stats } = useQuery<any>({
    queryKey: ["/api/stats"],
    queryFn: () => apiRequest("GET", "/api/stats").then(r => r.json()),
  });

  // Measure container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setDims({ w: width, h: height });
      if (canvasRef.current) {
        canvasRef.current.width = width;
        canvasRef.current.height = height;
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useParticleCanvas(canvasRef);

  // Mouse parallax
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const cx = (e.clientX - rect.left) / rect.width  - 0.5;
    const cy = (e.clientY - rect.top)  / rect.height - 0.5;
    mx.set(cx * 14);
    my.set(cy * 10);
  }, [mx, my]);

  // Convert % positions → absolute SVG coords
  const nodePositions = useMemo(() =>
    Object.fromEntries(
      CONSTELLATION_NODES.map(n => [
        n.id,
        { x: (n.x / 100) * dims.w, y: (n.y / 100) * dims.h },
      ])
    ),
    [dims]
  );

  const connectionPairs = useMemo(() => getConnectionPairs(), []);

  const selectedNode = CONSTELLATION_NODES.find(n => n.id === selectedId) ?? null;
  const activeId = hoveredId ?? selectedId;

  const handleSelect = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) setHoveredId(null); // clear hover when selecting
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden select-none"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => { mx.set(0); my.set(0); }}
    >
      {/* Cave background */}
      <div className="rome-bg absolute inset-0" />

      {/* Particle canvas */}
      <canvas
        ref={canvasRef}
        width={dims.w}
        height={dims.h}
        className="absolute inset-0 pointer-events-none"
        style={{ zIndex: 1 }}
      />

      {/* Parallax layer — SVG constellation */}
      <motion.div
        className="absolute inset-0"
        style={{ x: springX, y: springY, zIndex: 2 }}
      >
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          viewBox={`0 0 ${dims.w} ${dims.h}`}
          className="absolute inset-0"
        >
          {/* Connection lines */}
          {connectionPairs.map(([aId, bId]) => {
            const a = nodePositions[aId];
            const b = nodePositions[bId];
            if (!a || !b) return null;

            const nodeA = CONSTELLATION_NODES.find(n => n.id === aId)!;
            const nodeB = CONSTELLATION_NODES.find(n => n.id === bId)!;

            const isLit =
              (activeId === aId || activeId === bId) &&
              (nodeA.connections.includes(bId) || nodeB.connections.includes(aId));

            return (
              <motion.line
                key={`${aId}-${bId}`}
                x1={a.x} y1={a.y}
                x2={b.x} y2={b.y}
                stroke={isLit ? nodeA.accent : "hsl(43 30% 35%)"}
                strokeWidth={isLit ? 0.8 : 0.4}
                strokeOpacity={isLit ? 0.55 : 0.12}
                strokeDasharray={isLit ? "none" : "4 8"}
                animate={{
                  strokeOpacity: isLit ? 0.55 : 0.12,
                  strokeWidth: isLit ? 0.8 : 0.4,
                }}
                transition={{ duration: 0.4 }}
              />
            );
          })}

          {/* Nodes */}
          {CONSTELLATION_NODES.map(node => {
            const pos = nodePositions[node.id];
            if (!pos) return null;

            return (
              <motion.g
                key={node.id}
                // Depth parallax: nodes further back move less with mouse
                style={{
                  x: springX ? undefined : 0,
                }}
                transform={`translate(${pos.x}, ${pos.y})`}
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
      <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 20 }}>
        <div className="relative w-full h-full pointer-events-none">
          <DomainDetailPanel
            node={selectedNode}
            onClose={() => setSelectedId(null)}
          />
        </div>
      </div>

      {/* Wordmark + tagline — upper left */}
      <motion.div
        className="absolute top-8 left-10 pointer-events-none"
        style={{ zIndex: 10 }}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.6 }}
      >
        <div className="flex items-center gap-3 mb-1">
          {/* Laurel SVG */}
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <circle cx="14" cy="14" r="12" stroke="hsl(43,88%,55%)" strokeWidth="1.2" fill="none"/>
            <path d="M7 14 C5 11 6 8 9 8 C8 11 8 13 10 14" stroke="hsl(43,78%,55%)" strokeWidth="1" fill="none" strokeLinecap="round"/>
            <path d="M7 14 C5 16 6 19 9 19 C8 16 8 15 10 14" stroke="hsl(43,78%,55%)" strokeWidth="1" fill="none" strokeLinecap="round"/>
            <path d="M21 14 C23 11 22 8 19 8 C20 11 20 13 18 14" stroke="hsl(43,78%,55%)" strokeWidth="1" fill="none" strokeLinecap="round"/>
            <path d="M21 14 C23 16 22 19 19 19 C20 16 20 15 18 14" stroke="hsl(43,78%,55%)" strokeWidth="1" fill="none" strokeLinecap="round"/>
            <rect x="13" y="9" width="2" height="10" rx="1" fill="hsl(43,88%,55%)" opacity="0.7"/>
          </svg>
          <h1
            className="text-2xl font-bold gold-shimmer tracking-[0.15em]"
            style={{ fontFamily: "'Cinzel', serif" }}
          >
            ROME
          </h1>
        </div>
        <p
          className="text-[10px] tracking-[0.2em] uppercase"
          style={{ color: "hsl(43 40% 45%)", fontFamily: "'Cinzel', serif" }}
        >
          You weren't built in a day.
        </p>
      </motion.div>

      {/* Profile badge — bottom left */}
      {activeProfile && (
        <motion.div
          className="absolute bottom-7 left-8 pointer-events-none"
          style={{ zIndex: 10 }}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.5 }}
        >
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-gold-600/20 border border-gold-500/30 flex items-center justify-center shrink-0">
              <span className="text-[9px] font-bold" style={{ color: "hsl(43 80% 60%)", fontFamily: "'Cinzel', serif" }}>
                {(activeProfile.name || "T")[0].toUpperCase()}
              </span>
            </div>
            <div>
              <p className="text-[10px] tracking-widest uppercase" style={{ color: "hsl(43 40% 40%)", fontFamily: "'Cinzel', serif" }}>
                {activeProfile.name}
              </p>
              {stats && (
                <p className="text-[9px]" style={{ color: "hsl(214 20% 38%)" }}>
                  {stats.user?.totalSessionsCompleted ?? 0} sessions completed
                </p>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* Hint text — bottom right */}
      <motion.div
        className="absolute bottom-7 right-8 pointer-events-none"
        style={{ zIndex: 10 }}
        initial={{ opacity: 0 }}
        animate={{ opacity: selectedId ? 0 : 0.4 }}
        transition={{ duration: 0.4 }}
      >
        <p className="text-[10px] tracking-widest uppercase text-right" style={{ color: "hsl(214 20% 38%)", fontFamily: "DM Mono, monospace" }}>
          Select a domain node
        </p>
      </motion.div>

      {/* Dismiss panel click-away */}
      {selectedId && (
        <div
          className="absolute inset-0"
          style={{ zIndex: 15 }}
          onClick={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
