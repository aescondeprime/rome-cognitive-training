import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { motion, useMotionValue, useSpring, animate } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { CONSTELLATION_NODES, getConnectionPairs } from "@/lib/constellationData";
import ConstellationNode from "./ConstellationNode";
import DomainDetailPanel from "./DomainDetailPanel";

// ── Moving particle canvas ─────────────────────────────────────────────────
function ParticleCanvas({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0 || height === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const particles = Array.from({ length: 280 }, () => {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 0.18 + 0.04;
      return {
        x:     Math.random() * width,
        y:     Math.random() * height,
        vx:    Math.cos(angle) * speed,
        vy:    Math.sin(angle) * speed,
        r:     Math.random() * 1.5 + 0.3,
        alpha: Math.random() * 0.6 + 0.15,
        phase: Math.random() * Math.PI * 2,
        flicker: Math.random() * 0.025 + 0.008,
      };
    });

    let t = 0;
    let raf: number;

    function draw() {
      ctx!.clearRect(0, 0, width, height);
      t++;
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < -2)        p.x = width + 2;
        if (p.x > width + 2) p.x = -2;
        if (p.y < -2)        p.y = height + 2;
        if (p.y > height + 2) p.y = -2;

        const flicker = Math.sin(t * p.flicker + p.phase) * 0.28 + 0.72;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx!.fillStyle = `hsla(43, 55%, 80%, ${p.alpha * flicker})`;
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
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    />
  );
}

// ── Props ──────────────────────────────────────────────────────────────────
interface Props {
  onClose: () => void;
}

// ── Camera zoom factor when a node is selected ─────────────────────────────
const ZOOM_SCALE = 7;

// ── Main ───────────────────────────────────────────────────────────────────
export default function ConstellationMenu({ onClose }: Props) {
  const [hoveredId, setHoveredId]   = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Dims
  const getDims = () => ({
    w: document.documentElement.clientWidth  || window.innerWidth,
    h: document.documentElement.clientHeight || window.innerHeight,
  });
  const [dims, setDims] = useState(getDims);

  useEffect(() => {
    const id = requestAnimationFrame(() => setDims(getDims()));
    function onResize() { setDims(getDims()); }
    window.addEventListener("resize", onResize);
    return () => { cancelAnimationFrame(id); window.removeEventListener("resize", onResize); };
  }, []);

  // Parallax mouse spring (disabled during zoom so it doesn't fight)
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const springX = useSpring(mx, { stiffness: 50, damping: 25 });
  const springY = useSpring(my, { stiffness: 50, damping: 25 });

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (selectedId) return; // freeze parallax while zoomed
    const cx = (e.clientX / dims.w) - 0.5;
    const cy = (e.clientY / dims.h) - 0.5;
    mx.set(cx * 14);
    my.set(cy * 10);
  }, [dims, mx, my, selectedId]);

  // Camera zoom motion values — single tween drives all three in sync
  const camScale = useMotionValue(1);
  const camX     = useMotionValue(0);
  const camY     = useMotionValue(0);

  // Node positions
  const nodePositions = useMemo(() =>
    Object.fromEntries(
      CONSTELLATION_NODES.map(n => [
        n.id,
        { x: (n.x / 100) * dims.w, y: (n.y / 100) * dims.h },
      ])
    ),
    [dims]
  );

  // Whenever selectedId changes, animate camera to/from node
  useEffect(() => {
    const easing = [0.4, 0, 0.2, 1] as const; // material decelerate — smooth and deliberate
    const duration = 0.55;

    if (selectedId) {
      const pos = nodePositions[selectedId];
      if (!pos) return;
      const tx = dims.w / 2 - pos.x * ZOOM_SCALE;
      const ty = dims.h / 2 - pos.y * ZOOM_SCALE;
      mx.set(0); my.set(0); // freeze parallax
      // Animate all three values with identical timing so they stay in sync
      camScale.set(camScale.get()); // ensure starting from current
      animate(camScale, ZOOM_SCALE, { duration, ease: easing });
      animate(camX, tx,             { duration, ease: easing });
      animate(camY, ty,             { duration, ease: easing });
    } else {
      const easeOut = [0.0, 0, 0.4, 1] as const;
      animate(camScale, 1, { duration: 0.48, ease: easeOut });
      animate(camX,     0, { duration: 0.48, ease: easeOut });
      animate(camY,     0, { duration: 0.48, ease: easeOut });
    }
  }, [selectedId, nodePositions, dims, mx, my, camScale, camX, camY]);

  // ESC to close/deselect
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
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

  const connectionPairs = useMemo(() => getConnectionPairs(), []);
  const selectedNode = CONSTELLATION_NODES.find(n => n.id === selectedId) ?? null;
  const activeId = hoveredId ?? selectedId;

  const handleSelect = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) setHoveredId(null);
  }, []);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 200, overflow: "hidden",
        width: "100vw", height: "100vh",
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => { if (!selectedId) { mx.set(0); my.set(0); } }}
    >
      {/* Cave background */}
      <div className="rome-bg" style={{ position: "absolute", inset: 0 }} />

      {/* Particles — not part of zoom layer so they stay ambient */}
      <ParticleCanvas width={dims.w} height={dims.h} />

      {/* Camera zoom + parallax layer */}
      <motion.div
        style={{
          position: "absolute", inset: 0,
          // Parallax offset only active when not zoomed
          x: springX, y: springY,
        }}
      >
        {/* Inner div handles camera zoom; transform-origin top-left */}
        <motion.div
          style={{
            position: "absolute", inset: 0,
            scale: camScale,
            x: camX,
            y: camY,
            transformOrigin: "0 0",
          }}
        >
          <svg
            width={dims.w}
            height={dims.h}
            style={{ position: "absolute", inset: 0, overflow: "visible" }}
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
                  strokeOpacity={lit ? 0.6 : 0.14}
                  strokeDasharray={lit ? undefined : "3 9"}
                  animate={{ strokeOpacity: lit ? 0.6 : 0.14, strokeWidth: lit ? 1 : 0.35 }}
                  transition={{ duration: 0.3 }}
                />
              );
            })}

            {/* Nodes */}
            {CONSTELLATION_NODES.map((node, i) => {
              const pos = nodePositions[node.id];
              if (!pos) return null;
              return (
                <g
                  key={node.id}
                  transform={`translate(${pos.x}, ${pos.y})`}
                  style={{
                    opacity: 0,
                    animation: `nodeReveal 0.5s cubic-bezier(0.34,1.56,0.64,1) ${0.05 + i * 0.06}s forwards`,
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
                </g>
              );
            })}
          </svg>
        </motion.div>
      </motion.div>

      {/* Detail panel — outside zoom layer, always fixed */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 20 }}>
        <div style={{ position: "relative", width: "100%", height: "100%", pointerEvents: "none" }}>
          <DomainDetailPanel
            node={selectedNode}
            onClose={() => setSelectedId(null)}
            onNavigate={onClose}
          />
        </div>
      </div>

      {/* Profile badge */}
      {activeProfile && (
        <div style={{ position: "absolute", bottom: 28, left: 28, zIndex: 10, pointerEvents: "none" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 20, height: 20, borderRadius: "50%",
              background: "hsl(43 40% 12%)", border: "1px solid hsl(43 45% 26%)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <span style={{ fontFamily: "'Cinzel', serif", fontSize: 8, color: "hsl(43 80% 60%)", fontWeight: 700 }}>
                {(activeProfile.name || "T")[0].toUpperCase()}
              </span>
            </div>
            <span style={{ fontFamily: "'Cinzel', serif", fontSize: 10, color: "hsl(43 30% 40%)", letterSpacing: "0.12em", textTransform: "uppercase" }}>
              {activeProfile.name}
            </span>
          </div>
        </div>
      )}

      {/* Close hint */}
      <div style={{ position: "absolute", bottom: 28, left: "50%", transform: "translateX(-50%)", zIndex: 10, pointerEvents: "none" }}>
        <p style={{ fontFamily: "DM Mono, monospace", fontSize: 9, color: "hsl(214 20% 28%)", letterSpacing: "0.18em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
          ESC · click node to navigate
        </p>
      </div>

      {/* Click-away background to deselect (sits behind detail panel) */}
      {selectedId && (
        <div style={{ position: "absolute", inset: 0, zIndex: 5 }} onClick={() => setSelectedId(null)} />
      )}
    </div>
  );
}
