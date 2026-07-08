/**
 * NodeBranchMenu — SVG-native radial branch menu that sprouts from a selected
 * constellation node.
 *
 * Renders entirely inside the constellation's camera-transformed <svg> so it
 * inherits all zoom / pan transforms automatically.
 *
 * Layout rules
 * ─────────────
 * • One "primary" branch always points toward screen-centre (Enter Domain).
 * • Sub-node branches fan out around it, evenly spread within a ±90° arc
 *   centred on the primary direction.
 * • Each branch is: animated line → rounded rect label.
 * • Lines grow from length 0 → full with a spring stagger.
 * • Labels fade + scale in after their line finishes.
 * • Clicking a label calls go(href) which pushes the hash route.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { ConstellationNode } from "@/lib/constellationData";

// ── constants ─────────────────────────────────────────────────────────────
const BRANCH_LEN   = 88;   // px — stem length (in SVG coords)
const LABEL_W      = 108;  // label rect width
const LABEL_H      = 26;   // label rect height
const LABEL_PAD    = 8;    // gap between stem tip and label centre
const PRIMARY_EXTRA = 14;  // primary branch is a bit longer
const STAGGER      = 55;   // ms between branch reveals
const SPRING_MS    = 380;  // stem grow animation

// ── helpers ───────────────────────────────────────────────────────────────
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

/** Ease-out cubic */
function easeOut(t: number) { return 1 - Math.pow(1 - t, 3); }

/** Angle from (x1,y1) toward screen centre, clamped so label stays on screen */
function preferredAngle(sx: number, sy: number, screenW: number, screenH: number): number {
  const cx = screenW / 2;
  const cy = screenH / 2;
  return Math.atan2(cy - sy, cx - sx);
}

interface Branch {
  id:        string;
  label:     string;
  icon:      string;
  href:      string;
  isPrimary: boolean;
  angle:     number;   // final angle in radians
}

interface AnimState {
  /** 0–1 progress of the stem line */
  stemT: number;
  /** 0–1 opacity of the label */
  labelAlpha: number;
  started: boolean;
}

interface Props {
  node:       ConstellationNode;
  /** Position of the node centre in SVG (camera-space) coordinates */
  cx:         number;
  cy:         number;
  /** Node radius in SVG coords (used as stem start offset) */
  radius:     number;
  /** SVG-space dimensions — needed to compute preferred angle */
  svgW:       number;
  svgH:       number;
  /** Camera scale so we can invert it for label sizing */
  camScale:   number;
  onNavigate: (href: string) => void;
  onClose:    () => void;
}

export default function NodeBranchMenu({
  node, cx, cy, radius, svgW, svgH, camScale, onNavigate, onClose,
}: Props) {
  // ── Build branch list ─────────────────────────────────────────────────
  const primaryAngle = preferredAngle(cx, cy, svgW, svgH);

  const branches: Branch[] = [
    ...node.subnodes.map((sub, i) => ({
      id:        sub.id,
      label:     sub.label,
      icon:      sub.icon,
      href:      sub.href,
      isPrimary: false,
      angle:     0, // computed below
    })),
  ];

  // Fan all branches evenly toward the screen centre
  const subCount = branches.length;
  if (subCount > 0) {
    const spread = subCount === 1
      ? 0
      : Math.min((subCount - 1) * 44, 200) * (Math.PI / 180);
    const step   = subCount > 1 ? spread / (subCount - 1) : 0;
    const startA = primaryAngle - spread / 2;
    for (let i = 0; i < subCount; i++) {
      branches[i].angle = startA + i * step;
    }
  }

  // ── Animation state per branch ────────────────────────────────────────
  const [anims, setAnims] = useState<AnimState[]>(() =>
    branches.map(() => ({ stemT: 0, labelAlpha: 0, started: false }))
  );

  const rafRef   = useRef<number>(0);
  const startRef = useRef<number[]>(branches.map((_, i) => 0));
  const mountT   = useRef<number>(performance.now());

  // Kick off staggered reveals on mount
  useEffect(() => {
    mountT.current = performance.now();

    function tick(now: number) {
      setAnims(prev => {
        const next = prev.map((a, i) => {
          const delay = i * STAGGER;
          const elapsed = now - mountT.current - delay;
          if (elapsed < 0) return a;

          const stemT      = Math.min(1, easeOut(elapsed / SPRING_MS));
          const labelAlpha = stemT >= 0.85 ? Math.min(1, easeOut((elapsed - SPRING_MS * 0.8) / 120)) : 0;
          return { stemT, labelAlpha, started: true };
        });
        return next;
      });

      const allDone = branches.every((_, i) => {
        const delay = i * STAGGER;
        return (performance.now() - mountT.current - delay) > SPRING_MS + 120;
      });
      if (!allDone) rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [node.id]); // re-run if node changes

  const go = useCallback((e: React.MouseEvent, href: string) => {
    e.stopPropagation();
    onClose();
    onNavigate(href);
    window.location.hash = href;
  }, [onClose, onNavigate]);

  // ── Inverse scale — labels stay the same visual size regardless of zoom ──
  const inv = 1 / Math.max(0.5, camScale);

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <g style={{ pointerEvents: "auto" }}>
      {branches.map((branch, i) => {
        const anim    = anims[i] ?? { stemT: 0, labelAlpha: 0 };
        const stemLen = (branch.isPrimary ? BRANCH_LEN + PRIMARY_EXTRA : BRANCH_LEN) * inv;
        const offset  = (radius + 4) * inv;

        // Stem: from node edge → tip
        const x1 = cx + Math.cos(branch.angle) * offset;
        const y1 = cy + Math.sin(branch.angle) * offset;
        const tipX = cx + Math.cos(branch.angle) * (offset + stemLen * anim.stemT);
        const tipY = cy + Math.sin(branch.angle) * (offset + stemLen * anim.stemT);

        // Final tip (for label positioning)
        const ftX = cx + Math.cos(branch.angle) * (offset + stemLen);
        const ftY = cy + Math.sin(branch.angle) * (offset + stemLen);

        // Label centre — offset just past tip
        // Dynamic width — compute before positioning so label centre uses actual width
        const fontSize_  = 9 * inv;
        const iconSize_  = 10 * inv;
        const charW      = fontSize_ * 0.60;
        const textPx     = branch.label.length * charW;
        const lw         = iconSize_ * 2 + 8 * inv + textPx + 16 * inv;
        const lh         = LABEL_H * inv;

        const labelDist  = stemLen + LABEL_PAD * inv + lw / 2;
        const labelCX = cx + Math.cos(branch.angle) * (offset + labelDist);
        const labelCY = cy + Math.sin(branch.angle) * (offset + labelDist);
        const lr = 5 * inv; // border radius

        const accentRaw = branch.isPrimary ? node.accent : "hsl(43 60% 55%)";
        const stemColor  = branch.isPrimary
          ? `${node.accent.replace(")", " / 0.7)").replace("hsl(", "hsl(")}`
          : "hsl(43 30% 40% / 0.5)";
        const labelBg    = branch.isPrimary ? `${node.accent}18` : "hsl(220 14% 8% / 0.88)";
        const labelBorder= branch.isPrimary ? `${node.accent}45` : "hsl(220 14% 20% / 0.7)";
        const labelText  = branch.isPrimary ? node.accent : "hsl(43 50% 62%)";
        const fontSize   = fontSize_;
        const iconSize   = iconSize_;

        return (
          <g key={branch.id}>
            {/* Stem line — grows from node edge */}
            <line
              x1={x1} y1={y1}
              x2={tipX} y2={tipY}
              stroke={stemColor}
              strokeWidth={branch.isPrimary ? 1.5 * inv : inv}
              strokeLinecap="round"
            />

            {/* Dot at tip (only when stem is nearly full) */}
            {anim.stemT > 0.9 && (
              <circle
                cx={ftX} cy={ftY}
                r={2.5 * inv}
                fill={branch.isPrimary ? node.accent : "hsl(43 30% 45%)"}
                opacity={anim.stemT}
              />
            )}

            {/* Label */}
            {anim.labelAlpha > 0 && (
              <g
                opacity={anim.labelAlpha}
                style={{ cursor: "pointer" }}
                onClick={e => go(e, branch.href)}
              >
                {/* Rect */}
                <rect
                  x={labelCX - lw / 2}
                  y={labelCY - lh / 2}
                  width={lw}
                  height={lh}
                  rx={lr}
                  fill={labelBg}
                  stroke={labelBorder}
                  strokeWidth={inv}
                />
                {/* Glow for primary */}
                {branch.isPrimary && (
                  <rect
                    x={labelCX - lw / 2}
                    y={labelCY - lh / 2}
                    width={lw}
                    height={lh}
                    rx={lr}
                    fill="none"
                    stroke={node.accent}
                    strokeWidth={inv * 0.5}
                    opacity={0.3}
                    style={{ filter: `blur(${2 * inv}px)` }}
                  />
                )}
                {/* Icon */}
                <text
                  x={labelCX - lw / 2 + iconSize + 5 * inv}
                  y={labelCY + fontSize * 0.38}
                  fontSize={iconSize}
                  textAnchor="middle"
                  fill={accentRaw}
                  opacity={0.85}
                  style={{ userSelect: "none" }}
                >
                  {branch.icon}
                </text>
                {/* Label text */}
                <text
                  x={labelCX - lw / 2 + iconSize * 2 + 4 * inv}
                  y={labelCY + fontSize * 0.38}
                  fontSize={fontSize}
                  fill={labelText}
                  fontFamily="DM Mono, monospace"
                  letterSpacing={`${0.08 * inv}em`}
                  textTransform="uppercase"
                  style={{ userSelect: "none" }}
                >
                  {branch.label}
                </text>

                {/* Invisible wider hit target */}
                <rect
                  x={labelCX - lw / 2 - 4 * inv}
                  y={labelCY - lh / 2 - 4 * inv}
                  width={lw + 8 * inv}
                  height={lh + 8 * inv}
                  fill="transparent"
                  onClick={e => go(e, branch.href)}
                />
              </g>
            )}
          </g>
        );
      })}

      {/* Close tap area (click backdrop already handled by parent) */}
    </g>
  );
}
