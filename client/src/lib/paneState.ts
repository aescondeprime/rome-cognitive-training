/**
 * paneState — the live pane tree, and the drag that builds it.
 *
 * Two stores, both outside React for the same reason: the things that read them
 * (the pane host, the top-bar navigator, the drag ghost) are scattered across
 * the tree with no common ancestor short of `App`, and the drag in particular
 * has to survive the menu that started it closing underneath the pointer.
 *
 * The pointer position is deliberately *not* in here. A drag moves the pointer
 * sixty times a second and re-rendering the pane host that often to move a
 * 140px chip would be absurd; the ghost writes its own `transform` from a raw
 * listener instead, exactly as `RomeCursor` does. What the store holds is the
 * part that changes rarely — what is being dragged, and which drop zone is
 * currently lit.
 */
import { useSyncExternalStore } from "react";
import {
  loadPanes, savePanes, type PaneTree, type DropEdge,
} from "./splitPanes";

// ── The tree ───────────────────────────────────────────────────────────────

let tree: PaneTree = loadPanes();
const treeListeners = new Set<() => void>();

export function getPaneTree(): PaneTree { return tree; }

export function setPaneTree(next: PaneTree | ((prev: PaneTree) => PaneTree)) {
  const value = typeof next === "function" ? next(tree) : next;
  if (value === tree) return;
  tree = value;
  savePanes(tree);
  treeListeners.forEach(listener => listener());
}

function subscribeTree(listener: () => void) {
  treeListeners.add(listener);
  return () => { treeListeners.delete(listener); };
}

export function usePaneTree(): PaneTree {
  return useSyncExternalStore(subscribeTree, getPaneTree, getPaneTree);
}

// ── The drag ───────────────────────────────────────────────────────────────

export interface DomainDrag {
  /** Route the dropped pane will show. */
  path: string;
  label: string;
  icon: string;
}

export interface DropTarget {
  leafId: string;
  edge: DropEdge;
}

interface DragState {
  drag: DomainDrag | null;
  target: DropTarget | null;
}

let dragState: DragState = { drag: null, target: null };
const dragListeners = new Set<() => void>();

function emitDrag() { dragListeners.forEach(listener => listener()); }

export function getDragState(): DragState { return dragState; }

export function beginDomainDrag(drag: DomainDrag) {
  dragState = { drag, target: null };
  document.documentElement.dataset.romePaneDrag = "true";
  emitDrag();
}

export function setDropTarget(target: DropTarget | null) {
  const current = dragState.target;
  if (current === target) return;
  if (current && target && current.leafId === target.leafId && current.edge === target.edge) return;
  dragState = { ...dragState, target };
  emitDrag();
}

export function endDomainDrag() {
  if (!dragState.drag && !dragState.target) return;
  dragState = { drag: null, target: null };
  delete document.documentElement.dataset.romePaneDrag;
  emitDrag();
}

function subscribeDrag(listener: () => void) {
  dragListeners.add(listener);
  return () => { dragListeners.delete(listener); };
}

export function useDragState(): DragState {
  return useSyncExternalStore(subscribeDrag, getDragState, getDragState);
}
