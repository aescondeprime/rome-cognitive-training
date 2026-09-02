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
  // ── Academia — source-grounded study and knowledge creation
  {
    id: "academia",
    label: "Academia",
    symbol: "⌂",
    lucideIcon: "GraduationCap",
    accent: "hsl(190 72% 60%)",
    x: 49, y: 12,
    size: 17,
    depth: 0.95,
    href: "/academia",
    tagline: "Source-grounded notes, study tools, and knowledge synthesis",
    subnodes: [
      { id: "ac-notebook", label: "Knowledge Forge", icon: "⌂", href: "/academia", description: "PDF sources, notes, grounded inquiry, and Studio artifacts" },
    ],
    connections: ["philosophy", "athena"],
  },

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
    connections: ["athena", "strategic"],
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
    tagline: "MIDAS — your intelligence profile, and the six trials that feed it",
    subnodes: [
      { id: "at-midas", label: "MIDAS Dashboard",       icon: "◈", href: "/athena",               description: "Multiple-intelligences profile, scales, and skills" },
      { id: "at-dnb",   label: "Dual N-Back",          icon: "⟁", href: "/athena/dual-n-back",   description: "Simultaneous audio + visual n-back task" },
      { id: "at-cwm",   label: "Complex Working Memory", icon: "◈", href: "/athena/cwm",           description: "Verbal or spatial span with decision interference" },
      { id: "at-math",  label: "Mental Math",            icon: "∑", href: "/athena/mental-math",   description: "Progressive arithmetic under time pressure" },
      { id: "at-corsi", label: "Corsi Blocks",           icon: "⊞", href: "/athena/corsi",         description: "Visuospatial sequence memory" },
      { id: "at-span",  label: "Memory Span",            icon: "◎", href: "/athena/memory-span",   description: "Forward, reverse, and sorted recall" },
      { id: "at-pasat", label: "PASAT",                  icon: "⊕", href: "/athena/pasat",         description: "Paced auditory serial addition task" },
    ],
    connections: ["creative"],
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
      { id: "st-command", label: "Command Center", icon: "⊹", href: "/command-center", description: "Threats on a tactical grid, objectives in a tree, both attached to real work" },
      { id: "st-task",   label: "Contingency Garden", icon: "❦", href: "/taskboard",    description: "Branching plans with contingencies, traced into lettered routes" },
      { id: "st-kronos", label: "Kronos Keep",   icon: "⧗", href: "/kronos-keep",  description: "Time-aware calendar with routines, assignments, events and general items" },
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
      { id: "inv-case",     label: "Component Board", icon: "◉", href: "/component-board", description: "Detective caseboard with evidence pins and thread lines" },
      { id: "inv-research", label: "Research Lab",     icon: "⊕", href: "/research-lab",    description: "Evidence-based cognitive training research brief" },
    ],
    connections: ["world"],
  },

  // ── World — browser workspace, standalone bottom-right
  {
    id: "world",
    label: "World",
    symbol: "⊕",
    lucideIcon: "Globe",
    accent: "hsl(195 70% 52%)",
    x: 72, y: 87,
    size: 15,
    depth: 1.0,
    href: "/world",
    tagline: "Integrated browser workspace",
    subnodes: [
      { id: "wr-browser", label: "Browser", icon: "◌", href: "/world", description: "Local Chromium on desktop, streamed session on web" },
    ],
    connections: [],
  },

  // ── Financial — funding dashboard, standalone bottom-left
  {
    id: "financial",
    label: "Financial",
    symbol: "◇",
    lucideIcon: "Landmark",
    accent: "hsl(155 58% 52%)",
    x: 25, y: 87,
    size: 15,
    depth: 1.0,
    href: "/funding",
    tagline: "Cash projection, accountability, and decision simulation",
    subnodes: [
      { id: "fn-dashboard", label: "Funding Dashboard", icon: "◇", href: "/funding", description: "Financial health, daily spending, timeline, and projections" },
    ],
    connections: ["strategic"],
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
