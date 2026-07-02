import { memo } from "react";
import type { ConstellationNode as NodeData } from "@/lib/constellationData";

interface Props {
  node: NodeData;
  isHovered: boolean;
  isSelected: boolean;
  isActive: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
}

// ── Custom SVG icon definitions ────────────────────────────────────────────
// Each rendered in a local viewBox="0 0 40 40", centered at (0,0) after
// a translate(-20,-20). Use currentColor for fill/stroke so accent applies.

function PillarIcon({ color, size }: { color: string; size: number }) {
  // Greek column: base slab, capital slab, 4 fluted columns between them
  return (
    <g transform={`translate(${-size / 2}, ${-size / 2})`}>
      <svg width={size} height={size} viewBox="0 0 40 44" fill="none">
        {/* Capital (top slab) */}
        <rect x="4" y="2" width="32" height="4" rx="1" fill={color} />
        <rect x="7" y="6" width="26" height="2.5" rx="0.8" fill={color} />
        {/* Base (bottom slab) */}
        <rect x="4" y="36" width="32" height="4" rx="1" fill={color} />
        <rect x="7" y="33.5" width="26" height="2.5" rx="0.8" fill={color} />
        {/* 4 columns */}
        <rect x="8"  y="8.5" width="5" height="25" rx="1" fill={color} />
        <rect x="14.5" y="8.5" width="5" height="25" rx="1" fill={color} />
        <rect x="20.5" y="8.5" width="5" height="25" rx="1" fill={color} />
        <rect x="27" y="8.5" width="5" height="25" rx="1" fill={color} />
      </svg>
    </g>
  );
}

function EyeIcon({ color, size }: { color: string; size: number }) {
  // Solid filled eye — almond shape with white ring pupil like reference image
  return (
    <g transform={`translate(${-size / 2}, ${-size / 2})`}>
      <svg width={size} height={size} viewBox="0 0 60 40" fill="none">
        {/* Almond / eye outline filled solid */}
        <path
          d="M2 20 C10 4 50 4 58 20 C50 36 10 36 2 20 Z"
          fill={color}
        />
        {/* White ring (iris) */}
        <circle cx="30" cy="20" r="9" fill="none" stroke="hsl(222 16% 7%)" strokeWidth="3.5" />
        {/* Pupil */}
        <circle cx="30" cy="20" r="5" fill="hsl(222 16% 7%)" />
      </svg>
    </g>
  );
}

function FlaskIcon({ color, size }: { color: string; size: number }) {
  // Erlenmeyer flask — neck + triangular body half-filled, sparkle stars around it
  return (
    <g transform={`translate(${-size / 2}, ${-size / 2})`}>
      <svg width={size} height={size} viewBox="0 0 48 52" fill="none">
        {/* Neck */}
        <rect x="18" y="2" width="12" height="3" rx="1.5" fill={color} />
        <rect x="19.5" y="5" width="9" height="13" rx="1" fill={color} opacity="0.9" />
        {/* Flask body outline */}
        <path
          d="M19.5 18 L6 44 Q5 46 7 46 L41 46 Q43 46 42 44 L28.5 18 Z"
          fill={color}
          opacity="0.22"
          stroke={color}
          strokeWidth="1.6"
        />
        {/* Liquid fill — lower half */}
        <path
          d="M13 36 L6 44 Q5 46 7 46 L41 46 Q43 46 42 44 L35 36 Z"
          fill={color}
          opacity="0.85"
        />
        {/* Bubbles in liquid */}
        <circle cx="18" cy="41" r="2.2" fill="hsl(222 16% 7%)" opacity="0.7" />
        <circle cx="28" cy="43" r="1.5" fill="hsl(222 16% 7%)" opacity="0.6" />
        <circle cx="34" cy="40" r="1.8" fill="hsl(222 16% 7%)" opacity="0.6" />
        {/* Sparkle stars — 4-point */}
        {/* top-left */}
        <path d="M6 10 L7 13 L10 14 L7 15 L6 18 L5 15 L2 14 L5 13 Z" fill={color} opacity="0.7" />
        {/* top-right */}
        <path d="M40 8 L41 11 L44 12 L41 13 L40 16 L39 13 L36 12 L39 11 Z" fill={color} opacity="0.6" />
        {/* right-mid */}
        <path d="M43 26 L44 28.5 L46.5 29.5 L44 30.5 L43 33 L42 30.5 L39.5 29.5 L42 28.5 Z" fill={color} opacity="0.5" />
        {/* left-mid small */}
        <path d="M3 22 L3.7 24 L5.7 24.7 L3.7 25.4 L3 27.4 L2.3 25.4 L0.3 24.7 L2.3 24 Z" fill={color} opacity="0.45" />
      </svg>
    </g>
  );
}

// ── Main node component ────────────────────────────────────────────────────
export default memo(function ConstellationNode({
  node, isHovered, isSelected, isActive, onHover, onSelect,
}: Props) {
  // Idle: dark semi-transparent (just barely visible silhouette)
  // Hovered: gold highlight from "ray" catching the icon
  // Selected: same gold ray-shine, no accent color change
  const lit    = isHovered || isSelected;
  const dimmed = isActive && !lit;
  const iconSize = node.size * 2.6;
  const hitRadius = iconSize * 0.55;

  // Icon color: idle = very dark translucent charcoal, lit = warm gold catch-light
  const color = lit
    ? "hsl(43 75% 72%)"           // warm gold — simulates ray shining on the icon
    : "hsl(220 12% 22% / 0.55)";  // dark semi-transparent at rest

  // Glow: lit = warm gold beam-scatter (not accent color), idle = none
  const glowFilter = lit
    ? `drop-shadow(0 0 ${Math.round(iconSize * 0.32)}px hsl(43 80% 60% / 0.8)) drop-shadow(0 0 ${Math.round(iconSize * 0.14)}px hsl(43 70% 50% / 0.5))`
    : "none";

  function renderIcon() {
    switch (node.id) {
      case "philosophy":
        return <PillarIcon color={color} size={iconSize} />;
      case "investigative":
        return <EyeIcon color={color} size={iconSize} />;
      case "alchemy":
        return <FlaskIcon color={color} size={iconSize} />;
      default:
        // Fallback: text symbol
        return (
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={iconSize}
            fill={color}
            style={{
              fontFamily: "DM Sans, sans-serif",
              userSelect: "none",
              pointerEvents: "none",
            }}
          >
            {node.symbol}
          </text>
        );
    }
  }

  return (
    <g
      style={{
        cursor: "pointer",
        opacity: dimmed ? 0.18 : 1,
        transition: "opacity 0.3s ease",
        filter: glowFilter,
      }}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onSelect(isSelected ? null : node.id)}
    >
      {/* Invisible hit area */}
      <circle r={hitRadius} fill="transparent" />

      {/* Outer glow halo */}
      {lit && (
        <circle
          r={hitRadius * 0.95}
          fill="hsl(43 80% 60%)"
          opacity={0.1}
          style={{
            filter: `blur(${Math.round(hitRadius * 0.8)}px)`,
            animation: "outerPulse 2.4s ease-in-out infinite",
            transformOrigin: "0 0",
          }}
        />
      )}

      {/* Icon */}
      <g style={{ transition: "filter 0.25s ease", pointerEvents: "none" }}>
        {renderIcon()}
      </g>

      {/* Label below when lit */}
      <text
        y={iconSize * 0.68}
        textAnchor="middle"
        fontSize={8.5}
        fill="hsl(43 75% 68%)"
        opacity={lit ? 0.85 : 0}
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

      {/* Idle shimmer dot */}
      {!lit && (
        <circle
          r={1.6}
          cx={hitRadius * 0.55}
          cy={-hitRadius * 0.55}
          fill="hsl(220 12% 30%)"
          opacity={0.4}
          style={{
            animation: `idleDot ${2.2 + node.depth}s ease-in-out infinite`,
          }}
        />
      )}
    </g>
  );
});
