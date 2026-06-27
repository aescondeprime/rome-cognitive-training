import { DOMAIN_META } from "./cognitiveData";

// ── Types ──────────────────────────────────────────────────────────────────
export interface SubNode {
  id: string;
  label: string;
  icon: string;       // emoji or lucide name hint
  href: string;
  description: string;
}

export interface ConstellationNode {
  id: string;
  label: string;       // short display label (icon preferred over words in UI)
  symbol: string;      // emoji / unicode symbol shown in node
  accent: string;      // HSL color string for glow + lines
  x: number;           // percent of canvas width  (0–100)
  y: number;           // percent of canvas height (0–100)
  size: number;        // base radius in px
  depth: number;       // 0.5–1.5 — CSS scale / parallax factor
  href: string;        // primary navigation target
  tagline: string;     // one-line descriptor in panel
  subnodes: SubNode[];
  connections: string[]; // IDs of connected nodes (bidirectional drawn once)
}

// ── Node Layout — asymmetric, Skyrim-constellation inspired ───────────────
// x/y are viewport-percentage positions so they scale with window size
export const CONSTELLATION_NODES: ConstellationNode[] = [
  // ── Core hub — Command Center (slightly off-center, upper area)
  {
    id: "command",
    label: "Command Center",
    symbol: "⊕",
    accent: "hsl(43 88% 60%)",
    x: 50, y: 28,
    size: 22,
    depth: 1.0,
    href: "/dashboard",
    tagline: "Your cognitive training operations hub",
    subnodes: [
      { id: "s-session",  label: "Begin Session", icon: "⚡", href: "/training",  description: "Start a guided training protocol" },
      { id: "s-profile",  label: "My Profile",    icon: "◎", href: "/profile",   description: "View cognitive domain scores" },
      { id: "s-profiles", label: "Profiles",       icon: "◉", href: "/profiles",  description: "Switch or create profiles" },
      { id: "s-settings", label: "Settings",       icon: "⌬", href: "/settings",  description: "Configure app preferences" },
    ],
    connections: ["recall", "working_memory", "focus", "problem_solving", "metacognition"],
  },

  // ── Recall — upper-left
  {
    id: "recall",
    label: "Recall Engine",
    symbol: "◈",
    accent: "hsl(43 88% 58%)",
    x: 22, y: 22,
    size: 17,
    depth: 0.85,
    href: "/training",
    tagline: "Memory reconstruction & active retrieval",
    subnodes: [
      { id: "r-vault",   label: "Memory Vault", icon: "⬡", href: "/vault",    description: "Spaced recall item library" },
      { id: "r-memory",  label: "Memory Archive", icon: "◉", href: "/memory",   description: "Session memory logs" },
      { id: "r-drill",   label: "Recall Drill",   icon: "▷", href: "/training", description: "Spaced recall training" },
    ],
    connections: ["working_memory", "metacognition"],
  },

  // ── Working Memory — upper-right
  {
    id: "working_memory",
    label: "Working Memory",
    symbol: "⟁",
    accent: "hsl(270 60% 62%)",
    x: 78, y: 20,
    size: 15,
    depth: 0.9,
    href: "/training",
    tagline: "Mental juggling & attentional control",
    subnodes: [
      { id: "wm-nback",  label: "N-Back",   icon: "⟲", href: "/training", description: "Real-world N-back training" },
      { id: "wm-span",   label: "Span Track", icon: "⊞", href: "/training", description: "Multi-variable tracking" },
    ],
    connections: ["focus", "flexibility"],
  },

  // ── Focus — mid-left
  {
    id: "focus",
    label: "Focus Chamber",
    symbol: "◎",
    accent: "hsl(165 55% 48%)",
    x: 15, y: 50,
    size: 14,
    depth: 0.8,
    href: "/training",
    tagline: "Sustained attention & inhibitory control",
    subnodes: [
      { id: "f-stroop", label: "Stroop", icon: "◑", href: "/training", description: "Inhibitory control task" },
      { id: "f-gonogo", label: "Go/No-Go", icon: "⬡", href: "/training", description: "Impulse suppression" },
    ],
    connections: ["flexibility", "metacognition"],
  },

  // ── Flexibility — right-mid
  {
    id: "flexibility",
    label: "Flexibility Arena",
    symbol: "⟳",
    accent: "hsl(25 85% 58%)",
    x: 82, y: 47,
    size: 14,
    depth: 0.88,
    href: "/training",
    tagline: "Task-switching & adaptive responding",
    subnodes: [
      { id: "fl-rule",    label: "Rule Shift",  icon: "◫", href: "/training",  description: "Abrupt rule-change task" },
      { id: "fl-scenarios", label: "Scenarios", icon: "◱", href: "/scenarios", description: "Real-world scenario deck" },
    ],
    connections: ["problem_solving", "creativity"],
  },

  // ── Problem Solving — lower-left
  {
    id: "problem_solving",
    label: "Problem-Solving",
    symbol: "⚙",
    accent: "hsl(210 70% 58%)",
    x: 28, y: 68,
    size: 16,
    depth: 1.05,
    href: "/training",
    tagline: "Causal reasoning & systems thinking",
    subnodes: [
      { id: "ps-fermi",   label: "Fermi",      icon: "⊡", href: "/training",   description: "First-principles estimation" },
      { id: "ps-tasks",   label: "Taskboard",  icon: "⊟", href: "/taskboard",  description: "Strategic task planning" },
      { id: "ps-scenarios", label: "Scenarios", icon: "◰", href: "/scenarios",  description: "Complex scenario deck" },
    ],
    connections: ["creativity", "intuition"],
  },

  // ── Creativity — lower-right
  {
    id: "creativity",
    label: "Creativity Studio",
    symbol: "✦",
    accent: "hsl(35 90% 62%)",
    x: 72, y: 70,
    size: 14,
    depth: 0.95,
    href: "/training",
    tagline: "Divergent thinking & idea generation",
    subnodes: [
      { id: "cr-constraint", label: "Constraint",  icon: "◈", href: "/training",   description: "Constraint creativity task" },
      { id: "cr-philosophy", label: "Philosophy",  icon: "◉", href: "/philosophy", description: "Philosophy chambers" },
    ],
    connections: ["intuition"],
  },

  // ── Intuition — bottom center-right
  {
    id: "intuition",
    label: "Intuition Lab",
    symbol: "◉",
    accent: "hsl(345 60% 58%)",
    x: 55, y: 82,
    size: 13,
    depth: 1.1,
    href: "/training",
    tagline: "Calibrated judgment & pattern recognition",
    subnodes: [
      { id: "in-calib",   label: "Calibration", icon: "◎", href: "/training", description: "Confidence calibration" },
      { id: "in-pattern", label: "Patterns",    icon: "⊞", href: "/training", description: "Pattern recognition" },
    ],
    connections: ["metacognition"],
  },

  // ── Metacognition — bottom-left
  {
    id: "metacognition",
    label: "Metacognition",
    symbol: "⬡",
    accent: "hsl(175 55% 48%)",
    x: 30, y: 84,
    size: 13,
    depth: 0.9,
    href: "/training",
    tagline: "Self-awareness & strategy selection",
    subnodes: [
      { id: "mc-research", label: "Research",  icon: "◉", href: "/research",  description: "Cognitive science library" },
      { id: "mc-memory",   label: "Archive",   icon: "◫", href: "/memory",    description: "Session memory & reflection" },
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

// Map domain IDs from cognitiveData → constellation node accent colors
export const DOMAIN_ACCENT_MAP: Record<string, string> = Object.fromEntries(
  CONSTELLATION_NODES.map(n => [n.id, n.accent])
);
