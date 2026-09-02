/**
 * PaneHost — the main content area, as a resizable pane tree.
 *
 * It is always mounted, even when nothing is split. That is deliberate: with a
 * single pane it renders the exact markup `AppShell` used to render inline, so
 * the unsplit app is byte-for-byte what it was, and there is still a live drop
 * target on screen for the first domain you drag out of the top bar. A host
 * that only appeared once a split existed would have nowhere to receive the
 * drop that creates one.
 *
 * The primary pane renders `children` — the app's own routed content. Every
 * other pane renders `RomeRoutes` inside its own wouter `Router`, pointed at
 * that pane's path. So the address bar, the back button, the constellation and
 * Akira all keep navigating one pane, and the rest are independent.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { X, Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import RomeRoutes from "@/routes";
import {
  usePaneTree, setPaneTree, useDragState, setDropTarget, endDomainDrag,
  type DomainDrag,
} from "@/lib/paneState";
import {
  closePane, isSingle, leaves, splitPane, resizeSplit, setPanePath,
  type DropEdge, type PaneLeaf, type PaneSplit, type PaneTree,
} from "@/lib/splitPanes";
import { labelForPath, domainForPath } from "@/lib/domainCatalog";
import { accent } from "@/lib/accent";
import { playCue } from "@/lib/sound";

/**
 * How much of a pane's width or height counts as an edge.
 *
 * 0.28 rather than something tighter because the target is a moving pointer,
 * not a click: too narrow and a drop meant for the right-hand side lands in the
 * middle and replaces the pane you were trying to keep. The centre is still the
 * largest zone by area, which is right — replacing is the commoner intent.
 */
const EDGE_FRACTION = 0.28;

// ── Drop hit-testing ───────────────────────────────────────────────────────

interface Hit { leafId: string; edge: DropEdge }

/**
 * Which pane, and which of its edges, is under the pointer.
 *
 * Measured off the DOM rather than from the tree: the tree knows fractions, and
 * turning fractions back into screen rectangles would mean duplicating the
 * flexbox layout in arithmetic and keeping the two in step. The elements are
 * already on screen and already know where they are.
 */
function hitTest(x: number, y: number): Hit | null {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-pane-leaf]"));
  for (const node of nodes) {
    const r = node.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
    if (r.width < 40 || r.height < 40) continue;
    const rx = (x - r.left) / r.width;
    const ry = (y - r.top) / r.height;
    const distances: [DropEdge, number][] = [
      ["left", rx], ["right", 1 - rx], ["top", ry], ["bottom", 1 - ry],
    ];
    distances.sort((a, b) => a[1] - b[1]);
    const [edge, distance] = distances[0];
    return { leafId: node.dataset.paneLeaf!, edge: distance <= EDGE_FRACTION ? edge : "center" };
  }
  return null;
}

// ── Drag ghost ─────────────────────────────────────────────────────────────

/**
 * The chip that follows the pointer while a domain is in flight.
 *
 * Its transform is written straight onto the node from the pointer listener.
 * Routing it through React state would re-render the whole pane host on every
 * pointer move to shift a 140px label — the same reason `RomeCursor` never
 * touches state on `mousemove`.
 */
function DragGhost({ drag }: { drag: DomainDrag }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const node = ref.current;
      if (!node) return;
      node.style.transform = `translate3d(${e.clientX + 14}px, ${e.clientY + 14}px, 0)`;
    };
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, []);

  return (
    <div
      ref={ref}
      style={{
        position: "fixed", top: 0, left: 0, zIndex: 400,
        pointerEvents: "none",
        display: "flex", alignItems: "center", gap: 7,
        padding: "5px 10px",
        fontFamily: "DM Mono, monospace", fontSize: 10, letterSpacing: "0.1em",
        color: "hsl(220 15% 88%)",
        background: "hsl(222 22% 7% / 0.92)",
        border: `1px solid ${accent()}`,
        boxShadow: `0 0 22px ${accent(0.32)}, 0 8px 24px hsl(222 40% 2% / 0.6)`,
        backdropFilter: "blur(6px)",
      }}
    >
      <span style={{ color: accent(), fontSize: 11 }}>{drag.icon}</span>
      {drag.label}
    </div>
  );
}

// ── Drop indicator ─────────────────────────────────────────────────────────

function dropRect(edge: DropEdge): React.CSSProperties {
  switch (edge) {
    case "left":   return { left: 0, top: 0, bottom: 0, width: "50%" };
    case "right":  return { right: 0, top: 0, bottom: 0, width: "50%" };
    case "top":    return { left: 0, right: 0, top: 0, height: "50%" };
    case "bottom": return { left: 0, right: 0, bottom: 0, height: "50%" };
    default:       return { inset: 0 };
  }
}

function DropIndicator({ edge }: { edge: DropEdge }) {
  return (
    <div
      className="rome-pane-drop"
      style={{
        position: "absolute",
        zIndex: 30,
        pointerEvents: "none",
        background: accent(0.10),
        border: `1px solid ${accent(0.7)}`,
        boxShadow: `inset 0 0 40px ${accent(0.18)}`,
        transition: "all 120ms ease",
        ...dropRect(edge),
      }}
    />
  );
}

// ── Pane width buckets ─────────────────────────────────────────────────────

/**
 * Tag each pane with how wide it actually is.
 *
 * Pages in ROME are laid out against the viewport — Tailwind's `md:` and `lg:`
 * are media queries, and a media query knows nothing about a 40%-wide pane. The
 * bucket lands on the pane element as `data-pane-w`, and the rules in
 * `index.css` hang off it, so a page reflows to the space it was actually given
 * rather than to the size of the window it happens to be inside.
 */
function usePaneWidthBucket(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => {
      const w = el.clientWidth;
      const bucket = w < 420 ? "xs" : w < 640 ? "sm" : w < 900 ? "md" : "lg";
      if (el.dataset.paneW !== bucket) el.dataset.paneW = bucket;
    };
    apply();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(apply) : null;
    observer?.observe(el);
    window.addEventListener("resize", apply);
    return () => { observer?.disconnect(); window.removeEventListener("resize", apply); };
  }, [ref]);
}

// ── One pane ───────────────────────────────────────────────────────────────

interface LeafProps {
  leaf: PaneLeaf;
  /** True when this is the only pane — the unsplit app. */
  solo: boolean;
  /** `/world` is already taken by an earlier pane. */
  worldTaken: boolean;
  children: React.ReactNode;
}

function PaneLeafView({ leaf, solo, worldTaken, children }: LeafProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [appLocation] = useHashLocation();
  const { drag, target } = useDragState();
  usePaneWidthBucket(ref);

  const path = leaf.path ?? appLocation;
  const domain = domainForPath(path);
  const isWorld = path === "/world";
  const desktopWorld = isWorld && Boolean(window.romeDesktop?.isDesktop);

  /**
   * This pane's location hook. Only non-primary panes get one — the primary
   * renders `children`, which is already wired to the window's hash, and
   * wrapping it in a second router would quietly detach the address bar.
   */
  const paneLocationHook = useCallback(
    () => [path, (to: string) => setPaneTree(t => setPanePath(t, leaf.id, to))] as
      [string, (to: string) => void],
    [path, leaf.id],
  );

  const onClose = useCallback(() => {
    setPaneTree(t => {
      const { tree, navigateTo } = closePane(t, leaf.id);
      // The primary was closed and another pane inherited the role, so the app
      // has to follow it — otherwise the hash still points at a route nothing
      // on screen is showing.
      if (navigateTo) window.location.hash = navigateTo;
      return tree;
    });
    playCue("constellationClose");
  }, [leaf.id]);

  const showIndicator = drag && target?.leafId === leaf.id;

  return (
    <div
      ref={ref}
      data-pane-leaf={leaf.id}
      className={cn("rome-pane", !solo && "is-split", isWorld && "is-world")}
      style={{
        position: "relative",
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header. The unsplit app never had one and does not get one now. */}
      {!solo && (
        <div
          className="rome-pane-head"
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "3px 8px",
            borderBottom: `1px solid ${accent(0.22)}`,
            background: "hsl(222 20% 5% / 0.72)",
            flexShrink: 0,
          }}
        >
          <span style={{ color: accent(), fontSize: 10, lineHeight: 1 }}>{domain?.icon ?? "◇"}</span>
          <span
            style={{
              fontFamily: "DM Mono, monospace", fontSize: 8.5,
              letterSpacing: "0.18em", textTransform: "uppercase",
              color: "hsl(220 12% 62%)",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}
          >
            {labelForPath(path)}
          </span>
          {leaf.path === null && (
            <span
              title="Primary pane — follows the address bar and the constellation"
              style={{ display: "inline-flex", color: accent(), opacity: 0.6 }}
            >
              <Pin size={9} />
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            title="Close pane"
            className="opacity-40 hover:opacity-90 transition-opacity"
            style={{ background: "none", border: 0, cursor: "pointer", color: "hsl(220 12% 70%)", padding: 2, lineHeight: 0 }}
          >
            <X size={11} />
          </button>
        </div>
      )}

      {/* Body. `p-8` and the scroll container are what `AppShell` used to own;
          the World Browser still needs the whole rectangle and no padding. */}
      <div
        className={cn(
          "rome-pane-body flex-1 min-h-0",
          desktopWorld ? "overflow-hidden" : "overflow-y-auto overflow-x-hidden",
        )}
      >
        <div className={cn("min-h-full", desktopWorld ? "h-full min-h-0 p-0" : "p-8")}>
          {leaf.path === null ? children : (
            isWorld && worldTaken ? (
              // One native `WebContentsView`, one set of bounds. A second
              // WorldBrowser would fight the first for it and both would end up
              // pointing somewhere neither pane is.
              <div
                className="flex h-full items-center justify-center text-center"
                style={{ fontFamily: "DM Mono, monospace", fontSize: 9, letterSpacing: "0.16em", color: "hsl(220 10% 40%)" }}
              >
                THE WORLD BROWSER IS OPEN IN ANOTHER PANE
              </div>
            ) : (
              <Router hook={paneLocationHook}>
                <RomeRoutes />
              </Router>
            )
          )}
        </div>
      </div>

      {showIndicator && <DropIndicator edge={target!.edge} />}
    </div>
  );
}

// ── Divider ────────────────────────────────────────────────────────────────

function PaneDivider({
  split, index, containerRef,
}: {
  split: PaneSplit;
  index: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [active, setActive] = useState(false);
  const row = split.axis === "row";

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const length = row ? rect.width : rect.height;
    if (length <= 0) return;
    const start = row ? e.clientX : e.clientY;
    setActive(true);

    // `resizeSplit` applies a delta to the sizes as they are now, so each move
    // sends only what has changed since the last one. Sending the distance from
    // the grab point every time would apply the whole drag on every frame and
    // slam the divider into its clamp after about three pixels.
    let applied = 0;

    const onMove = (ev: PointerEvent) => {
      const now = row ? ev.clientX : ev.clientY;
      const delta = (now - start) / length;
      const step = delta - applied;
      applied = delta;
      if (step === 0) return;
      setPaneTree(t => resizeSplit(t, split.id, index, step));
    };
    const onUp = () => {
      setActive(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [split, index, row, containerRef]);

  return (
    <div
      onPointerDown={onPointerDown}
      className={cn("rome-pane-divider", active && "is-active")}
      style={{
        flex: "0 0 auto",
        width:  row ? 5 : undefined,
        height: row ? undefined : 5,
        cursor: row ? "col-resize" : "row-resize",
        position: "relative",
        zIndex: 20,
        touchAction: "none",
      }}
    />
  );
}

// ── Tree ───────────────────────────────────────────────────────────────────

function PaneTreeView({
  node, solo, worldOwner, children,
}: {
  node: PaneTree;
  solo: boolean;
  /** Id of the pane allowed to mount the World Browser. */
  worldOwner: string | null;
  children: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  if (node.kind === "leaf") {
    return (
      <PaneLeafView
        leaf={node}
        solo={solo}
        worldTaken={worldOwner !== null && worldOwner !== node.id}
      >
        {children}
      </PaneLeafView>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        display: "flex",
        flexDirection: node.axis === "row" ? "row" : "column",
        flex: 1, minWidth: 0, minHeight: 0,
      }}
    >
      {node.children.map((child, i) => (
        <Fragment key={child.id}>
          {i > 0 && <PaneDivider split={node} index={i} containerRef={containerRef} />}
          <div
            style={{
              flexGrow: node.sizes[i] ?? 1 / node.children.length,
              flexShrink: 1,
              flexBasis: 0,
              minWidth: 0, minHeight: 0,
              display: "flex",
            }}
          >
            <PaneTreeView node={child} solo={false} worldOwner={worldOwner}>
              {children}
            </PaneTreeView>
          </div>
        </Fragment>
      ))}
    </div>
  );
}

// ── Host ───────────────────────────────────────────────────────────────────

export default function PaneHost({ children }: { children: React.ReactNode }) {
  const tree = usePaneTree();
  const { drag } = useDragState();
  const [appLocation, navigate] = useHashLocation();

  const solo = isSingle(tree);

  /**
   * The pane that owns the World Browser: the first one showing `/world`, with
   * the primary winning if it is one of them. Everything else showing that
   * route gets a note instead of a second, doomed copy.
   */
  const worldOwner = useMemo(() => {
    const all = leaves(tree);
    const primary = all.find(l => l.path === null);
    if (primary && appLocation === "/world") return primary.id;
    return all.find(l => l.path === "/world")?.id ?? null;
  }, [tree, appLocation]);

  // Drag lifecycle. The listeners live here rather than on the drag source so
  // the drop still resolves when the top-bar menu closes out from under the
  // pointer — which it does, the moment the pointer leaves the header.
  useEffect(() => {
    if (!drag) return;

    const onMove = (e: PointerEvent) => setDropTarget(hitTest(e.clientX, e.clientY));

    const onUp = (e: PointerEvent) => {
      const hit = hitTest(e.clientX, e.clientY);
      if (hit) {
        const leaf = leaves(tree).find(l => l.id === hit.leafId);
        // Dropping into the middle of the primary pane is a navigation, not a
        // replacement: that pane shows the app's own route, and rewriting its
        // path would mean two sources of truth for where the app is.
        if (hit.edge === "center" && leaf && leaf.path === null) navigate(drag.path);
        else setPaneTree(t => splitPane(t, hit.leafId, hit.edge, drag.path));
        playCue("domainEnter");
      }
      endDomainDrag();
    };

    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") endDomainDrag(); };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, [drag, tree, navigate]);

  return (
    <>
      <div
        className={cn("rome-pane-host", drag && "is-dropping")}
        style={{ display: "flex", flex: 1, minHeight: 0, minWidth: 0, height: "100%" }}
      >
        <PaneTreeView node={tree} solo={solo} worldOwner={worldOwner}>
          {children}
        </PaneTreeView>
      </div>
      {drag && <DragGhost drag={drag} />}
    </>
  );
}
