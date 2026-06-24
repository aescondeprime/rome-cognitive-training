import { memo } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { ConstellationNode as NodeData } from "@/lib/constellationData";

interface Props {
  node: NodeData;
  isHovered: boolean;
  isSelected: boolean;
  isActive: boolean;       // any node is selected/hovered (dims others)
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
}

export default memo(function ConstellationNode({
  node, isHovered, isSelected, isActive, onHover, onSelect,
}: Props) {
  const lit = isHovered || isSelected;
  const dimmed = isActive && !lit;

  const glowColor = node.accent;
  const size = node.size;

  return (
    <motion.g
      initial={{ opacity: 0, scale: 0.3 }}
      animate={{
        opacity: dimmed ? 0.25 : 1,
        scale: isSelected ? 1.2 : isHovered ? 1.1 : 1,
      }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      style={{ cursor: "pointer" }}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onSelect(isSelected ? null : node.id)}
      aria-label={node.label}
    >
      {/* Outer glow ring — only when lit */}
      {lit && (
        <motion.circle
          r={size + 16}
          fill="none"
          stroke={glowColor}
          strokeWidth={1}
          opacity={0}
          animate={{ opacity: [0, 0.2, 0], r: [size + 12, size + 28, size + 12] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
        />
      )}

      {/* Mid glow — always subtle, brightens on hover */}
      <motion.circle
        r={size + 8}
        fill={glowColor}
        opacity={lit ? 0.12 : 0.04}
        style={{ filter: `blur(${lit ? 8 : 4}px)` }}
        transition={{ duration: 0.3 }}
      />

      {/* Core circle */}
      <motion.circle
        r={size}
        fill={`hsl(222 18% ${lit ? 9 : 6}%)`}
        stroke={glowColor}
        strokeWidth={lit ? 1.5 : 0.8}
        style={{
          filter: lit ? `drop-shadow(0 0 ${size * 0.7}px ${glowColor})` : "none",
        }}
        transition={{ duration: 0.25 }}
      />

      {/* Inner highlight arc — top-left, simulates cave light */}
      <motion.path
        d={`M ${-size * 0.6} ${-size * 0.7} A ${size} ${size} 0 0 1 ${size * 0.4} ${-size * 0.8}`}
        fill="none"
        stroke="hsl(43 80% 80%)"
        strokeWidth={0.6}
        opacity={lit ? 0.35 : 0.12}
        transition={{ duration: 0.3 }}
      />

      {/* Symbol */}
      <motion.text
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={size * 0.9}
        fill={glowColor}
        opacity={lit ? 1 : 0.7}
        style={{
          fontFamily: "DM Sans, sans-serif",
          userSelect: "none",
          filter: lit ? `drop-shadow(0 0 4px ${glowColor})` : "none",
        }}
        transition={{ duration: 0.25 }}
      >
        {node.symbol}
      </motion.text>

      {/* Label — only on hover/select, fades in below */}
      <motion.text
        y={size + 14}
        textAnchor="middle"
        fontSize={9}
        fill={glowColor}
        opacity={0}
        animate={{ opacity: lit ? 0.85 : 0 }}
        transition={{ duration: 0.2 }}
        style={{
          fontFamily: "'Cinzel', serif",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          userSelect: "none",
        }}
      >
        {node.label}
      </motion.text>

      {/* Dot accent — idle drift animation */}
      {!lit && (
        <motion.circle
          r={2}
          fill={glowColor}
          opacity={0.5}
          cx={size * 0.55}
          cy={-size * 0.55}
          animate={{ opacity: [0.3, 0.7, 0.3] }}
          transition={{ duration: 2 + node.depth * 1.5, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
    </motion.g>
  );
});
