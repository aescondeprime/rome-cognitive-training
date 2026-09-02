/**
 * TopBarNav — the constellation, folded into the top bar.
 *
 * At rest it draws **nothing at all** — just an invisible strip in the middle
 * of the header holding the space the menu will occupy. Hovering it unfolds the
 * nodes; hovering a node drops its domains beneath it. Clicking a domain
 * navigates; dragging one out of the menu splits the screen with it (see
 * `PaneHost`).
 *
 * The strip is sized rather than empty because a zero-width element cannot be
 * hovered. Nothing inside it is painted until the pointer arrives.
 *
 * Both gestures start from the same target, which is the only fiddly part.
 * A pointerdown is ambiguous until it either moves or is released, so the chip
 * arms a drag on `pointerdown`, promotes it to a real one past a few pixels of
 * travel, and treats a release before that as a click. Nothing happens on
 * pointerdown itself, so a stray press is always recoverable.
 *
 * The menu closes the moment a drag begins. It hangs over the top of the
 * workspace, which is exactly where the top edge of the drop target lives, and
 * a menu covering the zone you are aiming at is worse than no menu at all.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useHashLocation } from "wouter/use-hash-location";
import * as Icons from "lucide-react";
import { NODES } from "@/lib/domainCatalog";
import { accent, accentDim } from "@/lib/accent";
import type { ConstellationNode } from "@/lib/constellationData";
import { beginDomainDrag, useDragState } from "@/lib/paneState";
import { useConstellationUi } from "@/lib/constellationUiState";
import { playCue } from "@/lib/sound";

/** Pointer travel, in px, that turns a press into a drag. */
const DRAG_THRESHOLD = 5;
/** Grace period before the menu folds away, ms. */
const CLOSE_DELAY = 180;

function NodeGlyph({ node, size = 15 }: { node: ConstellationNode; size?: number }) {
  const name = node.lucideIcon as keyof typeof Icons | undefined;
  const Icon = name ? (Icons[name] as React.ComponentType<{ size?: number }> | undefined) : undefined;
  if (Icon) return <Icon size={size} />;
  // Every node carries a glyph as well as an icon name, so an icon that has
  // been renamed out of lucide degrades to the map's own symbol rather than a
  // hole in the bar.
  return <span style={{ fontSize: size }}>{node.symbol}</span>;
}

export default function TopBarNav() {
  const [open, setOpen] = useState(false);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  /**
   * Where the flyout points, in pixels from the left of the navigator.
   *
   * The panel belongs to the icon you are hovering, not to the middle of the
   * bar — centring it on the strip makes the same panel appear in the same
   * place for all eight nodes, which reads as a single menu that keeps changing
   * its mind rather than as eight. Measured from the rendered button, because
   * the icons are laid out by flexbox and their centres are not something this
   * component should be recomputing in arithmetic.
   */
  const [anchor, setAnchor] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const [, navigate] = useHashLocation();
  const { drag } = useDragState();
  const { mapOpen } = useConstellationUi();
  const closeTimer = useRef<number | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
      setHoveredNode(null);
    }, CLOSE_DELAY);
  }, [cancelClose]);

  useEffect(() => cancelClose, [cancelClose]);

  // A drag that started here owns the screen now; get out of its way.
  useEffect(() => {
    if (drag) { cancelClose(); setOpen(false); setHoveredNode(null); }
  }, [drag, cancelClose]);

  /**
   * One handler for both gestures. Returns the props a draggable target needs,
   * so the node icons and the domain chips behave identically without either
   * one owning the logic.
   */
  const dragProps = useCallback((item: {
    path: string; label: string; icon: string;
  }) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      let promoted = false;

      const onMove = (ev: PointerEvent) => {
        if (promoted) return;
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
        promoted = true;
        beginDomainDrag(item);
        playCue("domainShift");
        // `PaneHost` owns the drag from here: it hit-tests the panes, paints
        // the drop zone and ends the drag on release. Two sets of listeners
        // racing for the same pointerup is how a drop lands twice.
        cleanup();
      };
      const onUp = () => {
        if (!promoted) { navigate(item.path); playCue("domainEnter"); setOpen(false); setHoveredNode(null); }
        cleanup();
      };
      function cleanup() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    style: { touchAction: "none" as const },
  }), [navigate]);

  const hoverNode = useCallback((id: string, el: HTMLElement) => {
    setHoveredNode(id);
    const root = rootRef.current;
    if (!root) return;
    const button = el.getBoundingClientRect();
    const bar = root.getBoundingClientRect();
    setAnchor(button.left + button.width / 2 - bar.left);
  }, []);

  const active = NODES.find(n => n.id === hoveredNode) ?? null;

  /**
   * The map is the navigator while it is open, and this one has to get out of
   * the way for it.
   *
   * Not merely a visual preference: the menu carries a z-index high enough to
   * clear the floating widgets, and the constellation is a portal at 200 — so
   * left mounted, the resting dots would paint *through* the map. The overlay
   * covers the header anyway, so there is nothing here to reach.
   */
  if (mapOpen) return null;

  return (
    <div
      ref={rootRef}
      onPointerEnter={() => { cancelClose(); setOpen(true); }}
      onPointerLeave={scheduleClose}
      style={{
        position: "relative",
        // Above the widget layer (202) and the map's own chrome: this menu
        // reaches down over the workspace and must not be painted into.
        zIndex: 320,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        // A generous hit area, so the menu opens on approach rather than on a
        // precise hit of a 4px dot.
        padding: "2px 22px",
        margin: "-2px 0",
      }}
    >
      {/* ── Resting state: nothing, holding the right amount of space ────
          Exactly one of this and the unfolded row is in flow at any moment, so
          the header never changes height as the menu opens. This is the in-flow
          one at rest, and it paints nothing whatsoever. */}
      <div
        aria-hidden
        style={{
          height: 18,
          width: NODES.length * 26,
          pointerEvents: "none",
          position: open ? "absolute" : "relative",
        }}
      />

      {/* ── Unfolded: the nodes ─────────────────────────────────────────── */}
      <div
        style={{
          display: "flex", alignItems: "center", gap: 2,
          height: 18,
          opacity: open ? 1 : 0,
          transform: open ? "none" : "translateY(3px)",
          transition: "opacity 200ms ease, transform 200ms ease",
          pointerEvents: open ? undefined : "none",
          position: open ? "relative" : "absolute",
        }}
      >
        {NODES.map(node => {
          const hot = hoveredNode === node.id;
          const drags = dragProps({ path: node.href, label: node.label, icon: node.symbol });
          return (
            <button
              key={node.id}
              onPointerEnter={e => hoverNode(node.id, e.currentTarget)}
              title={node.label}
              className="rome-topnav-node"
              onPointerDown={drags.onPointerDown}
              style={{
                ...drags.style,
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 26, height: 18,
                background: "none", border: 0, cursor: "pointer", padding: 0,
                color: hot ? accent() : accentDim(22, 40),
                filter: hot ? `drop-shadow(0 0 6px ${accent(0.55)})` : undefined,
                transition: "color 150ms ease, filter 150ms ease",
              }}
            >
              <NodeGlyph node={node} />
            </button>
          );
        })}
      </div>

      {/* ── The hovered node's domains ──────────────────────────────────── */}
      {open && active && (
        <div
          className="rome-topnav-flyout"
          style={{
            position: "absolute",
            top: "100%",
            left: anchor,
            transform: "translateX(-50%)",
            marginTop: 6,
            minWidth: 190,
            maxWidth: 320,
            padding: "7px 8px 8px",
            background: "hsl(222 22% 5% / 0.94)",
            border: `1px solid ${accent(0.3)}`,
            boxShadow: `0 14px 40px hsl(222 40% 2% / 0.7), 0 0 24px ${accent(0.12)}`,
            backdropFilter: "blur(14px)",
          }}
        >
          {/* No heading and no legend. The icon you are hovering is directly
              above this panel and already says which node it belongs to, and a
              line of instructions is only read once — after that it is a line
              of furniture on a menu that wants to be quiet. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {active.subnodes.map(sub => {
              const drags = dragProps({ path: sub.href, label: sub.label, icon: sub.icon });
              return (
              <button
                key={sub.id}
                title={`${sub.description} — drag onto the page to split`}
                className="rome-topnav-domain"
                onPointerDown={drags.onPointerDown}
                style={{
                  ...drags.style,
                  display: "flex", alignItems: "center", gap: 8,
                  width: "100%", textAlign: "left",
                  padding: "5px 7px",
                  background: "none", border: "1px solid transparent",
                  cursor: "grab",
                  fontFamily: "DM Mono, monospace", fontSize: 10, letterSpacing: "0.06em",
                  color: "hsl(220 14% 76%)",
                  transition: "background 140ms ease, border-color 140ms ease, color 140ms ease",
                }}
              >
                <span style={{ color: accent(), fontSize: 11, lineHeight: 1, flexShrink: 0 }}>{sub.icon}</span>
                <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {sub.label}
                </span>
              </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
