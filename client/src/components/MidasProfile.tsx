/**
 * The MIDAS profile — the geometric representation of your scales.
 *
 * A regular polygon whose vertices are the scales you are developing, each
 * spoke's length being that scale's score. Skills sit *on* their scale's spoke
 * at their own level, so a scale that is one strong skill and three weak ones
 * looks different from a scale that is four middling ones, which a bar chart of
 * the averages would hide.
 *
 * MIDAS is a profile instrument, not a single score. The point of drawing it
 * this way is that the shape is the finding — a spiky profile and a round one
 * can share an average and mean completely different things.
 */

import { useMemo } from "react";
import type { ScoreSource } from "@/lib/midasStore";

export interface ProfileSkill {
  id: string;
  name: string;
  level: number;
}

export interface ProfileScale {
  id: string;
  label: string;
  glyph: string;
  accent: string;
  score: number;
  source: ScoreSource;
  skills: ProfileSkill[];
}

interface Props {
  scales: ProfileScale[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  composite: number;
  size?: number;
}

const RINGS = [0.25, 0.5, 0.75, 1];

export default function MidasProfile({ scales, selectedId, onSelect, composite, size = 460 }: Props) {
  const cx = size / 2;
  const cy = size / 2;
  const R = size * 0.33;

  const geometry = useMemo(() => {
    const n = scales.length;
    return scales.map((scale, i) => {
      // Start at twelve o'clock and go clockwise, which is how everyone reads
      // a radial chart whether or not they could tell you so.
      const angle = -Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const r = (Math.max(0, Math.min(100, scale.score)) / 100) * R;
      return {
        scale,
        angle, cos, sin,
        // Vertex of the data polygon.
        x: cx + cos * r,
        y: cy + sin * r,
        // Outer end of the spoke, where the axis label goes.
        ex: cx + cos * R,
        ey: cy + sin * R,
        lx: cx + cos * (R + 26),
        ly: cy + sin * (R + 26),
      };
    });
  }, [scales, cx, cy, R]);

  const hasPolygon = geometry.length >= 3;
  const dataPoints = geometry.map(g => `${g.x.toFixed(1)},${g.y.toFixed(1)}`).join(" ");

  /** A guide ring at `t` of full radius, matching the polygon's own shape. */
  function ringPoints(t: number): string {
    if (!hasPolygon) return "";
    return geometry
      .map(g => `${(cx + g.cos * R * t).toFixed(1)},${(cy + g.sin * R * t).toFixed(1)}`)
      .join(" ");
  }

  if (!scales.length) {
    return (
      <div
        style={{
          height: size * 0.62,
          display: "flex", alignItems: "center", justifyContent: "center",
          border: "1px dashed hsl(var(--accent-h) 18% 18%)",
          borderRadius: 14,
        }}
      >
        <p style={{
          fontFamily: "DM Mono, monospace", fontSize: 10,
          color: "hsl(var(--accent-h) 25% 38%)", letterSpacing: "0.14em", textTransform: "uppercase",
        }}>
          No scales yet — add one to begin the profile
        </p>
      </div>
    );
  }

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${size} ${size}`}
      style={{ display: "block", overflow: "visible", maxHeight: "68vh" }}
      onClick={() => onSelect(null)}
    >
      <defs>
        <radialGradient id="midas-fill" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="hsl(var(--accent-h) var(--accent-s) var(--accent-l))" stopOpacity="0.20" />
          <stop offset="100%" stopColor="hsl(var(--accent-h) var(--accent-s) var(--accent-l))" stopOpacity="0.05" />
        </radialGradient>
      </defs>

      {/* Guide rings */}
      {hasPolygon && RINGS.map(t => (
        <polygon
          key={t}
          points={ringPoints(t)}
          fill="none"
          stroke="hsl(var(--accent-h) 30% 40%)"
          strokeOpacity={t === 1 ? 0.24 : 0.1}
          strokeWidth={t === 1 ? 0.9 : 0.6}
          strokeDasharray={t === 1 ? undefined : "3 7"}
        />
      ))}
      {!hasPolygon && RINGS.map(t => (
        <circle
          key={t} cx={cx} cy={cy} r={R * t}
          fill="none" stroke="hsl(var(--accent-h) 30% 40%)"
          strokeOpacity={t === 1 ? 0.24 : 0.1}
          strokeWidth={t === 1 ? 0.9 : 0.6}
          strokeDasharray={t === 1 ? undefined : "3 7"}
        />
      ))}

      {/* Spokes */}
      {geometry.map(g => {
        const active = selectedId === g.scale.id;
        return (
          <line
            key={`spoke-${g.scale.id}`}
            x1={cx} y1={cy} x2={g.ex} y2={g.ey}
            stroke={active ? g.scale.accent : "hsl(var(--accent-h) 30% 40%)"}
            strokeOpacity={active ? 0.55 : 0.16}
            strokeWidth={active ? 1.1 : 0.6}
          />
        );
      })}

      {/* The profile itself */}
      {hasPolygon && (
        <polygon
          points={dataPoints}
          fill="url(#midas-fill)"
          stroke="hsl(var(--accent-h) var(--accent-s) var(--accent-l))"
          strokeOpacity={0.75}
          strokeWidth={1.4}
          strokeLinejoin="round"
          style={{ pointerEvents: "none" }}
        />
      )}

      {/* Skill nodes, sitting on their scale's spoke at their own level.
          Pairs are nudged to alternating sides so several skills at a similar
          level stay countable instead of stacking into one dot. */}
      {geometry.map(g =>
        g.scale.skills.map((skill, i) => {
          const r = (Math.max(0, Math.min(100, skill.level)) / 100) * R;
          const spread = (i % 2 === 0 ? 1 : -1) * Math.ceil((i + 1) / 2) * 3.4;
          const px = cx + g.cos * r - g.sin * spread;
          const py = cy + g.sin * r + g.cos * spread;
          const active = selectedId === g.scale.id;
          return (
            <rect
              key={skill.id}
              x={px - 2.6} y={py - 2.6}
              width={5.2} height={5.2}
              transform={`rotate(45 ${px} ${py})`}
              fill={g.scale.accent}
              fillOpacity={active ? 0.95 : 0.5}
              stroke="hsl(222 20% 5%)"
              strokeWidth={0.7}
              style={{ pointerEvents: "none" }}
            >
              <title>{`${skill.name} — ${skill.level}`}</title>
            </rect>
          );
        })
      )}

      {/* Vertices */}
      {geometry.map(g => {
        const active = selectedId === g.scale.id;
        return (
          <circle
            key={`v-${g.scale.id}`}
            cx={g.x} cy={g.y} r={active ? 4.4 : 3}
            fill={g.scale.accent}
            fillOpacity={g.scale.source === "empty" ? 0.28 : 0.95}
            stroke="hsl(222 20% 5%)" strokeWidth={1}
            style={{ pointerEvents: "none" }}
          />
        );
      })}

      {/* Axis labels — also the hit target for selecting a scale. */}
      {geometry.map(g => {
        const active = selectedId === g.scale.id;
        // Anchor by which side of the circle the label sits on, so text grows
        // outward from the shape rather than across it.
        const anchor = Math.abs(g.cos) < 0.25 ? "middle" : g.cos > 0 ? "start" : "end";
        return (
          <g
            key={`label-${g.scale.id}`}
            style={{ cursor: "pointer" }}
            onClick={e => { e.stopPropagation(); onSelect(active ? null : g.scale.id); }}
          >
            {/* Generous invisible target — the visible text is 8px tall. */}
            <rect
              x={g.lx - 62} y={g.ly - 16} width={124} height={32}
              fill="transparent"
            />
            <text
              x={g.lx} y={g.ly - 3}
              textAnchor={anchor}
              fontFamily="DM Mono, monospace"
              fontSize={8.5}
              letterSpacing="0.12em"
              fill={active ? g.scale.accent : "hsl(var(--accent-h) 35% 52%)"}
              style={{ textTransform: "uppercase", userSelect: "none" }}
            >
              {g.scale.label}
            </text>
            <text
              x={g.lx} y={g.ly + 8}
              textAnchor={anchor}
              fontFamily="DM Mono, monospace"
              fontSize={9}
              fill={active ? g.scale.accent : "hsl(var(--accent-h) 30% 40%)"}
              style={{ userSelect: "none" }}
            >
              {g.scale.source === "empty" ? "—" : g.scale.score}
            </text>
          </g>
        );
      })}

      {/* Composite at the centre */}
      <circle cx={cx} cy={cy} r={26} fill="hsl(222 22% 7%)" stroke="hsl(var(--accent-h) 25% 22%)" strokeWidth={0.8} />
      <text
        x={cx} y={cy + 2} textAnchor="middle"
        fontFamily="'Cinzel', serif" fontSize={17}
        fill="hsl(var(--accent-h) var(--accent-s) var(--accent-l))"
        style={{ userSelect: "none" }}
      >
        {composite}
      </text>
      <text
        x={cx} y={cy + 14} textAnchor="middle"
        fontFamily="DM Mono, monospace" fontSize={6}
        letterSpacing="0.2em"
        fill="hsl(var(--accent-h) 25% 40%)"
        style={{ textTransform: "uppercase", userSelect: "none" }}
      >
        Index
      </text>
    </svg>
  );
}
