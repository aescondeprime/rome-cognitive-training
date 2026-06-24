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

export default memo(function ConstellationNode({
  node, isHovered, isSelected, isActive, onHover, onSelect,
}: Props) {
  const lit    = isHovered || isSelected;
  const dimmed = isActive && !lit;

  // Symbol is the node — no circles. Size drives the font size.
  const fontSize = node.size * 2.2;
  const hitRadius = fontSize * 0.6; // invisible click target radius

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
      {/* Invisible hit area — ensures click registers anywhere near the symbol */}
      <circle r={hitRadius} fill="transparent" />
      {/* Outer glow halo — visible only when lit */}
      {lit && (
        <circle
          r={fontSize * 0.58}
          fill={node.accent}
          opacity={0.12}
          style={{
            filter: `blur(${Math.round(fontSize * 0.45)}px)`,
            animation: "outerPulse 2.4s ease-in-out infinite",
            transformOrigin: "0 0",
          }}
        />
      )}

      {/* The icon itself — gray at rest, accent + glow when lit, scale on select */}
      <text
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={fontSize}
        fill={lit ? node.accent : "hsl(220 8% 52%)"}
        style={{
          fontFamily: "DM Sans, sans-serif",
          userSelect: "none",
          pointerEvents: "none",
          filter: lit
            ? `drop-shadow(0 0 ${Math.round(fontSize * 0.38)}px ${node.accent}) drop-shadow(0 0 ${Math.round(fontSize * 0.18)}px ${node.accent})`
            : "none",
          // Node does NOT scale itself — camera zoom handles that
          transition: "fill 0.25s ease, filter 0.25s ease",
        }}
      >
        {node.symbol}
      </text>

      {/* Label — appears below when lit */}
      <text
        y={fontSize * 0.72}
        textAnchor="middle"
        fontSize={8.5}
        fill={node.accent}
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

      {/* Idle shimmer dot — top-right corner, only when unlit */}
      {!lit && (
        <circle
          r={1.6}
          cx={fontSize * 0.32}
          cy={-fontSize * 0.32}
          fill="hsl(220 8% 65%)"
          opacity={0.5}
          style={{
            animation: `idleDot ${2.2 + node.depth}s ease-in-out infinite`,
          }}
        />
      )}
    </g>
  );
});
