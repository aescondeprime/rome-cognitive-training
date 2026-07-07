import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { motion, useMotionValue, useSpring, animate } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { CONSTELLATION_NODES, getConnectionPairs } from "@/lib/constellationData";
import { loadLayout, saveLayout, resetLayout, type ConstellationLayout, type NodeOverride } from "@/lib/constellationLayout";
import { getRayState, pinRaySource, setRayDirection } from "@/lib/lightRayState";
import ConstellationNode from "./ConstellationNode";
import NodeBranchMenu from "./NodeBranchMenu";
import LightRay from "./LightRay";

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
        if (p.x < -2)         p.x = width + 2;
        if (p.x > width + 2)  p.x = -2;
        if (p.y < -2)         p.y = height + 2;
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

// ── Direction handle — orbits the ray source handle ───────────────────────
// Drag it around the source circle to set beam direction.
// Double-click to reset to auto-aim.
function DirectionHandle({
  sourceX,    // screen px
  sourceY,
  angle,      // current direction in radians (null = auto)
  onAngle,    // (angle: number | null) => void
}: {
  sourceX: number;
  sourceY: number;
  angle: number | null;
  onAngle: (a: number | null) => void;
}) {
  const ORBIT_R   = 58; // distance from source center — clears the 18px source ring
  const isDragging = useRef(false);
  const onAngleRef = useRef(onAngle);
  onAngleRef.current = onAngle;

  // If no angle set, show at bottom of orbit (π/2 = pointing down = natural default)
  const displayAngle = angle ?? Math.PI * 0.6;
  const dotX = sourceX + Math.cos(displayAngle) * ORBIT_R;
  const dotY = sourceY + Math.sin(displayAngle) * ORBIT_R;

  function onMouseDown(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    isDragging.current = true;

    function handleMove(ev: MouseEvent) {
      if (!isDragging.current) return;
      const dx = ev.clientX - sourceX;
      const dy = ev.clientY - sourceY;
      onAngleRef.current(Math.atan2(dy, dx));
    }
    function handleUp() {
      isDragging.current = false;
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup",   handleUp);
    }
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup",   handleUp);
  }

  function onDblClick(e: React.MouseEvent) {
    e.stopPropagation();
    onAngleRef.current(null); // reset to auto-aim
  }

  return (
    <div
      onMouseDown={onMouseDown}
      onDoubleClick={onDblClick}
      title="Drag to set beam direction · Double-click to reset"
      style={{
        position:      "fixed",
        left:          dotX,
        top:           dotY,
        transform:     "translate(-50%, -50%)",
        zIndex:        9999,
        cursor:        "crosshair",
        userSelect:    "none",
        pointerEvents: "all",
      }}
    >
      <svg width={28} height={28} viewBox="-14 -14 28 28" overflow="visible">
        {/* Orbit ring — only visible in edit mode, dashed */}
        <circle r={ORBIT_R}
          cx={sourceX - dotX} cy={sourceY - dotY}
          fill="none" stroke="hsl(43 50% 40%)" strokeWidth={0.6}
          strokeOpacity={0.3} strokeDasharray="3 5"
        />
        {/* Direction dot */}
        <circle r={6} fill="hsl(200 80% 55%)" opacity={0.88}
          style={{ filter: "drop-shadow(0 0 5px hsl(200 90% 60%))" }}
        />
        {/* Arrow pointing outward from center */}
        <line x1={0} y1={0}
          x2={Math.cos(displayAngle - Math.atan2(dotY - sourceY, dotX - sourceX)) * 5}
          y2={Math.sin(displayAngle - Math.atan2(dotY - sourceY, dotX - sourceX)) * 5}
          stroke="white" strokeWidth={1.2} strokeOpacity={0.7}
        />
        {/* Label */}
        <text y={16} textAnchor="middle" fontSize={6.5} fill="hsl(200 70% 65%)" opacity={0.6}
          style={{ fontFamily: "DM Mono, monospace", letterSpacing: "0.08em" }}
        >{angle === null ? "AUTO" : "DIR"}</text>
      </svg>
    </div>
  );
}

// ── Ray source handle (edit mode only) ────────────────────────────────────
// Plain HTML div — no SVG coordinate space, no transform conflicts.
// posX/posY are pure screen pixels derived from offset fractions.
function RayHandle({
  offset,
  onDrag,
}: {
  offset: { x: number; y: number };
  onDrag: (ox: number, oy: number) => void;
}) {
  const isDragging  = useRef(false);
  const startMouse  = useRef({ x: 0, y: 0 });
  const startOffset = useRef({ x: 0, y: 0 });
  const onDragRef   = useRef(onDrag);
  onDragRef.current = onDrag;

  // Use window dimensions directly — never zero, no closure staleness
  const W = window.innerWidth;
  const H = window.innerHeight;
  const posX = W * (0.5  + offset.x);
  const posY = H * (0.28 + offset.y);

  function onMouseDown(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    isDragging.current  = true;
    startMouse.current  = { x: e.clientX, y: e.clientY };
    startOffset.current = { x: offset.x,  y: offset.y  };

    function handleMove(ev: MouseEvent) {
      if (!isDragging.current) return;
      // Read window dimensions fresh each move — always correct
      const dx = (ev.clientX - startMouse.current.x) / window.innerWidth;
      const dy = (ev.clientY - startMouse.current.y) / window.innerHeight;
      onDragRef.current(
        startOffset.current.x + dx,
        startOffset.current.y + dy,
      );
    }
    function handleUp() {
      isDragging.current = false;
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup",   handleUp);
    }
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup",   handleUp);
  }

  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        position:      "fixed",
        left:          posX,
        top:           posY,
        transform:     "translate(-50%, -50%)",
        zIndex:        10000,
        cursor:        "grab",
        userSelect:    "none",
        pointerEvents: "all",
      }}
    >
      <svg width={44} height={54} viewBox="-22 -22 44 54" overflow="visible">
        <circle r={18} fill="hsl(43 60% 8% / 0.7)" stroke="hsl(43 90% 62%)"
          strokeWidth={1.2} strokeOpacity={0.85}
          style={{ filter: "drop-shadow(0 0 8px hsl(43 88% 55%))" }}
        />
        <circle r={5} fill="hsl(43 95% 70%)" opacity={0.9}
          style={{ filter: "drop-shadow(0 0 5px hsl(43 95% 65%))" }}
        />
        <line x1={-11} y1={0}   x2={-6}  y2={0}   stroke="hsl(43 80% 65%)" strokeWidth={1} strokeOpacity={0.6} />
        <line x1={6}   y1={0}   x2={11}  y2={0}   stroke="hsl(43 80% 65%)" strokeWidth={1} strokeOpacity={0.6} />
        <line x1={0}   y1={-11} x2={0}   y2={-6}  stroke="hsl(43 80% 65%)" strokeWidth={1} strokeOpacity={0.6} />
        <line x1={0}   y1={6}   x2={0}   y2={11}  stroke="hsl(43 80% 65%)" strokeWidth={1} strokeOpacity={0.6} />
        <text y={30} textAnchor="middle" fontSize={7.5} fill="hsl(43 70% 60%)" opacity={0.65}
          style={{ fontFamily: "DM Mono, monospace", letterSpacing: "0.1em" }}
        >
          RAY SOURCE
        </text>
      </svg>
    </div>
  );
}

// ── Draggable node wrapper (edit mode) ─────────────────────────────────────
function EditableNodeGroup({
  nodeId, x, y, size,
  onMove, onResize,
  children,
}: {
  nodeId: string;
  x: number; y: number; size: number;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, delta: number) => void;
  children: React.ReactNode;
}) {
  const dragging = useRef(false);
  const startMouse = useRef({ x: 0, y: 0 });
  const startPos   = useRef({ x: 0, y: 0 });
  const [active, setActive] = useState(false);
  const onMoveCb = onMove; // capture to avoid shadowing

  function onMouseDown(e: React.MouseEvent) {
    e.stopPropagation();
    dragging.current = true;
    setActive(true);
    startMouse.current = { x: e.clientX, y: e.clientY };
    startPos.current   = { x, y };

    function handleMove(ev: MouseEvent) {
      if (!dragging.current) return;
      const dx = ev.clientX - startMouse.current.x;
      const dy = ev.clientY - startMouse.current.y;
      onMoveCb(nodeId, startPos.current.x + dx, startPos.current.y + dy);
    }
    function onUp() {
      dragging.current = false;
      setActive(false);
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", onUp);
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    e.stopPropagation();
    // scroll up = bigger, scroll down = smaller; step = 0.5
    onResize(nodeId, e.deltaY < 0 ? 0.8 : -0.8);
  }

  return (
    <g
      style={{ cursor: active ? "grabbing" : "grab" }}
      onMouseDown={onMouseDown}
      onWheel={onWheel}
    >
      {/* Selection ring */}
      <circle
        r={size * 1.55}
        fill="none"
        stroke="hsl(43 80% 60%)"
        strokeWidth={active ? 1.5 : 1}
        strokeOpacity={active ? 0.7 : 0.35}
        strokeDasharray="4 5"
        style={{ transition: "stroke-opacity 0.2s" }}
      />
      {/* Resize hint dots — top and bottom of ring */}
      <circle r={3} cx={0} cy={-(size * 1.55 + 6)}
        fill="hsl(43 85% 62%)" opacity={0.7}
        style={{ cursor: "ns-resize" }}
      />
      <circle r={3} cx={0} cy={(size * 1.55 + 6)}
        fill="hsl(43 85% 62%)" opacity={0.7}
        style={{ cursor: "ns-resize" }}
      />
      {children}
    </g>
  );
}

// ── Props ──────────────────────────────────────────────────────────────────
interface Props {
  onClose: () => void;
}

const ZOOM_SCALE = 2.2;

// ── Main ───────────────────────────────────────────────────────────────────
export default function ConstellationMenu({ onClose }: Props) {
  const [hoveredId, setHoveredId]   = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editMode, setEditMode]     = useState(false);

  // Layout overrides — loaded from localStorage, mutated in edit mode
  const [layout, setLayout] = useState<ConstellationLayout>(loadLayout);

  // Persist whenever layout changes
  useEffect(() => { saveLayout(layout); }, [layout]);

  // Apply ray offset to shared ray state whenever it changes
  useEffect(() => {
    // Pin source if user had set a position, otherwise let it drift freely
    if (layout.ray.x !== 0 || layout.ray.y !== 0) {
      const W = window.innerWidth;
      const H = window.innerHeight;
      pinRaySource(
        Math.max(0.01, Math.min(0.99, 0.5  + layout.ray.x)),
        Math.max(0.01, Math.min(0.99, 0.28 + layout.ray.y)),
      );
    } else {
      pinRaySource(null, null);
    }
    setRayDirection(layout.ray.dirAngle ?? null);
  }, [layout.ray.offsetX, layout.ray.offsetY]);

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

  // Parallax mouse spring
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const springX = useSpring(mx, { stiffness: 50, damping: 25 });
  const springY = useSpring(my, { stiffness: 50, damping: 25 });

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (selectedId || editMode) return;
    const cx = (e.clientX / dims.w) - 0.5;
    const cy = (e.clientY / dims.h) - 0.5;
    mx.set(cx * 14);
    my.set(cy * 10);
  }, [dims, mx, my, selectedId, editMode]);

  // Camera zoom
  const camScale = useMotionValue(1);
  const camX     = useMotionValue(0);
  const camY     = useMotionValue(0);

  // Node positions — merge base data with layout overrides
  const nodePositions = useMemo(() => {
    return Object.fromEntries(
      CONSTELLATION_NODES.map(n => {
        const ov = layout.nodes[n.id];
        return [
          n.id,
          {
            x:    ov ? ov.x / 100 * dims.w : (n.x / 100) * dims.w,
            y:    ov ? ov.y / 100 * dims.h : (n.y / 100) * dims.h,
            size: ov ? ov.size : n.size,
          },
        ];
      })
    );
  }, [dims, layout.nodes]);

  // Effective node data (with size override applied)
  const effectiveNodes = useMemo(() =>
    CONSTELLATION_NODES.map(n => ({
      ...n,
      size: nodePositions[n.id]?.size ?? n.size,
    })),
    [nodePositions]
  );

  // Camera zoom animation
  useEffect(() => {
    if (editMode) return; // no zoom in edit mode
    const easing  = [0.4, 0, 0.2, 1] as const;
    const duration = 0.55;
    if (selectedId) {
      const pos = nodePositions[selectedId];
      if (!pos) return;
      const tx = dims.w / 2 - pos.x * ZOOM_SCALE;
      const ty = dims.h / 2 - pos.y * ZOOM_SCALE;
      mx.set(0); my.set(0);
      animate(camScale, ZOOM_SCALE, { duration, ease: easing });
      animate(camX, tx,             { duration, ease: easing });
      animate(camY, ty,             { duration, ease: easing });
    } else {
      const easeOut = [0.0, 0, 0.4, 1] as const;
      animate(camScale, 1, { duration: 0.48, ease: easeOut });
      animate(camX,     0, { duration: 0.48, ease: easeOut });
      animate(camY,     0, { duration: 0.48, ease: easeOut });
    }
  }, [selectedId, nodePositions, dims, mx, my, camScale, camX, camY, editMode]);

  // ESC to close/deselect/exit edit
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        if (editMode) { setEditMode(false); return; }
        if (selectedId) setSelectedId(null);
        else onClose();
      }
      // E to toggle edit mode
      if (e.key === "e" || e.key === "E") {
        if (!selectedId) setEditMode(v => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, editMode, onClose]);

  // ── Edit callbacks ──────────────────────────────────────────────────────
  const handleNodeMove = useCallback((id: string, px: number, py: number) => {
    setLayout(prev => ({
      ...prev,
      nodes: {
        ...prev.nodes,
        [id]: {
          x:    Math.max(2, Math.min(98, (px / dims.w) * 100)),
          y:    Math.max(2, Math.min(98, (py / dims.h) * 100)),
          size: prev.nodes[id]?.size ?? CONSTELLATION_NODES.find(n => n.id === id)!.size,
        },
      },
    }));
  }, [dims]);

  const handleNodeResize = useCallback((id: string, delta: number) => {
    setLayout(prev => {
      const base = CONSTELLATION_NODES.find(n => n.id === id)!.size;
      const cur  = prev.nodes[id]?.size ?? base;
      const next = Math.max(8, Math.min(32, cur + delta));
      return {
        ...prev,
        nodes: {
          ...prev.nodes,
          [id]: { ...(prev.nodes[id] ?? { x: CONSTELLATION_NODES.find(n => n.id === id)!.x, y: CONSTELLATION_NODES.find(n => n.id === id)!.y }), size: next },
        },
      };
    });
  }, []);

  const handleRayDrag = useCallback((ox: number, oy: number) => {
    const x = Math.max(-0.4, Math.min(0.4, ox));
    const y = Math.max(-0.4, Math.min(0.4, oy));
    const normX = Math.max(0.01, Math.min(0.99, 0.5  + x));
    const normY = Math.max(0.01, Math.min(0.99, 0.28 + y));
    pinRaySource(normX, normY);
    setLayout(prev => ({ ...prev, ray: { ...prev.ray, x, y } }));
  }, []);

  const handleRayDirection = useCallback((angle: number | null) => {
    setLayout(prev => ({ ...prev, ray: { ...prev.ray, dirAngle: angle } }));
    setRayDirection(angle);
  }, []);

  const handleReset = useCallback(() => {
    resetLayout();
    setLayout({ nodes: {}, ray: { x: 0, y: 0, dirAngle: null } });
    pinRaySource(null, null);
    setRayDirection(null);
    setRayEditOffset(0, 0);
  }, []);

  // ── Data ────────────────────────────────────────────────────────────────
  const { data: activeProfile } = useQuery<any>({
    queryKey: ["/api/active-profile"],
    queryFn: () => apiRequest("GET", "/api/active-profile").then(r => r.json()),
  });

  const connectionPairs = useMemo(() => getConnectionPairs(), []);
  const selectedNode = effectiveNodes.find(n => n.id === selectedId) ?? null;
  const activeId     = editMode ? null : (hoveredId ?? selectedId);

  // Track camScale as a plain state so NodeBranchMenu receives a reactive value
  const [camScaleVal, setCamScaleVal] = useState(1);
  useEffect(() => {
    return camScale.on("change", v => setCamScaleVal(v));
  }, [camScale]);

  const handleSelect = useCallback((id: string | null) => {
    if (editMode) return; // no navigation in edit mode
    setSelectedId(id);
    if (id) setHoveredId(null);
  }, [editMode]);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 200, overflow: "hidden",
        width: "100vw", height: "100vh",
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => { if (!selectedId && !editMode) { mx.set(0); my.set(0); } }}
    >
      {/* Cave background */}
      <div className="rome-bg" style={{ position: "absolute", inset: 0 }} />

      {/* Particles */}
      <ParticleCanvas width={dims.w} height={dims.h} />

      {/* Light ray */}
      <LightRay zIndex={5} />

      {/* Edit mode grid overlay */}
      {editMode && (
        <svg
          style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 6 }}
          width={dims.w} height={dims.h}
        >
          {/* Subtle grid */}
          {Array.from({ length: 10 }, (_, i) => (
            <line key={`v${i}`}
              x1={(i + 1) / 10 * dims.w} y1={0}
              x2={(i + 1) / 10 * dims.w} y2={dims.h}
              stroke="hsl(43 40% 50%)" strokeWidth={0.4} strokeOpacity={0.10}
              strokeDasharray="3 8"
            />
          ))}
          {Array.from({ length: 10 }, (_, i) => (
            <line key={`h${i}`}
              x1={0} y1={(i + 1) / 10 * dims.h}
              x2={dims.w} y2={(i + 1) / 10 * dims.h}
              stroke="hsl(43 40% 50%)" strokeWidth={0.4} strokeOpacity={0.10}
              strokeDasharray="3 8"
            />
          ))}
        </svg>
      )}

      {/* Camera zoom + parallax layer */}
      <motion.div
        style={{
          position: "absolute", inset: 0,
          x: editMode ? 0 : springX,
          y: editMode ? 0 : springY,
        }}
      >
        <motion.div
          style={{
            position: "absolute", inset: 0,
            scale: editMode ? 1 : camScale,
            x:     editMode ? 0 : camX,
            y:     editMode ? 0 : camY,
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
              const nodeA = effectiveNodes.find(n => n.id === aId)!;
              const lit = !editMode && (activeId === aId || activeId === bId);
              return (
                <motion.line
                  key={`${aId}-${bId}`}
                  x1={a.x} y1={a.y}
                  x2={b.x} y2={b.y}
                  stroke={lit ? nodeA.accent : "hsl(43 30% 40%)"}
                  strokeWidth={lit ? 1 : 0.35}
                  strokeOpacity={lit ? 0.6 : editMode ? 0.22 : 0.14}
                  strokeDasharray={lit ? undefined : "3 9"}
                  animate={{ strokeOpacity: lit ? 0.6 : editMode ? 0.22 : 0.14, strokeWidth: lit ? 1 : 0.35 }}
                  transition={{ duration: 0.3 }}
                />
              );
            })}

            {/* Nodes */}
            {effectiveNodes.map((node, i) => {
              const pos = nodePositions[node.id];
              if (!pos) return null;

              const innerNode = (
                <ConstellationNode
                  node={node}
                  isHovered={!editMode && hoveredId === node.id}
                  isSelected={!editMode && selectedId === node.id}
                  isActive={!editMode && activeId !== null}
                  screenX={pos.x}
                  screenY={pos.y}
                  onHover={editMode ? () => {} : setHoveredId}
                  onSelect={editMode ? () => {} : handleSelect}
                />
              );

              return (
                <g
                  key={node.id}
                  transform={`translate(${pos.x}, ${pos.y})`}
                  style={editMode ? undefined : {
                    opacity: 0,
                    animation: `nodeReveal 0.5s cubic-bezier(0.34,1.56,0.64,1) ${0.05 + i * 0.06}s forwards`,
                  }}
                >
                  {editMode ? (
                    <EditableNodeGroup
                      nodeId={node.id}
                      x={pos.x} y={pos.y}
                      size={pos.size}
                      onMove={handleNodeMove}
                      onResize={handleNodeResize}
                    >
                      {innerNode}
                    </EditableNodeGroup>
                  ) : innerNode}
                </g>
              );
            })}

            {/* Branch menu — SVG-native, inherits camera transform */}
            {!editMode && selectedNode && (() => {
              const pos = nodePositions[selectedNode.id];
              if (!pos) return null;
              return (
                <NodeBranchMenu
                  node={selectedNode}
                  cx={pos.x}
                  cy={pos.y}
                  radius={pos.size}
                  svgW={dims.w}
                  svgH={dims.h}
                  camScale={camScaleVal}
                  onNavigate={onClose}
                  onClose={() => setSelectedId(null)}
                />
              );
            })()}

          </svg>
        </motion.div>
      </motion.div>

      {/* Ray source handle + direction handle — both HTML divs, fixed position */}
      {editMode && (() => {
        const W = window.innerWidth;
        const H = window.innerHeight;
        const srcScreenX = W * (0.5  + layout.ray.x);
        const srcScreenY = H * (0.28 + layout.ray.y);
        return (
          <>
            <RayHandle
              offset={layout.ray}
              onDrag={handleRayDrag}
            />
            <DirectionHandle
              sourceX={srcScreenX}
              sourceY={srcScreenY}
              angle={layout.ray.dirAngle}
              onAngle={handleRayDirection}
            />
          </>
        );
      })()}

      {/* Profile badge */}
      {activeProfile && !editMode && (
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

      {/* Bottom hint — switches between normal and edit mode text */}
      <div style={{ position: "absolute", bottom: 28, left: "50%", transform: "translateX(-50%)", zIndex: 30, pointerEvents: "none" }}>
        {editMode ? (
          <p style={{ fontFamily: "DM Mono, monospace", fontSize: 9, color: "hsl(43 55% 42%)", letterSpacing: "0.18em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
            DRAG NODES · SCROLL TO RESIZE · DRAG RAY SOURCE · ESC TO EXIT
          </p>
        ) : (
          <p style={{ fontFamily: "DM Mono, monospace", fontSize: 9, color: "hsl(214 20% 28%)", letterSpacing: "0.18em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
            ESC · click node to navigate
          </p>
        )}
      </div>

      {/* Edit mode toggle button — bottom right */}
      <div style={{ position: "absolute", bottom: 24, right: 24, zIndex: 30, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
        {/* Reset button — only visible in edit mode */}
        {editMode && (
          <button
            onClick={handleReset}
            style={{
              background: "hsl(0 40% 12% / 0.8)",
              border: "1px solid hsl(0 45% 30%)",
              borderRadius: 6,
              padding: "5px 10px",
              fontFamily: "DM Mono, monospace",
              fontSize: 9,
              color: "hsl(0 65% 55%)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            Reset Layout
          </button>
        )}

        {/* Edit toggle */}
        <button
          onClick={() => setEditMode(v => !v)}
          title={editMode ? "Exit edit mode (E)" : "Edit constellation layout (E)"}
          style={{
            width: 36, height: 36,
            borderRadius: "50%",
            background: editMode
              ? "hsl(43 55% 14% / 0.9)"
              : "hsl(222 20% 10% / 0.75)",
            border: `1px solid ${editMode ? "hsl(43 75% 45%)" : "hsl(43 25% 25%)"}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer",
            boxShadow: editMode ? "0 0 12px hsl(43 80% 40% / 0.4)" : "none",
            transition: "all 0.2s ease",
          }}
        >
          {editMode ? (
            // Check mark — done editing
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="hsl(43 85% 62%)" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            // Pencil
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="hsl(43 40% 45%)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          )}
        </button>
      </div>

      {/* Click-away background to deselect */}
      {selectedId && !editMode && (
        <div style={{ position: "absolute", inset: 0, zIndex: 5 }} onClick={() => setSelectedId(null)} />
      )}
    </div>
  );
}
