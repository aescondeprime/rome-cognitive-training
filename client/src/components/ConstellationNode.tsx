/**
 * ConstellationNode — dark glass circle with luminous stroke icons.
 *
 * Visual language matches the reference: semi-transparent dark glass body,
 * blue-white glowing stroke that makes the icon look etched in glass.
 * When the light ray shines on the node from above, the top border brightens gold.
 * On select/hover, the glass-edge glow intensifies.
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
// SVG icon definitions — stroke-based so they look etched in glass.
// All strokes use `color` which is driven by ray + select state.
// ─────────────────────────────────────────────────────────────────────────────

function PillarIcon({ color, glowColor, size }: { color: string; glowColor: string; size: number }) {
  const s = size;
  return (
    <g transform={`translate(${-s / 2}, ${-s / 2})`} style={{ filter: `drop-shadow(0 0 3px ${glowColor}) drop-shadow(0 0 7px ${glowColor})` }}>
      <svg width={s} height={s} viewBox="0 0 40 44" fill="none">
        {/* Cornice top */}
        <rect x="3"    y="1.5"  width="34" height="4"   rx="1"   stroke={color} strokeWidth="1.4" fill="none" />
        <rect x="6"    y="5.5"  width="28" height="2.5" rx="0.7" stroke={color} strokeWidth="1"   fill="none" />
        {/* Base */}
        <rect x="3"    y="38.5" width="34" height="4"   rx="1"   stroke={color} strokeWidth="1.4" fill="none" />
        <rect x="6"    y="36"   width="28" height="2.5" rx="0.7" stroke={color} strokeWidth="1"   fill="none" />
        {/* Columns — 4 fluted shafts */}
        <rect x="7.5"  y="8"    width="5"  height="28"  rx="1"   stroke={color} strokeWidth="1.2" fill="none" />
        <rect x="14"   y="8"    width="5"  height="28"  rx="1"   stroke={color} strokeWidth="1.2" fill="none" />
        <rect x="20.5" y="8"    width="5"  height="28"  rx="1"   stroke={color} strokeWidth="1.2" fill="none" />
        <rect x="27"   y="8"    width="5"  height="28"  rx="1"   stroke={color} strokeWidth="1.2" fill="none" />
      </svg>
    </g>
  );
}

function EyeIcon({ color, glowColor, size }: { color: string; glowColor: string; size: number }) {
  const s = size;
  return (
    <g transform={`translate(${-s / 2}, ${-s / 2})`} style={{ filter: `drop-shadow(0 0 3px ${glowColor}) drop-shadow(0 0 7px ${glowColor})` }}>
      <svg width={s} height={s} viewBox="0 0 60 40" fill="none">
        {/* Outer eye shape */}
        <path d="M2 20 C10 4 50 4 58 20 C50 36 10 36 2 20 Z"
          fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
        {/* Iris ring */}
        <circle cx="30" cy="20" r="9"  fill="none" stroke={color} strokeWidth="1.4" />
        {/* Pupil */}
        <circle cx="30" cy="20" r="4.5" fill={color} opacity="0.85" />
        {/* Inner specular highlight */}
        <circle cx="27.5" cy="17.5" r="1.5" fill="white" opacity="0.5" />
      </svg>
    </g>
  );
}

function FlaskIcon({ color, glowColor, size }: { color: string; glowColor: string; size: number }) {
  const s = size;
  return (
    <g transform={`translate(${-s / 2}, ${-s / 2})`} style={{ filter: `drop-shadow(0 0 3px ${glowColor}) drop-shadow(0 0 7px ${glowColor})` }}>
      <svg width={s} height={s} viewBox="0 0 48 52" fill="none">
        {/* Mouth of flask */}
        <rect x="17.5" y="2"  width="13" height="3"  rx="1.5" stroke={color} strokeWidth="1.3" fill="none" />
        {/* Neck */}
        <rect x="19.5" y="5"  width="9"  height="13" rx="1"   stroke={color} strokeWidth="1.2" fill="none" />
        {/* Flask body outline */}
        <path d="M19.5 18 L6 44 Q5 46 7 46 L41 46 Q43 46 42 44 L28.5 18 Z"
          fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
        {/* Liquid fill — partial */}
        <path d="M12 37 L6.5 44 Q5.5 46 7 46 L41 46 Q42.5 46 41.5 44 L35 37 Z"
          fill={color} opacity="0.18" />
        <path d="M12 37 L35 37" stroke={color} strokeWidth="1" opacity="0.5" />
        {/* Bubbles */}
        <circle cx="19"  cy="42" r="2"   fill="none" stroke={color} strokeWidth="1"   opacity="0.7" />
        <circle cx="28"  cy="43.5" r="1.3" fill="none" stroke={color} strokeWidth="0.9" opacity="0.6" />
        <circle cx="34"  cy="41" r="1.6" fill="none" stroke={color} strokeWidth="0.9" opacity="0.6" />
        {/* Sparkles */}
        <path d="M6 10 L7 13 L10 14 L7 15 L6 18 L5 15 L2 14 L5 13 Z"    stroke={color} strokeWidth="0.8" fill={color} opacity="0.65" />
        <path d="M40 8 L41 11 L44 12 L41 13 L40 16 L39 13 L36 12 L39 11 Z" stroke={color} strokeWidth="0.8" fill={color} opacity="0.55" />
        <path d="M43 26 L44 28.5 L46.5 29.5 L44 30.5 L43 33 L42 30.5 L39.5 29.5 L42 28.5 Z" stroke={color} strokeWidth="0.7" fill={color} opacity="0.45" />
      </svg>
    </g>
  );
}

// Lucide-style stroke icons for emoji-based nodes
function SwordsIcon({ color, glowColor, size }: { color: string; glowColor: string; size: number }) {
  const s = size * 0.9;
  return (
    <g style={{ filter: `drop-shadow(0 0 3px ${glowColor}) drop-shadow(0 0 7px ${glowColor})` }}>
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none"
        x={-s / 2} y={-s / 2}>
        <path d="M14.5 17.5L3 6V3h3l11.5 11.5" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M13 19l6-6" stroke={color} strokeWidth="1.6" strokeLinecap="round"/>
        <path d="M2 2l5 5" stroke={color} strokeWidth="1.6" strokeLinecap="round"/>
        <path d="M20 16l2 2-5 4-2-2" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M9.5 4.5L4 10l1.5 1.5" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M10 6.5l6-6 2.5 2.5-5.5 5.5" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </g>
  );
}

function CrownIcon({ color, glowColor, size }: { color: string; glowColor: string; size: number }) {
  const s = size * 0.9;
  return (
    <g style={{ filter: `drop-shadow(0 0 3px ${glowColor}) drop-shadow(0 0 7px ${glowColor})` }}>
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none"
        x={-s / 2} y={-s / 2}>
        <path d="M2 19h20M2 19l3-10 4.5 4L12 5l2.5 8L19 9l3 10" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </g>
  );
}

function SparklesIcon({ color, glowColor, size }: { color: string; glowColor: string; size: number }) {
  const s = size * 0.9;
  return (
    <g style={{ filter: `drop-shadow(0 0 3px ${glowColor}) drop-shadow(0 0 7px ${glowColor})` }}>
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none"
        x={-s / 2} y={-s / 2}>
        <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" stroke={color} strokeWidth="1.5" strokeLinejoin="round" fill="none"/>
        <path d="M19 3l.8 2.2L22 6l-2.2.8L19 9l-.8-2.2L16 6l2.2-.8L19 3z" stroke={color} strokeWidth="1.2" strokeLinejoin="round" fill={color} opacity="0.7"/>
        <path d="M5 15l.7 1.8L7.5 17.5l-1.8.7L5 20l-.7-1.8L2.5 17.5l1.8-.7L5 15z" stroke={color} strokeWidth="1.2" strokeLinejoin="round" fill={color} opacity="0.6"/>
      </svg>
    </g>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Glass circle background
// ─────────────────────────────────────────────────────────────────────────────
function GlassCircle({
  r,
  rayAngle,       // angle from source → node (radians)
  rayIntensity,   // 0–1
  isLit,
}: {
  r: number;
  rayAngle: number;
  rayIntensity: number;
  isLit: boolean;
}) {
  // The border arc that FACES the source (top, when source is above) shines gold
  const borderBase   = rayIntensity * 0.50 + 0.08;
  const borderOpacity = isLit ? Math.min(1, borderBase + 0.50) : borderBase;

  // Gold glow on the border side facing source
  const glowStr = isLit ? 10 + rayIntensity * 14 : rayIntensity * 5;

  return (
    <>
      {/* Main glass body — very dark, semi-transparent */}
      <circle
        r={r}
        fill="hsl(222 22% 5% / 0.78)"
      />

      {/* Subtle inner glass texture — faint lighter ring inside */}
      <circle
        r={r * 0.90}
        fill="none"
        stroke="hsl(210 40% 80%)"
        strokeWidth={0.5}
        strokeOpacity={0.06}
      />

      {/* Top-edge catch-light — the refraction highlight on the top of the glass */}
      {/* Simulates light entering from above and catching the top rim */}
      <ellipse
        cx={0}
        cy={-r * 0.70}
        rx={r * 0.45}
        ry={r * 0.14}
        fill="hsl(210 60% 92%)"
        opacity={0.10 + rayIntensity * 0.14}
        style={{ transition: "opacity 0.4s ease" }}
      />

      {/* Border ring — glows gold on the ray-facing side */}
      <circle
        r={r}
        fill="none"
        stroke="hsl(43 82% 60%)"
        strokeWidth={1.6}
        strokeOpacity={borderOpacity}
        style={{
          filter: glowStr > 0
            ? `drop-shadow(0 0 ${glowStr}px hsl(43 88% 55%)) drop-shadow(0 0 ${glowStr * 0.35}px hsl(43 88% 55%))`
            : undefined,
          transition: "stroke-opacity 0.35s ease, filter 0.35s ease",
        }}
      />

      {/* Blue-glass edge — the characteristic blue-white rim of dark glass */}
      {/* Constant subtle blue glow on the circle edge */}
      <circle
        r={r + 0.5}
        fill="none"
        stroke="hsl(210 80% 70%)"
        strokeWidth={0.8}
        strokeOpacity={0.18}
        style={{
          filter: "drop-shadow(0 0 3px hsl(210 85% 65%)) drop-shadow(0 0 8px hsl(210 80% 60%))",
        }}
      />
    </>
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
  const lit     = isHovered || isSelected;
  const dimmed  = isActive && !lit;
  const iconSize = node.size * 2.4;
  const r        = iconSize * 0.52;
  const hitRadius = iconSize * 0.62;

  // ── Ray state ─────────────────────────────────────────────────────────────
  const [rayIntensity, setRayIntensity] = useState(0);
  const [rayAngle,     setRayAngle]     = useState(-Math.PI / 2); // default: from above
  const rafRef = useRef<number>(0);

  useEffect(() => {
    function update() {
      const state = getRayState();
      const { sx, sy } = computeSourcePos(state.t);
      const srcXpx = sx * window.innerWidth;
      const srcYpx = sy * window.innerHeight;

      const dx   = screenX - srcXpx;
      const dy   = screenY - srcYpx;
      const dist = Math.sqrt(dx * dx + dy * dy) / Math.max(window.innerWidth, window.innerHeight);
      const falloff = Math.max(0, 1 - dist * 1.4);
      setRayIntensity(falloff * falloff);
      setRayAngle(Math.atan2(dy, dx));

      rafRef.current = requestAnimationFrame(update);
    }
    rafRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(rafRef.current);
  }, [screenX, screenY]);

  // ── Icon colors ───────────────────────────────────────────────────────────
  // Reference: blue-white luminous stroke at rest; warms slightly toward gold when ray hits
  const rayWarm = rayIntensity * 0.6 + (lit ? 0.4 : 0);

  // Base: cool blue-white glass stroke
  // Lit / under ray: shifts warmer and brighter
  const iconH = Math.round(210 - rayWarm * 168); // 210 (blue) → 42 (gold)
  const iconS = Math.round(70  + rayWarm * 20);
  const iconL = Math.round(72  + rayWarm * 12);
  const iconA = lit ? 0.95 : 0.55 + rayIntensity * 0.25;
  const iconColor = `hsla(${iconH}, ${iconS}%, ${iconL}%, ${iconA})`;

  // Glow color matches the icon hue
  const glowColor = lit
    ? `hsl(43 88% 60%)`       // gold glow when selected
    : `hsl(${iconH} 80% 65%)`; // blue glass glow at rest

  return (
    <g
      style={{
        cursor: "pointer",
        opacity: dimmed ? 0.18 : 1,
        transition: "opacity 0.3s ease",
      }}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onSelect(isSelected ? null : node.id)}
    >
      {/* Invisible hit area */}
      <circle r={hitRadius} fill="transparent" />

      {/* Dark glass circle + border */}
      <GlassCircle
        r={r}
        rayAngle={rayAngle}
        rayIntensity={rayIntensity}
        isLit={lit}
      />

      {/* Icon — stroke-based glass etching */}
      <g style={{ pointerEvents: "none" }}>
        {node.id === "philosophy"    && <PillarIcon   color={iconColor} glowColor={glowColor} size={iconSize * 0.68} />}
        {node.id === "investigative" && <EyeIcon      color={iconColor} glowColor={glowColor} size={iconSize * 0.68} />}
        {node.id === "alchemy"       && <FlaskIcon    color={iconColor} glowColor={glowColor} size={iconSize * 0.68} />}
        {node.id === "athena"        && <SwordsIcon   color={iconColor} glowColor={glowColor} size={iconSize * 0.68} />}
        {node.id === "strategic"     && <CrownIcon    color={iconColor} glowColor={glowColor} size={iconSize * 0.68} />}
        {node.id === "creative"      && <SparklesIcon color={iconColor} glowColor={glowColor} size={iconSize * 0.68} />}
      </g>

      {/* Node label — appears on hover/select */}
      <text
        y={iconSize * 0.70}
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

      {/* Idle pulse dot — subtle top-right when not selected */}
      {!lit && (
        <circle
          r={1.3}
          cx={hitRadius * 0.52}
          cy={-hitRadius * 0.52}
          fill="hsl(210 70% 70%)"
          opacity={0.20 + rayIntensity * 0.25}
          style={{ animation: `idleDot ${2.2 + node.depth}s ease-in-out infinite` }}
        />
      )}
    </g>
  );
});
