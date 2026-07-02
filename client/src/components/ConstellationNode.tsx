import { memo, useEffect, useRef, useState } from "react";
import type { ConstellationNode as NodeData } from "@/lib/constellationData";
import { getRayState, computeSourcePos } from "@/lib/lightRayState";

interface Props {
  node: NodeData;
  isHovered: boolean;
  isSelected: boolean;
  isActive: boolean;
  screenX: number;   // node's actual screen pixel X (for ray angle)
  screenY: number;   // node's actual screen pixel Y
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
}

// ── Custom SVG icon definitions ────────────────────────────────────────────
function PillarIcon({ color, size }: { color: string; size: number }) {
  return (
    <g transform={`translate(${-size / 2}, ${-size / 2})`}>
      <svg width={size} height={size} viewBox="0 0 40 44" fill="none">
        <rect x="4"    y="2"    width="32" height="4"    rx="1"   fill={color} />
        <rect x="7"    y="6"    width="26" height="2.5"  rx="0.8" fill={color} />
        <rect x="4"    y="36"   width="32" height="4"    rx="1"   fill={color} />
        <rect x="7"    y="33.5" width="26" height="2.5"  rx="0.8" fill={color} />
        <rect x="8"    y="8.5"  width="5"  height="25"   rx="1"   fill={color} />
        <rect x="14.5" y="8.5"  width="5"  height="25"   rx="1"   fill={color} />
        <rect x="20.5" y="8.5"  width="5"  height="25"   rx="1"   fill={color} />
        <rect x="27"   y="8.5"  width="5"  height="25"   rx="1"   fill={color} />
      </svg>
    </g>
  );
}

function EyeIcon({ color, size }: { color: string; size: number }) {
  return (
    <g transform={`translate(${-size / 2}, ${-size / 2})`}>
      <svg width={size} height={size} viewBox="0 0 60 40" fill="none">
        <path d="M2 20 C10 4 50 4 58 20 C50 36 10 36 2 20 Z" fill={color} />
        <circle cx="30" cy="20" r="9"  fill="none" stroke="hsl(222 16% 7%)" strokeWidth="3.5" />
        <circle cx="30" cy="20" r="5"  fill="hsl(222 16% 7%)" />
      </svg>
    </g>
  );
}

function FlaskIcon({ color, size }: { color: string; size: number }) {
  return (
    <g transform={`translate(${-size / 2}, ${-size / 2})`}>
      <svg width={size} height={size} viewBox="0 0 48 52" fill="none">
        <rect x="18"   y="2"  width="12" height="3"  rx="1.5" fill={color} />
        <rect x="19.5" y="5"  width="9"  height="13" rx="1"   fill={color} opacity="0.9" />
        <path d="M19.5 18 L6 44 Q5 46 7 46 L41 46 Q43 46 42 44 L28.5 18 Z"
          fill={color} opacity="0.22" stroke={color} strokeWidth="1.6" />
        <path d="M13 36 L6 44 Q5 46 7 46 L41 46 Q43 46 42 44 L35 36 Z"
          fill={color} opacity="0.85" />
        <circle cx="18" cy="41" r="2.2" fill="hsl(222 16% 7%)" opacity="0.7" />
        <circle cx="28" cy="43" r="1.5" fill="hsl(222 16% 7%)" opacity="0.6" />
        <circle cx="34" cy="40" r="1.8" fill="hsl(222 16% 7%)" opacity="0.6" />
        <path d="M6 10 L7 13 L10 14 L7 15 L6 18 L5 15 L2 14 L5 13 Z"    fill={color} opacity="0.7" />
        <path d="M40 8 L41 11 L44 12 L41 13 L40 16 L39 13 L36 12 L39 11 Z" fill={color} opacity="0.6" />
        <path d="M43 26 L44 28.5 L46.5 29.5 L44 30.5 L43 33 L42 30.5 L39.5 29.5 L42 28.5 Z" fill={color} opacity="0.5" />
        <path d="M3 22 L3.7 24 L5.7 24.7 L3.7 25.4 L3 27.4 L2.3 25.4 L0.3 24.7 L2.3 24 Z" fill={color} opacity="0.45" />
      </svg>
    </g>
  );
}

// ── Dark glass node background ─────────────────────────────────────────────
// Rendered as a foreign SVG rect so we can apply real CSS backdrop-filter.
// Falls back gracefully if backdrop-filter isn't supported.
function GlassBackground({
  size,
  borderColor,
  borderOpacity,
  glowColor,
  glowStrength,
}: {
  size: number;
  borderColor: string;
  borderOpacity: number;
  glowColor: string;
  glowStrength: number;
}) {
  const r = size * 0.52;  // radius of the glass circle
  return (
    <>
      {/* Dark fill circle — the "glass" body */}
      <circle
        r={r}
        fill="hsl(220 20% 6% / 0.72)"
        stroke={borderColor}
        strokeWidth={1.8}
        strokeOpacity={borderOpacity}
        style={{
          filter: glowStrength > 0
            ? `drop-shadow(0 0 ${glowStrength}px ${glowColor}) drop-shadow(0 0 ${glowStrength * 0.4}px ${glowColor})`
            : undefined,
          transition: "stroke-opacity 0.4s ease, filter 0.4s ease",
        }}
      />
      {/* Inner highlight rim — simulates glass catching light on top edge */}
      <circle
        r={r * 0.88}
        fill="none"
        stroke="hsl(43 80% 80%)"
        strokeWidth={0.6}
        strokeOpacity={0.06}
      />
    </>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export default memo(function ConstellationNode({
  node, isHovered, isSelected, isActive,
  screenX, screenY,
  onHover, onSelect,
}: Props) {
  const lit    = isHovered || isSelected;
  const dimmed = isActive && !lit;
  const iconSize = node.size * 2.4;
  const hitRadius = iconSize * 0.62;

  // ── Ray-driven border state ──────────────────────────────────────────────
  // Read the shared ray position each frame and compute how directly the ray
  // hits this node. On selection, border brightens further.
  const [rayIntensity, setRayIntensity] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    function update() {
      const state = getRayState();
      const { sx, sy } = computeSourcePos(state.t);
      const srcXpx = sx * window.innerWidth;
      const srcYpx = sy * window.innerHeight;

      const dx = screenX - srcXpx;
      const dy = screenY - srcYpx;
      const dist = Math.sqrt(dx * dx + dy * dy) / Math.max(window.innerWidth, window.innerHeight);
      const falloff = Math.max(0, 1 - dist * 1.5);
      setRayIntensity(falloff * falloff);

      rafRef.current = requestAnimationFrame(update);
    }
    rafRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(rafRef.current);
  }, [screenX, screenY]);

  // ── Visual parameters ────────────────────────────────────────────────────
  // Icon itself: always the same dark-glass color — the BORDER does the talking.
  // At rest: very dim icon inside glass. Hovered/selected: slightly brighter icon.
  const iconColor = lit
    ? "hsl(43 60% 68% / 0.9)"    // warm gold tint when touched — ray catching surface
    : "hsl(220 10% 35% / 0.65)"; // dark, barely visible at rest

  // Border: ray ambient + selection boost
  const ambientBorder = rayIntensity * 0.45 + 0.1;
  const borderOpacity = lit
    ? Math.min(1, ambientBorder + 0.55)  // strong gold ring when selected/hovered
    : ambientBorder;
  const borderColor = "hsl(43 80% 60%)";

  // Glow: only when lit (hovered or selected) — outer ring bloom
  const glowStrength = lit ? 8 + rayIntensity * 12 : rayIntensity * 4;
  const glowColor    = "hsl(43 85% 58%)";

  return (
    <g
      style={{
        cursor: "pointer",
        opacity: dimmed ? 0.2 : 1,
        transition: "opacity 0.3s ease",
      }}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onSelect(isSelected ? null : node.id)}
    >
      {/* Invisible hit area */}
      <circle r={hitRadius} fill="transparent" />

      {/* Dark glass background + ray-lit border */}
      <GlassBackground
        size={iconSize}
        borderColor={borderColor}
        borderOpacity={borderOpacity}
        glowColor={glowColor}
        glowStrength={glowStrength}
      />

      {/* Icon */}
      <g style={{ pointerEvents: "none" }}>
        {node.id === "philosophy"   && <PillarIcon color={iconColor} size={iconSize * 0.72} />}
        {node.id === "investigative" && <EyeIcon   color={iconColor} size={iconSize * 0.72} />}
        {node.id === "alchemy"       && <FlaskIcon color={iconColor} size={iconSize * 0.72} />}
        {node.id !== "philosophy" && node.id !== "investigative" && node.id !== "alchemy" && (
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={iconSize * 0.52}
            fill={iconColor}
            style={{ fontFamily: "DM Sans, sans-serif", userSelect: "none" }}
          >
            {node.symbol}
          </text>
        )}
      </g>

      {/* Label — below when lit */}
      <text
        y={iconSize * 0.7}
        textAnchor="middle"
        fontSize={8.5}
        fill="hsl(43 75% 68%)"
        opacity={lit ? 0.9 : 0}
        style={{
          fontFamily: "'Cinzel', serif",
          letterSpacing: "0.09em",
          textTransform: "uppercase",
          userSelect: "none",
          transition: "opacity 0.2s ease",
          pointerEvents: "none",
        }}
      >
        {node.label}
      </text>

      {/* Idle shimmer dot — subtle pulse top-right */}
      {!lit && (
        <circle
          r={1.4}
          cx={hitRadius * 0.5}
          cy={-hitRadius * 0.5}
          fill="hsl(43 55% 55%)"
          opacity={0.25 + rayIntensity * 0.3}
          style={{ animation: `idleDot ${2.2 + node.depth}s ease-in-out infinite` }}
        />
      )}
    </g>
  );
});
