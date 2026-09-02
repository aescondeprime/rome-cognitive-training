/**
 * splitPanes — the pane tree behind ROME's split screen.
 *
 * The model is a binary-ish tree of splits and leaves. A leaf shows one route;
 * a split lays its children out along an axis with a size fraction each. Drop a
 * domain on the left or right edge of a pane and you get a `row` split; on the
 * top or bottom edge, a `col`. Dropping onto the middle of a pane replaces what
 * is in it.
 *
 * Two decisions worth keeping:
 *
 * **One leaf is primary, and it has no path of its own.** Its `path` is `null`
 * and it renders whatever the app's real hash route is. That is what keeps the
 * URL, the back button, the constellation and Akira all still meaning
 * something: splitting the screen does not take navigation away from them, it
 * just puts other routes beside them. Every other leaf carries its own path and
 * navigates independently.
 *
 * **Splitting along an axis that already exists inserts a sibling instead of
 * nesting.** Three drops on the right edge give three columns, not a column
 * containing a column containing a column. Nesting is still reachable — drop on
 * a *different* axis — but the common case stays flat, and flat is what
 * survives being resized.
 */

export type PaneAxis = "row" | "col";
export type DropEdge = "left" | "right" | "top" | "bottom" | "center";

export interface PaneLeaf {
  kind: "leaf";
  id: string;
  /** `null` marks the primary pane, which follows the app's own location. */
  path: string | null;
}

export interface PaneSplit {
  kind: "split";
  id: string;
  axis: PaneAxis;
  /** One fraction per child; always normalised to sum to 1. */
  sizes: number[];
  children: PaneTree[];
}

export type PaneTree = PaneLeaf | PaneSplit;

/** Smallest share of its split a pane may be dragged down to. */
export const MIN_PANE_FRACTION = 0.12;

const STORAGE_KEY = "rome_split_panes_v1";

let counter = 0;
function newId(prefix: string) {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function primaryLeaf(): PaneLeaf {
  return { kind: "leaf", id: "pane-primary", path: null };
}

export function isSplit(tree: PaneTree): tree is PaneSplit {
  return tree.kind === "split";
}

/** Every leaf, left to right / top to bottom. */
export function leaves(tree: PaneTree): PaneLeaf[] {
  if (tree.kind === "leaf") return [tree];
  return tree.children.flatMap(leaves);
}

export function paneCount(tree: PaneTree): number {
  return leaves(tree).length;
}

/** True when the screen is not split — the state the app spends most time in. */
export function isSingle(tree: PaneTree): boolean {
  return tree.kind === "leaf";
}

function normalise(sizes: number[]): number[] {
  const total = sizes.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return sizes.map(() => 1 / sizes.length);
  return sizes.map(s => s / total);
}

/**
 * Collapse anything the tree no longer needs: splits with one child, and splits
 * nested directly inside a split of the same axis.
 *
 * Called after every removal. Without it, closing panes leaves a spine of
 * one-child splits that each still own a divider and a size array, and the next
 * insert lands in the wrong place.
 */
function simplify(tree: PaneTree): PaneTree {
  if (tree.kind === "leaf") return tree;
  const children = tree.children.map(simplify);
  if (children.length === 1) return children[0];

  // Flatten same-axis children into this split, carrying their sizes with them.
  const flatChildren: PaneTree[] = [];
  const flatSizes: number[] = [];
  children.forEach((child, i) => {
    const size = tree.sizes[i] ?? 1 / children.length;
    if (child.kind === "split" && child.axis === tree.axis) {
      child.children.forEach((grand, gi) => {
        flatChildren.push(grand);
        flatSizes.push(size * (child.sizes[gi] ?? 1 / child.children.length));
      });
    } else {
      flatChildren.push(child);
      flatSizes.push(size);
    }
  });

  return { ...tree, children: flatChildren, sizes: normalise(flatSizes) };
}

/** Depth-first replace of one node, returning a new tree. */
function mapTree(tree: PaneTree, id: string, fn: (node: PaneTree) => PaneTree): PaneTree {
  if (tree.id === id) return fn(tree);
  if (tree.kind === "leaf") return tree;
  let changed = false;
  const children = tree.children.map(child => {
    const next = mapTree(child, id, fn);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...tree, children } : tree;
}

function parentOf(tree: PaneTree, id: string): PaneSplit | null {
  if (tree.kind === "leaf") return null;
  if (tree.children.some(c => c.id === id)) return tree;
  for (const child of tree.children) {
    const found = parentOf(child, id);
    if (found) return found;
  }
  return null;
}

export function findLeaf(tree: PaneTree, id: string): PaneLeaf | null {
  return leaves(tree).find(l => l.id === id) ?? null;
}

const AXIS_FOR: Record<Exclude<DropEdge, "center">, PaneAxis> = {
  left: "row", right: "row", top: "col", bottom: "col",
};

/**
 * Put `path` beside (or into) the leaf `targetId`.
 *
 * `center` replaces the pane's contents — which is refused for the primary
 * pane, because that pane's content *is* the app's location; the caller
 * navigates instead. Every other edge inserts a new leaf.
 */
export function splitPane(
  tree: PaneTree,
  targetId: string,
  edge: DropEdge,
  path: string,
): PaneTree {
  if (edge === "center") {
    return mapTree(tree, targetId, node =>
      node.kind === "leaf" && node.path !== null ? { ...node, path } : node);
  }

  const axis = AXIS_FOR[edge];
  const before = edge === "left" || edge === "top";
  const fresh: PaneLeaf = { kind: "leaf", id: newId("pane"), path };
  const parent = parentOf(tree, targetId);

  // Same axis as the split this pane already lives in: become a sibling, and
  // take half of the target's share rather than re-dividing the whole row.
  if (parent && parent.axis === axis) {
    const index = parent.children.findIndex(c => c.id === targetId);
    const share = parent.sizes[index] ?? 1 / parent.children.length;
    const children = [...parent.children];
    const sizes = [...parent.sizes];
    children.splice(before ? index : index + 1, 0, fresh);
    sizes.splice(index, 1, share / 2);
    sizes.splice(before ? index : index + 1, 0, share / 2);
    return simplify(mapTree(tree, parent.id, () => ({
      ...parent, children, sizes: normalise(sizes),
    })));
  }

  // Otherwise wrap the target in a new split.
  return simplify(mapTree(tree, targetId, node => ({
    kind: "split",
    id: newId("split"),
    axis,
    sizes: [0.5, 0.5],
    children: before ? [fresh, node] : [node, fresh],
  })));
}

/**
 * Remove a pane.
 *
 * Closing the primary is allowed, and is the one case that needs care: some
 * other leaf has to become primary, and the app has to navigate to whatever
 * that leaf was showing so the promotion does not silently change the route.
 * The caller is told which path to navigate to.
 */
export function closePane(tree: PaneTree, id: string): { tree: PaneTree; navigateTo: string | null } {
  const all = leaves(tree);
  if (all.length <= 1) return { tree, navigateTo: null };

  const target = all.find(l => l.id === id);
  if (!target) return { tree, navigateTo: null };

  const parent = parentOf(tree, id);
  if (!parent) return { tree, navigateTo: null };

  const index = parent.children.findIndex(c => c.id === id);
  const children = parent.children.filter(c => c.id !== id);
  const sizes = parent.sizes.filter((_, i) => i !== index);

  let next = simplify(mapTree(tree, parent.id, () => ({
    ...parent, children, sizes: normalise(sizes),
  })));

  if (target.path !== null) return { tree: next, navigateTo: null };

  // The primary went. Promote the nearest survivor and hand its route to the
  // app, so the address bar and the map agree with what is on screen.
  const survivors = leaves(next);
  const heir = survivors[Math.min(index, survivors.length - 1)] ?? survivors[0];
  const navigateTo = heir.path;
  next = mapTree(next, heir.id, node =>
    node.kind === "leaf" ? { ...node, path: null } : node);
  return { tree: next, navigateTo };
}

/** Collapse the whole thing back to one pane showing the app's own route. */
export function resetPanes(): PaneTree {
  return primaryLeaf();
}

export function setPanePath(tree: PaneTree, id: string, path: string): PaneTree {
  return mapTree(tree, id, node =>
    node.kind === "leaf" && node.path !== null ? { ...node, path } : node);
}

/**
 * Move one divider. `index` is the divider's position — it sits between
 * children `index - 1` and `index` — and `delta` is the fraction of the split's
 * length it moved by. Neither neighbour is allowed below `MIN_PANE_FRACTION`,
 * which is what stops a pane being dragged to nothing and stranded there with
 * no header left to close it by.
 */
export function resizeSplit(tree: PaneTree, splitId: string, index: number, delta: number): PaneTree {
  return mapTree(tree, splitId, node => {
    if (node.kind !== "split") return node;
    const a = node.sizes[index - 1];
    const b = node.sizes[index];
    if (a === undefined || b === undefined) return node;
    const total = a + b;
    const nextA = Math.min(total - MIN_PANE_FRACTION, Math.max(MIN_PANE_FRACTION, a + delta));
    const sizes = [...node.sizes];
    sizes[index - 1] = nextA;
    sizes[index] = total - nextA;
    return { ...node, sizes };
  });
}

// ── Persistence ────────────────────────────────────────────────────────────

/**
 * A stored tree is user data that has been through JSON, so it is validated
 * rather than trusted: a malformed one would otherwise render as a blank
 * workspace with no way back short of clearing localStorage by hand.
 */
function validate(node: unknown): PaneTree | null {
  if (!node || typeof node !== "object") return null;
  const n = node as Record<string, unknown>;
  if (n.kind === "leaf") {
    if (typeof n.id !== "string") return null;
    if (n.path !== null && typeof n.path !== "string") return null;
    return { kind: "leaf", id: n.id, path: n.path as string | null };
  }
  if (n.kind === "split") {
    if (typeof n.id !== "string") return null;
    if (n.axis !== "row" && n.axis !== "col") return null;
    if (!Array.isArray(n.children) || n.children.length === 0) return null;
    const children = n.children.map(validate);
    if (children.some(c => c === null)) return null;
    const raw = Array.isArray(n.sizes) ? (n.sizes as unknown[]) : [];
    const sizes = children.map((_, i) => {
      const v = raw[i];
      return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 1 / children.length;
    });
    return { kind: "split", id: n.id, axis: n.axis, sizes: normalise(sizes), children: children as PaneTree[] };
  }
  return null;
}

/** Exactly one leaf may be primary, and one must be. */
function enforcePrimary(tree: PaneTree): PaneTree {
  const all = leaves(tree);
  const primaries = all.filter(l => l.path === null);
  if (primaries.length === 1) return tree;
  let next = tree;
  if (primaries.length === 0) {
    next = mapTree(next, all[0].id, node =>
      node.kind === "leaf" ? { ...node, path: null } : node);
  } else {
    // Keep the first; give the rest something to show. A duplicate primary can
    // only come from a corrupted store, so the fallback just has to be valid.
    primaries.slice(1).forEach(dup => {
      next = mapTree(next, dup.id, node =>
        node.kind === "leaf" ? { ...node, path: "/athena" } : node);
    });
  }
  return next;
}

export function loadPanes(): PaneTree {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return primaryLeaf();
    const parsed = validate(JSON.parse(raw));
    if (!parsed) return primaryLeaf();
    return enforcePrimary(simplify(parsed));
  } catch {
    return primaryLeaf();
  }
}

export function savePanes(tree: PaneTree) {
  try {
    if (isSingle(tree)) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(tree));
  } catch {}
}
