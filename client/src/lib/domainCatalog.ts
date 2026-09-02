/**
 * domainCatalog — the constellation, flattened into something a menu can walk.
 *
 * `CONSTELLATION_NODES` is written for the map: positions, connection pairs,
 * depth. The top-bar navigator and the split-screen panes want the same data as
 * a plain list — every node, every domain under it, and a way to name the
 * domain a given route belongs to. Deriving that here keeps `constellationData`
 * the single place a node is declared; adding a domain to the map adds it to
 * the navigator with no second edit.
 */
import { CONSTELLATION_NODES, type ConstellationNode, type SubNode } from "./constellationData";

export interface DomainEntry {
  /** `SubNode.id` — unique across the constellation. */
  id: string;
  label: string;
  /** The glyph the map uses for this domain. */
  icon: string;
  href: string;
  description: string;
  /** The node this domain hangs from. */
  nodeId: string;
  nodeLabel: string;
  /** The node's accent, so a domain reads as belonging to its constellation. */
  accent: string;
}

/** Every domain in the constellation, in node order. */
export const DOMAINS: DomainEntry[] = CONSTELLATION_NODES.flatMap(node =>
  node.subnodes.map((sub: SubNode) => ({
    id: sub.id,
    label: sub.label,
    icon: sub.icon,
    href: sub.href,
    description: sub.description,
    nodeId: node.id,
    nodeLabel: node.label,
    accent: node.accent,
  })),
);

/** Nodes in the order the navigator shows them. */
export const NODES: ConstellationNode[] = CONSTELLATION_NODES;

/**
 * The domain a route belongs to.
 *
 * Longest-prefix rather than exact match: `/athena/corsi` is a drill under the
 * Athena node and has its own `SubNode`, but `/academia/recall` does not — it
 * is a state of the Knowledge Forge and should be named as such rather than
 * falling through to "Untitled". An exact-match lookup gets that wrong for
 * every sub-route the map does not enumerate, which is most of them.
 */
export function domainForPath(path: string): DomainEntry | null {
  const clean = path.split("?")[0].replace(/\/+$/, "") || "/";
  let best: DomainEntry | null = null;
  for (const domain of DOMAINS) {
    const href = domain.href.replace(/\/+$/, "") || "/";
    if (clean === href || clean.startsWith(href + "/")) {
      if (!best || href.length > best.href.length) best = domain;
    }
  }
  return best;
}

/** A short human label for a pane header, even for routes no domain claims. */
export function labelForPath(path: string): string {
  const domain = domainForPath(path);
  if (domain) return domain.label;
  const node = NODES.find(n => n.href === path);
  if (node) return node.label;
  const tail = path.split("/").filter(Boolean).pop();
  if (!tail) return "ROME";
  return tail.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}
