/**
 * ConstellationNode — minimal icon with dark 3D glass fill.
 *
 * No circles. The icon SHAPE itself carries the glass material:
 *   - Deep dark semi-transparent fill
 *   - Bright top-edge highlight (light catching the glass surface from above)
 *   - Subtle inner shadow at bottom (depth)
 *   - Gold border glow only when ray hits or node is selected
 *
 * Inspired by Robinhood's dark glass UI: confident, minimal, premium.
 */

import { memo, useEffect, useRef, useState } from "react";
import type { ConstellationNode as NodeData } from "@/lib/constellationData";
import { getRayState, computeSourcePos } from "@/lib/lightRayState";

interface Props {
  node: NodeData;
  isHovered: boolean;
  isSelected: boolean;
  isActive: boolean;
  screenX: number;
  screenY: number;
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// SVG defs injected once — glass gradients shared across all nodes
// ─────────────────────────────────────────────────────────────────────────────
export function GlassDefs() {
  return (
    <defs>
      {/* Glass body fill — dark, semi-transparent, with subtle inner depth */}
      <linearGradient id="glassBody" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stopColor="hsl(220 22% 14%)" stopOpacity="0.88" />
        <stop offset="40%"  stopColor="hsl(222 20% 9%)"  stopOpacity="0.92" />
        <stop offset="100%" stopColor="hsl(224 24% 5%)"  stopOpacity="0.96" />
      </linearGradient>

      {/* Top-edge specular — the bright streak where overhead light hits glass */}
      <linearGradient id="glassSpec" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stopColor="hsl(210 60% 90%)" stopOpacity="0.30" />
        <stop offset="18%"  stopColor="hsl(210 50% 80%)" stopOpacity="0.10" />
        <stop offset="45%"  stopColor="hsl(210 40% 70%)" stopOpacity="0" />
        <stop offset="100%" stopColor="hsl(210 40% 70%)" stopOpacity="0" />
      </linearGradient>
    </defs>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Glass fill applied to any closed SVG shape via clipPath trick
// We render: dark fill layer + specular overlay + optional gold rim glow
// ─────────────────────────────────────────────────────────────────────────────
interface GlassShapeProps {
  id: string;           // unique clip-path id
  children: React.ReactNode; // the closed path/shape once (used for clip)
  borderColor: string;
  borderOpacity: number;
  glowStrength: number;
  size: number;         // bounding box height (for gradient coverage)
}

function GlassShape({ id, children, borderColor, borderOpacity, glowStrength, size }: GlassShapeProps) {
  const clipId = `clip-${id}`;
  return (
    <g>
      <defs>
        <clipPath id={clipId}>{children}</clipPath>
      </defs>

      {/* Dark glass body */}
      <g clipPath={`url(#${clipId})`}>
        <rect
          x={-size / 2} y={-size / 2}
          width={size} height={size}
          fill="url(#glassBody)"
        />
        {/* Specular highlight — top portion only */}
        <rect
          x={-size / 2} y={-size / 2}
          width={size} height={size}
          fill="url(#glassSpec)"
        />
      </g>

      {/* Border — the actual shape outline, glows gold when lit */}
      <g
        style={{
          filter: glowStrength > 0
            ? `drop-shadow(0 0 ${glowStrength}px ${borderColor}) drop-shadow(0 0 ${glowStrength * 0.5}px ${borderColor})`
            : undefined,
          transition: "filter 0.4s ease",
        }}
      >
        <g opacity={borderOpacity} style={{ transition: "opacity 0.35s ease" }}>
          {children}
        </g>
      </g>
    </g>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Icon shape definitions — outline paths only (no fill, used as clip + border)
// ─────────────────────────────────────────────────────────────────────────────

function PillarShape({ color, s }: { color: string; s: number }) {
  // Greek pillar — 4 columns with cornice top & base
  return (
    <g transform={`translate(${-s / 2}, ${-s / 2})`}>
      <svg width={s} height={s} viewBox="0 0 40 44" fill="none">
        <rect x="3"    y="1.5"  width="34" height="4"   rx="1"   stroke={color} strokeWidth="1.5" />
        <rect x="6"    y="5.5"  width="28" height="2.5" rx="0.7" stroke={color} strokeWidth="1"   />
        <rect x="3"    y="38.5" width="34" height="4"   rx="1"   stroke={color} strokeWidth="1.5" />
        <rect x="6"    y="36"   width="28" height="2.5" rx="0.7" stroke={color} strokeWidth="1"   />
        <rect x="7.5"  y="8"    width="5"  height="28"  rx="1"   stroke={color} strokeWidth="1.2" />
        <rect x="14"   y="8"    width="5"  height="28"  rx="1"   stroke={color} strokeWidth="1.2" />
        <rect x="20.5" y="8"    width="5"  height="28"  rx="1"   stroke={color} strokeWidth="1.2" />
        <rect x="27"   y="8"    width="5"  height="28"  rx="1"   stroke={color} strokeWidth="1.2" />
      </svg>
    </g>
  );
}

function EyeShape({ color, s }: { color: string; s: number }) {
  return (
    <g transform={`translate(${-s / 2}, ${-s / 2})`}>
      <svg width={s} height={s} viewBox="0 0 60 40" fill="none">
        <path d="M2 20 C10 4 50 4 58 20 C50 36 10 36 2 20 Z"
          stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
        <circle cx="30" cy="20" r="9"  stroke={color} strokeWidth="1.4" />
        <circle cx="30" cy="20" r="4.5" fill={color} opacity="0.9" />
        <circle cx="27.5" cy="17.5" r="1.4" fill="white" opacity="0.55" />
      </svg>
    </g>
  );
}

function SwordsShape({ color, s }: { color: string; s: number }) {
  // Two swords crossed at center — sword 1: top-left to bottom-right
  //                                sword 2: top-right to bottom-left
  return (
    <svg width={s} height={s} viewBox="0 0 40 40" fill="none" x={-s/2} y={-s/2}>
      {/* Sword 1: blade top-left → bottom-right, hilt bottom-right */}
      {/* Blade */}
      <line x1="5" y1="5" x2="28" y2="28" stroke={color} strokeWidth="2" strokeLinecap="round"/>
      {/* Tip sharpening (narrow end) */}
      <line x1="26" y1="26" x2="30" y2="30" stroke={color} strokeWidth="1.2" strokeLinecap="round"/>
      {/* Guard (crossguard perpendicular to blade) */}
      <line x1="29" y1="24" x2="24" y2="29" stroke={color} strokeWidth="2" strokeLinecap="round"/>
      {/* Grip */}
      <line x1="31" y1="31" x2="36" y2="36" stroke={color} strokeWidth="1.8" strokeLinecap="round"/>
      {/* Pommel dot */}
      <circle cx="36.5" cy="36.5" r="1.4" fill={color}/>

      {/* Sword 2: blade top-right → bottom-left, hilt bottom-left */}
      {/* Blade */}
      <line x1="35" y1="5" x2="12" y2="28" stroke={color} strokeWidth="2" strokeLinecap="round"/>
      {/* Tip */}
      <line x1="14" y1="26" x2="10" y2="30" stroke={color} strokeWidth="1.2" strokeLinecap="round"/>
      {/* Guard */}
      <line x1="11" y1="24" x2="16" y2="29" stroke={color} strokeWidth="2" strokeLinecap="round"/>
      {/* Grip */}
      <line x1="9" y1="31" x2="4" y2="36" stroke={color} strokeWidth="1.8" strokeLinecap="round"/>
      {/* Pommel dot */}
      <circle cx="3.5" cy="36.5" r="1.4" fill={color}/>
    </svg>
  );
}

function CrownShape({ color, s }: { color: string; s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" x={-s/2} y={-s/2}>
      <path d="M2 19h20" stroke={color} strokeWidth="1.6" strokeLinecap="round"/>
      <path d="M2 19l3-10 4.5 4L12 5l2.5 8L19 9l3 10"
        stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </svg>
  );
}

function GlobeShape({ color, s }: { color: string; s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 40 40" fill="none" x={-s/2} y={-s/2}>
      {/* Outer circle */}
      <circle cx="20" cy="20" r="15" stroke={color} strokeWidth="1.5" />
      {/* Equator */}
      <ellipse cx="20" cy="20" rx="15" ry="5.5" stroke={color} strokeWidth="1.1" />
      {/* Vertical meridian */}
      <ellipse cx="20" cy="20" rx="7.5" ry="15" stroke={color} strokeWidth="1.1" />
      {/* Lat line upper */}
      <ellipse cx="20" cy="14" rx="11.5" ry="3.2" stroke={color} strokeWidth="0.9" opacity="0.65" />
      {/* Lat line lower */}
      <ellipse cx="20" cy="26" rx="11.5" ry="3.2" stroke={color} strokeWidth="0.9" opacity="0.65" />
      {/* North/south poles */}
      <circle cx="20" cy="5"  r="1" fill={color} opacity="0.8" />
      <circle cx="20" cy="35" r="1" fill={color} opacity="0.8" />
    </svg>
  );
}

function FundingShape({ color, s }: { color: string; s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 40 40" fill="none" x={-s/2} y={-s/2}>
      <path d="M6 14L20 6l14 8" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 15h24M7 32h26M5 35h30" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
      <path d="M11 17v13M17 17v13M23 17v13M29 17v13" stroke={color} strokeWidth="1.35" strokeLinecap="round" />
      <circle cx="20" cy="11.5" r="2" stroke={color} strokeWidth="1.1" />
      <path d="M20 9.5v4" stroke={color} strokeWidth="0.9" opacity="0.7" />
    </svg>
  );
}

function AcademiaShape({ color, s }: { color: string; s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 48 42" fill="none" x={-s/2} y={-s/2}>
      <path d="M3 15.5 24 5l21 10.5L24 26 3 15.5Z" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M12 20v10c6.5 5.8 17.5 5.8 24 0V20" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M44.5 16v13" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="44.5" cy="31.5" r="2.2" stroke={color} strokeWidth="1.2" />
      <path d="M17 24.5c4.5 2.2 9.5 2.2 14 0" stroke={color} strokeWidth="1" opacity=".65" />
    </svg>
  );
}

function SparklesShape({ color, s }: { color: string; s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" x={-s/2} y={-s/2}>
      <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"
        stroke={color} strokeWidth="1.5" strokeLinejoin="round"/>
      <path d="M19 3l.8 2.2L22 6l-2.2.8L19 9l-.8-2.2L16 6l2.2-.8L19 3z"
        stroke={color} strokeWidth="1.2" strokeLinejoin="round" fill={color} fillOpacity="0.6"/>
      <path d="M5 15l.7 1.8L7.5 17.5l-1.8.7L5 20l-.7-1.8L2.5 17.5l1.8-.7L5 15z"
        stroke={color} strokeWidth="1.2" strokeLinejoin="round" fill={color} fillOpacity="0.5"/>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
export default memo(function ConstellationNode({
  node, isHovered, isSelected, isActive,
  screenX, screenY,
  onHover, onSelect,
}: Props) {
  const lit    = isHovered || isSelected;
  const dimmed = isActive && !lit;

  const iconSize  = node.size * 2.6;
  const hitRadius = iconSize * 0.58;

  // ── Ray proximity ─────────────────────────────────────────────────────
  const [rayIntensity, setRayIntensity] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    function update() {
      const rs = getRayState();
      const { sx, sy } = computeSourcePos(rs.t);
      const srcXpx = sx * window.innerWidth;
      const srcYpx = sy * window.innerHeight;
      const dx = screenX - srcXpx;
      const dy = screenY - srcYpx;
      const dist = Math.sqrt(dx * dx + dy * dy) / Math.max(window.innerWidth, window.innerHeight);
      const falloff = Math.max(0, 1 - dist * 1.4);
      setRayIntensity(falloff * falloff);
      rafRef.current = requestAnimationFrame(update);
    }
    rafRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(rafRef.current);
  }, [screenX, screenY]);

  // ── Visual params ─────────────────────────────────────────────────────
  // Icon stroke: cool blue-white glass at rest → warm gold under ray / when selected
  const warm = rayIntensity * 0.5 + (lit ? 0.55 : 0);
  // Read accent hue from CSS var so it respects the user's accent colour choice
  const accentHue = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--accent-h").trim()) || 43;
  const hue  = Math.round(210 - warm * (210 - accentHue));   // 210 blue → accentHue
  const sat  = Math.round(65  + warm * 22);
  const lum  = Math.round(72  + warm * 14);
  const opa  = lit ? 0.95 : 0.50 + rayIntensity * 0.28;
  const iconColor = `hsla(${hue}, ${sat}%, ${lum}%, ${opa})`;

  // Border/glow
  const borderBase    = rayIntensity * 0.45 + 0.12;
  const borderOpacity = lit ? Math.min(1, borderBase + 0.52) : borderBase;
  const borderColor   = lit ? "hsl(var(--accent-h) 85% 62%)" : `hsl(${hue} ${sat}% ${lum}%)`;
  const glowStr       = lit ? 8 + rayIntensity * 12 : rayIntensity * 4;

  const s = iconSize * 0.72; // icon inner size

  return (
    <g
      style={{
        cursor: "pointer",
        opacity: dimmed ? 0.16 : 1,
        transition: "opacity 0.3s ease",
      }}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onSelect(isSelected ? null : node.id)}
    >
      {/* Shared glass gradient defs (safe to repeat — browser dedupes by id) */}
      <GlassDefs />

      {/* Invisible hit area */}
      <circle r={hitRadius} fill="transparent" />

      {/* Icon — glass-filled stroke shape, no surrounding circle */}
      <g
        style={{
          filter: glowStr > 0
            ? `drop-shadow(0 0 ${glowStr}px ${borderColor})`
            : undefined,
          transition: "filter 0.35s ease",
          opacity: borderOpacity,
        }}
        pointerEvents="none"
      >
        {node.id === "philosophy"    && <PillarShape   color={iconColor} s={s} />}
        {node.id === "investigative" && <EyeShape      color={iconColor} s={s} />}
        {node.id === "athena"        && <SwordsShape   color={iconColor} s={s} />}
        {node.id === "strategic"     && <CrownShape    color={iconColor} s={s} />}
        {node.id === "creative"      && <SparklesShape color={iconColor} s={s} />}
        {node.id === "world"          && <GlobeShape    color={iconColor} s={s} />}
        {node.id === "financial"      && <FundingShape  color={iconColor} s={s} />}
        {node.id === "academia"       && <AcademiaShape color={iconColor} s={s} />}
      </g>

      {/* Label — fades in on hover/select */}
      <text
        y={s * 0.70}
        textAnchor="middle"
        fontSize={8.5}
        fill="hsl(var(--accent-h) 75% 68%)"
        opacity={lit ? 0.9 : 0}
        style={{
          fontFamily: "'Cinzel', serif",
          letterSpacing: "0.09em",
          userSelect: "none",
          transition: "opacity 0.2s ease",
          pointerEvents: "none",
        }}
      >
        {node.label}
      </text>

      {/* Idle pulse dot */}
      {!lit && (
        <circle
          r={1.2}
          cx={hitRadius * 0.5}
          cy={-hitRadius * 0.5}
          fill={`hsl(${hue} 65% 68%)`}
          opacity={0.18 + rayIntensity * 0.22}
          style={{ animation: `idleDot ${2.2 + node.depth}s ease-in-out infinite` }}
        />
      )}
    </g>
  );
});
