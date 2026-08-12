import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Focus, Loader2, RotateCcw, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ConstellationNavNode {
  id: string;
  label: string;
  group: string;
  color?: string;
  kind?: "hub" | "folder" | "item" | "tag";
  subtitle?: string;
  weight?: number;
}

export interface ConstellationNavLink {
  source: string;
  target: string;
}

export interface ConstellationNavGroup {
  id: string;
  label: string;
  color: string;
}

interface Position {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface NavigatorProps {
  nodes: ConstellationNavNode[];
  links: ConstellationNavLink[];
  groups?: ConstellationNavGroup[];
  activeId?: string | null;
  onSelect: (id: string) => void;
  emptyLabel?: string;
  className?: string;
}

interface SidebarProps extends NavigatorProps {
  title: string;
  accent: string;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  loading?: boolean;
  headerActions?: React.ReactNode;
  footer?: React.ReactNode;
  collapsedAction?: React.ReactNode;
  sidebarClassName?: string;
}

const DEPTHS = [1, 2, Infinity] as const;

function hashString(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function shortLabel(value: string, limit = 23) {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function withAlpha(color: string, alpha: number) {
  if (/^(hsl|rgb)a?\(/.test(color)) return color.replace(/\)$/, ` / ${alpha})`);
  return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`;
}

function toGraphPoint(
  e: React.PointerEvent<SVGElement>,
  svg: SVGSVGElement,
  pan: { x: number; y: number },
  zoom: number,
) {
  const rect = svg.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left - pan.x) / zoom,
    y: (e.clientY - rect.top - pan.y) / zoom,
  };
}

export function ConstellationNavigator({
  nodes,
  links,
  groups = [],
  activeId,
  onSelect,
  emptyLabel = "No nodes yet",
  className,
}: NavigatorProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const positionsRef = useRef<Map<string, Position>>(new Map());
  const fixedRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const frameRef = useRef<number | null>(null);
  const dragRef = useRef<{ id: string; moved: boolean } | null>(null);
  const panDragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const [size, setSize] = useState({ width: 280, height: 480 });
  const [tick, setTick] = useState(0);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [depthIndex, setDepthIndex] = useState(2);
  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(new Set());
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [simulationKey, setSimulationKey] = useState(0);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setSize({ width: Math.max(180, rect.width), height: Math.max(240, rect.height) });
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  const nodeMap = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes]);
  const adjacency = useMemo(() => {
    const next = new Map<string, Set<string>>();
    nodes.forEach(node => next.set(node.id, new Set()));
    links.forEach(link => {
      next.get(link.source)?.add(link.target);
      next.get(link.target)?.add(link.source);
    });
    return next;
  }, [nodes, links]);

  const visibleNodes = useMemo(
    () => nodes.filter(node => !hiddenGroups.has(node.group)),
    [nodes, hiddenGroups],
  );
  const visibleIds = useMemo(() => new Set(visibleNodes.map(node => node.id)), [visibleNodes]);
  const visibleLinks = useMemo(
    () => links.filter(link => visibleIds.has(link.source) && visibleIds.has(link.target)),
    [links, visibleIds],
  );

  const focusId = hoveredId ?? (activeId && visibleIds.has(activeId) ? activeId : null);
  const focusSet = useMemo(() => {
    const depthLimit = hoveredId ? 1 : DEPTHS[depthIndex];
    if (!focusId || depthLimit === Infinity) return null;
    const seen = new Set<string>([focusId]);
    let frontier = [focusId];
    for (let depth = 0; depth < depthLimit; depth += 1) {
      const next: string[] = [];
      frontier.forEach(id => adjacency.get(id)?.forEach(neighbor => {
        if (!seen.has(neighbor)) {
          seen.add(neighbor);
          next.push(neighbor);
        }
      }));
      frontier = next;
    }
    return seen;
  }, [focusId, hoveredId, depthIndex, adjacency]);

  const matchedIds = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return null;
    return new Set(nodes.filter(node => `${node.label} ${node.subtitle ?? ""}`.toLowerCase().includes(normalized)).map(node => node.id));
  }, [nodes, query]);

  useEffect(() => {
    const positions = positionsRef.current;
    const ids = new Set(nodes.map(node => node.id));
    Array.from(positions.keys()).forEach(id => {
      if (!ids.has(id)) positions.delete(id);
    });
    Array.from(fixedRef.current.keys()).forEach(id => {
      if (!ids.has(id)) fixedRef.current.delete(id);
    });

    const hub = nodes.find(node => node.kind === "hub");
    nodes.forEach((node, index) => {
      if (positions.has(node.id)) return;
      if (hub?.id === node.id) {
        positions.set(node.id, { x: size.width / 2, y: size.height / 2, vx: 0, vy: 0 });
        return;
      }
      const seed = hashString(node.id);
      const angle = ((seed % 360) / 180) * Math.PI;
      const ring = 55 + (index % 4) * 32 + (seed % 23);
      positions.set(node.id, {
        x: size.width / 2 + Math.cos(angle) * ring,
        y: size.height / 2 + Math.sin(angle) * ring,
        vx: 0,
        vy: 0,
      });
    });

    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    let frame = 0;
    const groupIds = Array.from(new Set(nodes.map(node => node.group)));
    const simulate = () => {
      frame += 1;
      const alpha = Math.max(0.045, 1 - frame / 260);
      const current = visibleNodes;
      const centerX = size.width / 2;
      const centerY = size.height / 2;

      for (let i = 0; i < current.length; i += 1) {
        const a = positions.get(current[i].id);
        if (!a) continue;
        for (let j = i + 1; j < current.length; j += 1) {
          const b = positions.get(current[j].id);
          if (!b) continue;
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let distSq = dx * dx + dy * dy;
          if (distSq < 1) {
            dx = 0.5;
            dy = 0.5;
            distSq = 0.5;
          }
          const dist = Math.sqrt(distSq);
          const force = Math.min(1.4, (760 * alpha) / distSq);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
        }
      }

      visibleLinks.forEach(link => {
        const a = positions.get(link.source);
        const b = positions.get(link.target);
        if (!a || !b) return;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const desired = nodeMap.get(link.source)?.kind === "hub" || nodeMap.get(link.target)?.kind === "hub" ? 88 : 66;
        const force = (dist - desired) * 0.008 * alpha;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      });

      current.forEach(node => {
        const pos = positions.get(node.id);
        if (!pos) return;
        const groupIndex = Math.max(0, groupIds.indexOf(node.group));
        const groupAngle = (groupIndex / Math.max(1, groupIds.length)) * Math.PI * 2 - Math.PI / 2;
        const groupRadius = node.kind === "hub" ? 0 : Math.min(size.width, size.height) * 0.13;
        const targetX = centerX + Math.cos(groupAngle) * groupRadius;
        const targetY = centerY + Math.sin(groupAngle) * groupRadius;
        pos.vx += (targetX - pos.x) * 0.0018 * alpha;
        pos.vy += (targetY - pos.y) * 0.0018 * alpha;
        pos.vx *= 0.86;
        pos.vy *= 0.86;
        const fixed = fixedRef.current.get(node.id);
        if (fixed) {
          pos.x = fixed.x;
          pos.y = fixed.y;
          pos.vx = 0;
          pos.vy = 0;
        } else {
          pos.x += pos.vx;
          pos.y += pos.vy;
        }
        pos.x = Math.max(22, Math.min(size.width - 22, pos.x));
        pos.y = Math.max(24, Math.min(size.height - 24, pos.y));
      });

      setTick(value => value + 1);
      if (frame < 260) frameRef.current = requestAnimationFrame(simulate);
    };
    frameRef.current = requestAnimationFrame(simulate);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [nodes, visibleNodes, visibleLinks, nodeMap, size.width, size.height, simulationKey]);

  const resetView = useCallback(() => {
    fixedRef.current.clear();
    positionsRef.current.clear();
    setPan({ x: 0, y: 0 });
    setZoom(1);
    setSimulationKey(value => value + 1);
  }, []);

  const pointerDownNode = (e: React.PointerEvent<SVGGElement>, id: string) => {
    if (!svgRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const point = toGraphPoint(e, svgRef.current, pan, zoom);
    fixedRef.current.set(id, point);
    dragRef.current = { id, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const pointerMoveNode = (e: React.PointerEvent<SVGGElement>) => {
    if (!dragRef.current || !svgRef.current) return;
    const point = toGraphPoint(e, svgRef.current, pan, zoom);
    const fixed = fixedRef.current.get(dragRef.current.id);
    if (fixed && Math.hypot(point.x - fixed.x, point.y - fixed.y) > 1.5) dragRef.current.moved = true;
    fixedRef.current.set(dragRef.current.id, point);
    const pos = positionsRef.current.get(dragRef.current.id);
    if (pos) {
      pos.x = point.x;
      pos.y = point.y;
    }
    setTick(value => value + 1);
  };

  const pointerUpNode = (e: React.PointerEvent<SVGGElement>) => {
    const dragged = dragRef.current;
    if (!dragged) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
    if (!dragged.moved) onSelect(dragged.id);
  };

  const pointerDownCanvas = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.target !== e.currentTarget && !(e.target as Element).hasAttribute("data-graph-bg")) return;
    panDragRef.current = { sx: e.clientX, sy: e.clientY, ox: pan.x, oy: pan.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const pointerMoveCanvas = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = panDragRef.current;
    if (!drag) return;
    setPan({ x: drag.ox + e.clientX - drag.sx, y: drag.oy + e.clientY - drag.sy });
  };

  const pointerUpCanvas = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!panDragRef.current) return;
    panDragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const wheelCanvas = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const next = Math.max(0.62, Math.min(2.2, zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
    setZoom(next);
  };

  const toggleGroup = (id: string) => {
    setHiddenGroups(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  void tick;

  return (
    <div ref={wrapRef} className={cn("relative min-h-[260px] flex-1 overflow-hidden bg-[hsl(222_22%_4%)]", className)}>
      <div className="absolute left-2 right-2 top-2 z-20 flex items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/45" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Find node…"
            aria-label="Find graph node"
            className="h-7 w-full rounded-sm border border-[hsl(220_18%_15%)] bg-[hsl(222_20%_7%/0.9)] pl-7 pr-6 font-mono text-[9px] tracking-wide text-foreground/75 outline-none placeholder:text-muted-foreground/30 focus:border-gold-500/35"
          />
          {query && (
            <button onClick={() => setQuery("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-foreground" title="Clear search">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <button
          onClick={() => setDepthIndex(index => (index + 1) % DEPTHS.length)}
          className="flex h-7 min-w-7 items-center justify-center rounded-sm border border-[hsl(220_18%_15%)] bg-[hsl(222_20%_7%/0.9)] px-1.5 font-mono text-[8px] text-muted-foreground hover:border-gold-500/30 hover:text-gold-400"
          title="Change connection depth"
        >
          <Focus className="mr-1 h-3 w-3" />
          {DEPTHS[depthIndex] === Infinity ? "ALL" : DEPTHS[depthIndex]}
        </button>
        <button
          onClick={resetView}
          className="flex h-7 w-7 items-center justify-center rounded-sm border border-[hsl(220_18%_15%)] bg-[hsl(222_20%_7%/0.9)] text-muted-foreground hover:border-gold-500/30 hover:text-gold-400"
          title="Reset graph"
        >
          <RotateCcw className="h-3 w-3" />
        </button>
      </div>

      {visibleNodes.length === 0 ? (
        <div className="flex h-full min-h-[260px] items-center justify-center px-6 text-center font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground/35">
          {nodes.length === 0 ? emptyLabel : "All groups hidden"}
        </div>
      ) : (
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          className="block h-full w-full touch-none cursor-grab active:cursor-grabbing"
          onPointerDown={pointerDownCanvas}
          onPointerMove={pointerMoveCanvas}
          onPointerUp={pointerUpCanvas}
          onPointerCancel={pointerUpCanvas}
          onWheel={wheelCanvas}
          role="tree"
          aria-label="Constellation navigation graph"
        >
          <defs>
            <radialGradient id="romeGraphGlow">
              <stop offset="0%" stopColor="hsl(var(--accent-h) 70% 50%)" stopOpacity="0.12" />
              <stop offset="100%" stopColor="hsl(222 22% 4%)" stopOpacity="0" />
            </radialGradient>
            <pattern id="romeGraphGrid" width="28" height="28" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="0.7" fill="hsl(var(--accent-h) 50% 50%)" opacity="0.14" />
            </pattern>
          </defs>
          <rect data-graph-bg x="0" y="0" width="100%" height="100%" fill="hsl(222 22% 4%)" />
          <rect data-graph-bg x="0" y="0" width="100%" height="100%" fill="url(#romeGraphGrid)" />
          <circle data-graph-bg cx="50%" cy="52%" r="54%" fill="url(#romeGraphGlow)" />

          <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
            {visibleLinks.map((link, index) => {
              const source = positionsRef.current.get(link.source);
              const target = positionsRef.current.get(link.target);
              if (!source || !target) return null;
              const connected = !focusId || link.source === focusId || link.target === focusId;
              const inFocus = !focusSet || (focusSet.has(link.source) && focusSet.has(link.target));
              return (
                <line
                  key={`${link.source}-${link.target}-${index}`}
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  stroke={connected ? (nodeMap.get(link.target)?.color ?? "hsl(var(--accent-h) 70% 55%)") : "hsl(218 20% 30%)"}
                  strokeWidth={connected ? 1.2 : 0.65}
                  opacity={inFocus ? (connected ? 0.72 : 0.24) : 0.045}
                />
              );
            })}

            {visibleNodes.map(node => {
              const pos = positionsRef.current.get(node.id);
              if (!pos) return null;
              const isActive = activeId === node.id;
              const isHovered = hoveredId === node.id;
              const isFocused = !focusSet || focusSet.has(node.id);
              const matches = !matchedIds || matchedIds.has(node.id);
              const degree = adjacency.get(node.id)?.size ?? 0;
              const radius = Math.min(12, 4.5 + Math.sqrt(Math.max(1, (node.weight ?? 1) + degree)) * 1.25 + (node.kind === "hub" ? 2 : 0));
              const color = node.color ?? groups.find(group => group.id === node.group)?.color ?? "hsl(var(--accent-h) 70% 58%)";
              const opacity = isFocused && matches ? 1 : matchedIds?.has(node.id) ? 0.8 : 0.12;
              const labelVisible = isActive || isHovered || node.kind === "hub" || node.kind === "folder" || visibleNodes.length <= 24 || (zoom > 1.15 && matches);
              const labelRight = pos.x < size.width * 0.64;
              return (
                <g
                  key={node.id}
                  role="treeitem"
                  aria-label={node.label}
                  aria-selected={isActive}
                  tabIndex={0}
                  transform={`translate(${pos.x} ${pos.y})`}
                  opacity={opacity}
                  className="cursor-pointer outline-none"
                  onPointerDown={e => pointerDownNode(e, node.id)}
                  onPointerMove={pointerMoveNode}
                  onPointerUp={pointerUpNode}
                  onPointerCancel={() => { dragRef.current = null; }}
                  onMouseEnter={() => setHoveredId(node.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onKeyDown={e => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(node.id);
                    }
                  }}
                >
                  <title>{node.subtitle ? `${node.label} — ${node.subtitle}` : node.label}</title>
                  {(isActive || isHovered) && (
                    <circle r={radius + 9} fill="none" stroke={color} strokeWidth="0.7" opacity="0.28">
                      <animate attributeName="r" values={`${radius + 5};${radius + 10};${radius + 5}`} dur="2.6s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.45;0.08;0.45" dur="2.6s" repeatCount="indefinite" />
                    </circle>
                  )}
                  <circle r={radius + 3.5} fill={color} opacity={isActive || isHovered ? 0.16 : 0.06} />
                  <circle r={radius} fill={node.kind === "hub" ? color : "hsl(222 24% 7%)"} stroke={color} strokeWidth={isActive ? 2 : 1.15} />
                  <circle r={Math.max(1.5, radius * 0.28)} fill={color} opacity={node.kind === "folder" ? 0.45 : 0.95} />
                  {node.kind === "folder" && (
                    <circle r={radius - 2} fill="none" stroke={color} strokeWidth="0.65" strokeDasharray="2 2" opacity="0.8" />
                  )}
                  {labelVisible && (
                    <g transform={`translate(${labelRight ? radius + 6 : -radius - 6} -1)`}>
                      <text
                        textAnchor={labelRight ? "start" : "end"}
                        dominantBaseline="central"
                        fill={isActive || isHovered ? color : "hsl(215 18% 72%)"}
                        fontFamily="DM Mono, monospace"
                        fontSize={node.kind === "hub" ? 8.5 : 7.7}
                        letterSpacing="0.02em"
                        style={{ paintOrder: "stroke", stroke: "hsl(222 22% 4%)", strokeWidth: 3, strokeLinecap: "round", strokeLinejoin: "round" }}
                      >
                        {shortLabel(node.label)}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      )}

      {groups.length > 1 && (
        <div className="absolute bottom-2 left-2 right-2 z-20 flex flex-wrap gap-1">
          {groups.map(group => {
            const hidden = hiddenGroups.has(group.id);
            return (
              <button
                key={group.id}
                onClick={() => toggleGroup(group.id)}
                className="flex items-center gap-1 rounded-sm border bg-[hsl(222_20%_6%/0.82)] px-1.5 py-1 font-mono text-[7px] uppercase tracking-[0.08em] transition-opacity"
                style={{ borderColor: withAlpha(group.color, 0.34), color: group.color, opacity: hidden ? 0.3 : 0.85 }}
                title={`${hidden ? "Show" : "Hide"} ${group.label}`}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: group.color }} />
                {group.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ConstellationSidebar({
  title,
  accent,
  collapsed,
  onCollapsedChange,
  loading,
  headerActions,
  footer,
  collapsedAction,
  sidebarClassName,
  ...navigatorProps
}: SidebarProps) {
  if (collapsed) {
    return (
      <aside className={cn("flex w-10 shrink-0 flex-col border-r border-border bg-[hsl(222_20%_5%)] transition-[width] duration-300", sidebarClassName)}>
        <div className="flex justify-center border-b border-border py-3">
          <button
            onClick={() => onCollapsedChange(false)}
            className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
            title={`Expand ${title}`}
          >
            <ChevronLeft className="h-3.5 w-3.5 rotate-180" />
          </button>
        </div>
        {collapsedAction && <div className="p-1.5">{collapsedAction}</div>}
        <div className="flex flex-1 items-center justify-center overflow-hidden">
          <span className="whitespace-nowrap font-mono text-[8px] uppercase tracking-[0.24em] text-muted-foreground/30 [writing-mode:vertical-rl]">
            {title}
          </span>
        </div>
      </aside>
    );
  }

  return (
    <aside
      className={cn("flex w-[300px] min-w-[300px] shrink-0 flex-col border-r bg-[hsl(222_20%_5%)] transition-[width] duration-300", sidebarClassName)}
      style={{ borderColor: withAlpha(accent, 0.2) }}
    >
      <div className="flex h-[49px] shrink-0 items-center justify-between border-b px-3" style={{ borderColor: withAlpha(accent, 0.16) }}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: accent, boxShadow: `0 0 10px ${accent}` }} />
          <span className="truncate font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: accent }}>{title}</span>
          {!loading && (
            <span className="rounded-sm border px-1 py-0.5 font-mono text-[7px] text-muted-foreground/45" style={{ borderColor: withAlpha(accent, 0.15) }}>
              {navigatorProps.nodes.filter(node => node.kind === "item").length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {headerActions}
          <button
            onClick={() => onCollapsedChange(true)}
            className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
            title={`Collapse ${title}`}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin opacity-30" style={{ color: accent }} />
        </div>
      ) : (
        <ConstellationNavigator {...navigatorProps} />
      )}

      {footer && <div className="shrink-0 border-t border-border bg-[hsl(222_20%_5%)] p-2">{footer}</div>}
    </aside>
  );
}
