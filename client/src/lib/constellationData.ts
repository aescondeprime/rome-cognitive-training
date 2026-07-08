// ── Types ──────────────────────────────────────────────────────────────────
export interface SubNode {
  id: string;
  label: string;
  icon: string;
  href: string;
  description: string;
}

export interface ConstellationNode {
  id: string;
  label: string;
  symbol: string;
  accent: string;
  x: number;
  y: number;
  size: number;
  depth: number;
  href: string;
  tagline: string;
  subnodes: SubNode[];
  connections: string[];
  lucideIcon?: string; // lucide icon name for rendering
}

// ── New constellation layout ───────────────────────────────────────────────
//
//   Philosophy (pillar)          Athena Trials (swords)
//        ●  (left)                    ●  (right)
//
//         Strategic ●────● Creative
//              (crown)  ╲  (4-star)
//                        ╲
//                    Investigative ●
//                        (eye)
//
//   Alchemy Lab ●  (bottom-left, standalone)
//
// Connections: Strategic ↔ Creative ↔ Investigative ↔ Strategic (triangle)
// Philosophy and Athena are standalone (no connections yet)
// Alchemy is standalone

export const CONSTELLATION_NODES: ConstellationNode[] = [
  // ── Philosophy Chambers — left, mid-upper
  {
    id: "philosophy",
    label: "Philosophy Chambers",
    symbol: "𝛷",
    lucideIcon: "Columns",           // greek pillar / columns
    accent: "hsl(43 88% 60%)",
    x: 20, y: 28,
    size: 18,
    depth: 0.9,
    href: "/philosophy",
    tagline: "A private space for reflection and intellectual synthesis",
    subnodes: [
      { id: "phil-reflections", label: "Reflections", icon: "✦", href: "/philosophy", description: "Philosophy Chambers — notes and reflections" },
    ],
    connections: [],
  },

  // ── Athena Trials — right, mid-upper
  {
    id: "athena",
    label: "Athena Trials",
    symbol: "⚔",
    lucideIcon: "Swords",
    accent: "hsl(210 80% 62%)",
    x: 78, y: 28,
    size: 18,
    depth: 0.9,
    href: "/athena",
    tagline: "Six cognitive trials — adaptive, precise, and minimal",
    subnodes: [
      { id: "at-dnb",   label: "Dual N-Back",          icon: "⟁", href: "/athena/dual-n-back",   description: "Simultaneous audio + visual n-back task" },
      { id: "at-cwm",   label: "Complex Working Memory", icon: "◈", href: "/athena/cwm",           description: "Verbal or spatial span with decision interference" },
      { id: "at-math",  label: "Mental Math",            icon: "∑", href: "/athena/mental-math",   description: "Progressive arithmetic under time pressure" },
      { id: "at-corsi", label: "Corsi Blocks",           icon: "⊞", href: "/athena/corsi",         description: "Visuospatial sequence memory" },
      { id: "at-span",  label: "Memory Span",            icon: "◎", href: "/athena/memory-span",   description: "Forward, reverse, and sorted recall" },
      { id: "at-pasat", label: "PASAT",                  icon: "⊕", href: "/athena/pasat",         description: "Paced auditory serial addition task" },
    ],
    connections: [],
  },

  // ── Strategic — triangle top-left
  {
    id: "strategic",
    label: "Strategic",
    symbol: "♛",
    lucideIcon: "Crown",
    accent: "hsl(43 88% 60%)",
    x: 30, y: 58,
    size: 16,
    depth: 1.0,
    href: "/strategic",
    tagline: "Planning, execution, and decision architecture",
    subnodes: [
      { id: "st-task", label: "Taskboard", icon: "⊟", href: "/taskboard", description: "Strategic task planning board" },
    ],
    connections: ["creative", "investigative"],
  },

  // ── Creative — triangle top-right
  {
    id: "creative",
    label: "Creative",
    symbol: "✦",
    lucideIcon: "Sparkles",          // 4-point star
    accent: "hsl(270 60% 65%)",
    x: 68, y: 58,
    size: 16,
    depth: 1.0,
    href: "/creative",
    tagline: "Divergent thinking and ideation",
    subnodes: [
      { id: "cr-idea", label: "Idea Workshop", icon: "✦", href: "/idea-workshop", description: "Canvas for ideas, connections, and energy" },
    ],
    connections: ["investigative"],
  },

  // ── Investigative — triangle bottom-center
  {
    id: "investigative",
    label: "Investigative",
    symbol: "◉",
    lucideIcon: "Eye",
    accent: "hsl(175 55% 48%)",
    x: 49, y: 76,
    size: 16,
    depth: 1.0,
    href: "/investigative",
    tagline: "Pattern recognition and deep inquiry",
    subnodes: [
      { id: "inv-case", label: "Component Board", icon: "◉", href: "/component-board", description: "Detective caseboard with evidence pins and thread lines" },
    ],
    connections: [],
  },

  // ── Alchemy Lab — lower-left, standalone
  {
    id: "alchemy",
    label: "Alchemy Lab",
    symbol: "⚗",
    lucideIcon: "FlaskConical",
    accent: "hsl(270 55% 62%)",
    x: 14, y: 76,
    size: 15,
    depth: 0.88,
    href: "/alchemy",
    tagline: "Experimental features and transmutations",
    subnodes: [
      { id: "alch-nootropics", label: "Nootropics", icon: "⚗", href: "/alchemy-lab", description: "Track cognitive compounds, mechanisms, and effects" },
    ],
    connections: [],
  },
];

// Build a de-duplicated list of connection pairs for SVG line rendering
export type ConnectionPair = [string, string];
export function getConnectionPairs(): ConnectionPair[] {
  const seen = new Set<string>();
  const pairs: ConnectionPair[] = [];
  for (const node of CONSTELLATION_NODES) {
    for (const targetId of node.connections) {
      const key = [node.id, targetId].sort().join("--");
      if (!seen.has(key)) {
        seen.add(key);
        pairs.push([node.id, targetId]);
      }
    }
  }
  return pairs;
}
