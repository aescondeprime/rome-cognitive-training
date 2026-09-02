/**
 * IdeaWorkshop — a blueprint table you drop ideas onto.
 *
 * The shape of the thing:
 * - Cards have no chrome. Hold-drag to move, double-click to edit, right-click
 *   for everything else (colour, link, sub-idea, delete). The old header strip
 *   spent a quarter of every small card on controls that are one click away.
 * - A card starts at whatever size its text needs and grows with it, until you
 *   resize it by a corner — after that the size you chose is the size it keeps.
 * - Text is rich: bold, italic, underline and colour, edited in place in a
 *   contenteditable. A controlled textarea loses the caret on every optimistic
 *   re-render, which is why clicking into the middle of a word used to do
 *   nothing and only the arrow keys worked.
 * - Images (PNG, JPG, GIF) are cards too, so they position, resize, link and
 *   carry sub-ideas exactly like text does.
 * - Sub-ideas are children of a card. Their position is an offset from the
 *   parent, and both live inside one positioned wrapper, so moving a parent
 *   moves its cluster without writing a single child row.
 *
 * Cmd/Ctrl+T adds an idea, Cmd/Ctrl+I adds an image. Inside an editor those
 * two are left alone: Cmd+I has to stay italic where text is being written.
 */

import { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  Plus, Trash2, Link2, Link2Off, Loader2, Lightbulb, Image as ImageIcon,
  CornerDownRight, Repeat2,
  AlignLeft, AlignCenter, AlignRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import BoardShell, { type Board } from "@/components/BoardShell";
// Card handling is shared with the Case Board, which edits cards the same way.
import { contentToHtml, isBlankHtml, sanitizeHtml } from "@/lib/cardText";
import { FormatBar, ResizeHandles, type Corner } from "@/components/CardChrome";

// ── Types ──────────────────────────────────────────────────────────────
interface IdeaCard {
  id: number;
  content: string;
  color: string;
  pos_x: number;
  pos_y: number;
  width: number;          // 0 = size to content
  height: number;         // 0 = size to content
  kind: "text" | "image" | null;
  parent_id: number | null;
  src: string | null;
  align: Align | null;
  tags: string;
  energy: number;
}

interface IdeaConnection {
  id: number;
  from_id: number;
  to_id: number;
  label: string;
}

interface CardSize { w: number; h: number }

// Centre by default: a card is a label far more often than it is a paragraph.
type Align = "left" | "center" | "right";
const ALIGNMENTS: readonly Align[] = ["left", "center", "right"] as const;
const alignOf = (card: IdeaCard): Align =>
  (ALIGNMENTS as readonly string[]).includes(card.align ?? "") ? card.align as Align : "center";

// ── Palette ────────────────────────────────────────────────────────────
// Backgrounds are translucent so the blueprint grid reads through a card the
// way it would through drafting film.
const COLORS = [
  { id: "cyan",   dot: "hsl(192 90% 58%)",  bg: "hsl(196 40% 8% / 0.86)",  border: "hsl(192 45% 30%)", glow: "hsl(192 95% 62%)", halo: "hsl(192 90% 55% / 0.28)", text: "hsl(192 60% 84%)" },
  { id: "violet", dot: "hsl(270 60% 58%)",  bg: "hsl(270 32% 9% / 0.86)",  border: "hsl(270 38% 32%)", glow: "hsl(270 80% 66%)", halo: "hsl(270 75% 55% / 0.28)", text: "hsl(270 55% 84%)" },
  { id: "rose",   dot: "hsl(340 60% 58%)",  bg: "hsl(340 32% 9% / 0.86)",  border: "hsl(340 38% 32%)", glow: "hsl(340 80% 66%)", halo: "hsl(340 75% 55% / 0.28)", text: "hsl(340 55% 84%)" },
  { id: "amber",  dot: "hsl(38 78% 55%)",   bg: "hsl(38 36% 8% / 0.86)",   border: "hsl(38 38% 30%)",  glow: "hsl(38 88% 62%)",  halo: "hsl(38 85% 52% / 0.28)",  text: "hsl(38 62% 82%)"  },
  { id: "teal",   dot: "hsl(160 55% 45%)",  bg: "hsl(165 34% 7% / 0.86)",  border: "hsl(163 36% 28%)", glow: "hsl(160 70% 55%)", halo: "hsl(160 65% 45% / 0.28)", text: "hsl(160 50% 80%)" },
  { id: "slate",  dot: "hsl(220 25% 58%)",  bg: "hsl(220 18% 9% / 0.86)",  border: "hsl(220 16% 30%)", glow: "hsl(220 40% 66%)", halo: "hsl(220 35% 55% / 0.24)", text: "hsl(220 22% 82%)" },
] as const;
type ColorId = typeof COLORS[number]["id"];
const colorFor = (id: string) => COLORS.find(c => c.id === id) ?? COLORS[0];

const ACCENT      = "hsl(192 100% 62%)";
const MIN_W       = 110;
const MIN_H       = 44;
const AUTO_MAX_W  = 320;
const SUB_MAX_W   = 230;
// Three limits, because they answer three different questions.
//   READ  — what will be opened from disk at all.
//   STORE — what may end up in a row and therefore in the body of every board
//           fetch. Also keeps the request under Vercel's 4.5MB body ceiling.
//   EDGE  — the longest side a still image is kept at. A 4K screenshot is
//           several megabytes of pixels nobody can see on a 320px card.
const IMAGE_READ_LIMIT  = 12 * 1024 * 1024;
const IMAGE_STORE_LIMIT = 3 * 1024 * 1024;
const IMAGE_MAX_EDGE    = 1600;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif"];
const ACCEPT      = ".png,.jpg,.jpeg,.gif,image/png,image/jpeg,image/gif";

// ── Failure reporting ──────────────────────────────────────────────────
// Every write here was fire-and-forget: a rejected insert rolled the optimistic
// update back and said nothing, so a schema the app had outgrown looked exactly
// like a dead button.
function describeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const body = raw.replace(/^\d+:\s*/, "");   // apiRequest throws `${status}: ${body}`
  let message = body;
  try {
    const parsed = JSON.parse(body);
    message = parsed?.message || parsed?.error || body;
  } catch { /* the server did not answer with JSON */ }

  // PostgREST says PGRST204 for a payload field with no column behind it, and
  // the whole point of naming the column is that the fix is one file away.
  const missing = /Could not find the '([\w]+)' column|column "?([\w.]+)"? does not exist/i.exec(message);
  if (missing) {
    const column = missing[1] || missing[2];
    return `Database is missing the "${column}" column — run script/sql/2026-08-idea-workshop-v2.sql in Supabase.`;
  }
  return message.length > 200 ? `${message.slice(0, 200)}…` : message;
}

// ── Fitted title ───────────────────────────────────────────────────────
// Measured rather than guessed: Zen Dots is wide and irregular enough that a
// characters-to-size formula is wrong by a factor of two on short names.
function FittedTitle({ text }: { text: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const el = textRef.current;
    if (!wrap || !el) return;
    const fit = () => {
      const available = wrap.clientWidth;
      if (!available) return;
      el.style.fontSize = "100px";
      const natural = el.scrollWidth;
      if (!natural) return;
      el.style.fontSize = `${Math.max(19, Math.min(58, (available / natural) * 100))}px`;
    };
    fit();
    // The first pass runs against the fallback face; the webfont lands later
    // and is a different width.
    document.fonts?.ready.then(fit).catch(() => {});
    const observer = new ResizeObserver(fit);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [text]);

  return (
    <div ref={wrapRef} className="min-w-0 flex-1 overflow-hidden">
      <span
        ref={textRef}
        className="font-industrial block whitespace-nowrap uppercase leading-none"
        style={{ color: ACCENT, textShadow: `0 0 22px ${ACCENT}55` }}
      >
        {text}
      </span>
    </div>
  );
}

// ── Card ───────────────────────────────────────────────────────────────
interface CardProps {
  card: IdeaCard;
  sub?: boolean;
  onUpdate: (id: number, patch: Partial<IdeaCard>) => void;
  onMenu: (card: IdeaCard, e: React.MouseEvent) => void;
  onLinkClick: (id: number) => void;
  onMeasure: (id: number, size: CardSize) => void;
  isLinking: boolean;
  isLinkTarget: boolean;
  boardRef: React.RefObject<HTMLDivElement>;
  children?: React.ReactNode;
}

function IdeaCardView({
  card, sub = false,
  onUpdate, onMenu, onLinkClick, onMeasure,
  isLinking, isLinkTarget, boardRef, children,
}: CardProps) {
  const [editing, setEditing] = useState(false);
  const [busy,    setBusy]    = useState(false);
  const [pos,     setPos]     = useState({ x: card.pos_x, y: card.pos_y });
  const [size,    setSize]    = useState({ w: card.width ?? 0, h: card.height ?? 0 });
  const [measured, setMeasured] = useState<CardSize>({ w: card.width || 160, h: card.height || 60 });

  const cardRef   = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const dragRef   = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);

  const col      = colorFor(card.color);
  const html     = useMemo(() => contentToHtml(card.content), [card.content]);
  const isImage  = card.kind === "image" && Boolean(card.src);
  const autoW    = !(size.w > 0);
  const autoH    = !(size.h > 0);

  useEffect(() => { setPos({ x: card.pos_x, y: card.pos_y }); }, [card.pos_x, card.pos_y]);
  useEffect(() => { setSize({ w: card.width ?? 0, h: card.height ?? 0 }); }, [card.width, card.height]);

  // Connections and sub-idea tethers both need a real box, and an auto-sized
  // card does not have one until it has been laid out.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const publish = () => {
      const next = { w: el.offsetWidth, h: el.offsetHeight };
      setMeasured(previous => (previous.w === next.w && previous.h === next.h ? previous : next));
      onMeasure(card.id, next);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => observer.disconnect();
  }, [card.id, onMeasure]);

  // ── Move ──
  const beginDrag = (cx: number, cy: number) => {
    dragRef.current = { sx: cx, sy: cy, ox: pos.x, oy: pos.y, moved: false };
    setBusy(true);
  };
  const resolveDrag = (cx: number, cy: number) => {
    const drag = dragRef.current;
    if (!drag) return null;
    const dx = cx - drag.sx;
    const dy = cy - drag.sy;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true;
    // A sub-idea's position is an offset from its parent, so it is free to sit
    // above or to the left of it; only canvas cards are clamped.
    if (sub) return { x: drag.ox + dx, y: drag.oy + dy };
    const bounds = boardRef.current?.getBoundingClientRect();
    const maxX = bounds ? Math.max(0, bounds.width - measured.w - 4) : Infinity;
    return { x: Math.max(0, Math.min(maxX, drag.ox + dx)), y: Math.max(0, drag.oy + dy) };
  };
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || editing || isLinking) return;
    if ((e.target as HTMLElement).closest(".idea-editor, .idea-nodrag")) return;
    e.preventDefault();
    e.stopPropagation();
    beginDrag(e.clientX, e.clientY);
    const move = (ev: MouseEvent) => { const next = resolveDrag(ev.clientX, ev.clientY); if (next) setPos(next); };
    const up = (ev: MouseEvent) => {
      const next = resolveDrag(ev.clientX, ev.clientY);
      const moved = dragRef.current?.moved ?? false;
      dragRef.current = null;
      setBusy(false);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      if (next && moved) { setPos(next); onUpdate(card.id, { pos_x: Math.round(next.x), pos_y: Math.round(next.y) }); }
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  // ── Resize ──
  const startResize = (corner: Corner, e: React.MouseEvent) => {
    e.preventDefault();
    setBusy(true);
    const base = { w: measured.w, h: measured.h };
    const start = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };
    let last = { w: base.w, h: base.h, x: pos.x, y: pos.y };
    const move = (ev: MouseEvent) => {
      const dx = ev.clientX - start.sx;
      const dy = ev.clientY - start.sy;
      let w = base.w, h = base.h, x = start.ox, y = start.oy;
      if (corner === "se") { w = Math.max(MIN_W, base.w + dx); h = Math.max(MIN_H, base.h + dy); }
      if (corner === "sw") { w = Math.max(MIN_W, base.w - dx); x = start.ox + (base.w - w); h = Math.max(MIN_H, base.h + dy); }
      if (corner === "ne") { w = Math.max(MIN_W, base.w + dx); h = Math.max(MIN_H, base.h - dy); y = start.oy + (base.h - h); }
      if (corner === "nw") { w = Math.max(MIN_W, base.w - dx); x = start.ox + (base.w - w); h = Math.max(MIN_H, base.h - dy); y = start.oy + (base.h - h); }
      if (!sub) { x = Math.max(0, x); y = Math.max(0, y); }
      last = { w, h, x, y };
      setSize({ w, h });
      setPos({ x, y });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setBusy(false);
      onUpdate(card.id, {
        width: Math.round(last.w), height: Math.round(last.h),
        pos_x: Math.round(last.x), pos_y: Math.round(last.y),
      });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  // ── Edit ──
  useEffect(() => {
    if (!editing) return;
    const el = editorRef.current;
    if (!el) return;
    el.innerHTML = contentToHtml(card.content);   // read once, then left alone
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    // Only on entry: re-running this on every content change is exactly the
    // caret-stealing bug this editor exists to avoid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const saveEdit = () => {
    const el = editorRef.current;
    setEditing(false);
    if (!el) return;
    const html = sanitizeHtml(el.innerHTML);
    const next = isBlankHtml(html) ? "" : html;
    if (next !== card.content) onUpdate(card.id, { content: next });
  };

  const bodyStyle: React.CSSProperties = { color: col.text, textAlign: alignOf(card) };

  const cardBox = (
    <div
      ref={cardRef}
      data-card-id={card.id}
      className={cn(
        "idea-card group flex flex-col",
        sub && "is-sub",
        (busy || editing) && "is-busy",
        editing && "is-editing",
        isLinking ? "cursor-crosshair" : !editing && "cursor-grab active:cursor-grabbing",
      )}
      style={{
        ...(sub ? { left: pos.x, top: pos.y } : {}),
        width:    autoW ? "max-content" : size.w,
        minWidth: sub ? 90 : 120,
        maxWidth: autoW ? (sub ? SUB_MAX_W : AUTO_MAX_W) : undefined,
        height:   autoH ? undefined : size.h,
        background: col.bg,
        ["--idea-accent" as string]: isLinkTarget ? col.glow : col.border,
        ["--idea-glow"   as string]: col.glow,
        ["--idea-halo"   as string]: col.halo,
        zIndex: editing ? 110 : sub ? 20 : 2,
        boxShadow: isLinkTarget ? `0 0 0 1px ${col.glow}, 0 0 22px ${col.halo}` : undefined,
      }}
      onMouseDown={onMouseDown}
      onClick={isLinking ? e => { e.stopPropagation(); onLinkClick(card.id); } : undefined}
      onDoubleClick={e => {
        if (isLinking || isImage) return;
        e.stopPropagation();
        setEditing(true);
      }}
      onContextMenu={e => { e.stopPropagation(); onMenu(card, e); }}
    >
      {!isLinking && !editing && <ResizeHandles onStart={startResize} color={col.border} />}
      {editing && <FormatBar accent={col.glow} />}

      {isImage ? (
        <img
          src={card.src ?? ""}
          alt=""
          draggable={false}
          className="block h-full w-full select-none"
          style={{ objectFit: autoH ? "contain" : "cover" }}
        />
      ) : editing ? (
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          data-placeholder="Write your idea…"
          className={cn("idea-editor idea-nodrag flex-1 px-2.5 py-2", sub ? "text-[11px] leading-snug" : "text-sm leading-relaxed")}
          style={bodyStyle}
          onBlur={saveEdit}
          onKeyDown={e => {
            e.stopPropagation();
            if (e.key === "Escape") { setEditing(false); return; }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveEdit(); }
          }}
        />
      ) : (
        <div
          className={cn("idea-content flex-1 px-2.5 py-2", sub ? "text-[11px] leading-snug" : "text-sm leading-relaxed")}
          style={{ ...bodyStyle, opacity: card.content ? 1 : 0.35 }}
          dangerouslySetInnerHTML={{ __html: html || "Double-click to write…" }}
        />
      )}

    </div>
  );

  // A sub-idea sits inside its parent's wrapper and has no cluster of its own.
  // A top-level card owns the wrapper, and the wrapper is what carries the
  // position — which is how dragging a parent moves every sub-idea with it
  // without a single child row being written.
  if (sub) return cardBox;

  return (
    <div className="idea-node" style={{ left: pos.x, top: pos.y, zIndex: editing ? 110 : 10 }}>
      {cardBox}
      {children}
    </div>
  );
}

// ── Connections ────────────────────────────────────────────────────────
function ConnectionLines({
  connections, cards, sizes, onDelete,
}: {
  connections: IdeaConnection[];
  cards: IdeaCard[];
  sizes: Map<number, CardSize>;
  onDelete: (id: number) => void;
}) {
  const cardMap = useMemo(() => new Map(cards.map(card => [card.id, card])), [cards]);
  const centre = (card: IdeaCard) => {
    const size = sizes.get(card.id) ?? { w: card.width || 180, h: card.height || 80 };
    return { x: card.pos_x + size.w / 2, y: card.pos_y + size.h / 2 };
  };

  return (
    <svg className="pointer-events-none absolute inset-0" style={{ width: "100%", height: "100%", overflow: "visible", zIndex: 5 }}>
      <defs>
        <marker id="arrow-idea" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 Z" fill={`${ACCENT}99`} />
        </marker>
      </defs>
      {connections.map(conn => {
        const from = cardMap.get(conn.from_id);
        const to   = cardMap.get(conn.to_id);
        if (!from || !to) return null;
        const a = centre(from);
        const b = centre(to);
        const cpx = (a.x + b.x) / 2 + (b.y - a.y) * 0.15;
        const cpy = (a.y + b.y) / 2 - (b.x - a.x) * 0.15;
        const path = `M${a.x},${a.y} Q${cpx},${cpy} ${b.x},${b.y}`;
        return (
          <g key={conn.id}>
            <path d={path} fill="none" stroke={`${ACCENT}55`} strokeWidth="1.4" strokeDasharray="5 3" markerEnd="url(#arrow-idea)" />
            <path
              d={path}
              fill="none"
              stroke="transparent"
              strokeWidth="12"
              style={{ cursor: "pointer", pointerEvents: "stroke" }}
              onClick={() => onDelete(conn.id)}
            />
            {conn.label && (
              <text x={cpx} y={cpy - 6} textAnchor="middle" fill={`${ACCENT}bb`} fontSize="10" fontFamily="DM Mono, monospace">
                {conn.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ── Sub-idea tethers ───────────────────────────────────────────────────
// Drawn in the wrapper rather than inside the parent card, so the card's hover
// scale cannot drag the lines away from the sub-ideas they point at.
function SubIdeaTethers({
  parent, subs, sizes,
}: {
  parent: IdeaCard;
  subs: IdeaCard[];
  sizes: Map<number, CardSize>;
}) {
  if (subs.length === 0) return null;
  const col = colorFor(parent.color);
  const parentSize = sizes.get(parent.id) ?? { w: 180, h: 80 };
  return (
    <svg
      className="pointer-events-none absolute left-0 top-0"
      style={{ width: parentSize.w, height: parentSize.h, overflow: "visible", zIndex: 1 }}
    >
      {subs.map(child => {
        const childSize = sizes.get(child.id) ?? { w: 120, h: 40 };
        return (
          <line
            key={child.id}
            x1={parentSize.w / 2}
            y1={parentSize.h / 2}
            x2={child.pos_x + childSize.w / 2}
            y2={child.pos_y + childSize.h / 2}
            stroke={col.glow}
            strokeWidth="1"
            strokeDasharray="3 3"
            opacity="0.45"
          />
        );
      })}
    </svg>
  );
}

// ── Context menu ───────────────────────────────────────────────────────
interface MenuState { card: IdeaCard; x: number; y: number }

function CardMenu({
  state, onClose, onColor, onAlign, onLink, onSubIdea, onReplaceImage, onDelete,
}: {
  state: MenuState;
  onClose: () => void;
  onColor: (color: ColorId) => void;
  onAlign: (align: Align) => void;
  onLink: () => void;
  onSubIdea: () => void;
  onReplaceImage: () => void;
  onDelete: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Capture phase, so a card that stops mousedown from bubbling cannot trap
    // the menu open — which means the menu has to exclude itself by hit test
    // rather than by relying on its own handler running first. It does not.
    const dismiss = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("mousedown", dismiss, true);
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("mousedown", dismiss, true); window.removeEventListener("keydown", escape); };
  }, [onClose]);

  const isImage = state.card.kind === "image";
  const isSub   = state.card.parent_id != null;
  const col     = colorFor(state.card.color);
  const align   = alignOf(state.card);

  const item = (label: string, Icon: typeof Link2, action: () => void, danger = false) => (
    <button
      onClick={() => { action(); onClose(); }}
      className={cn(
        "flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-mono text-[9px] uppercase tracking-[0.1em] transition-colors",
        danger ? "text-rose-400/70 hover:bg-rose-500/10 hover:text-rose-300" : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );

  return createPortal(
    <div
      ref={menuRef}
      // Position is clamped so a card near the right or bottom edge still gets
      // a whole menu.
      style={{
        position: "fixed",
        left: Math.min(state.x, window.innerWidth - 190),
        top:  Math.min(state.y, window.innerHeight - 190),
        zIndex: 400,
        background: "hsl(222 26% 6% / 0.97)",
        border: `1px solid ${col.border}`,
        backdropFilter: "blur(10px)",
        minWidth: 170,
      }}
      onMouseDown={e => e.stopPropagation()}
      onContextMenu={e => e.preventDefault()}
    >
      <div className="flex items-center gap-1.5 border-b px-2.5 py-2" style={{ borderColor: `${col.border}` }}>
        {COLORS.map(colour => (
          <button
            key={colour.id}
            onClick={() => { onColor(colour.id); onClose(); }}
            className={cn(
              "h-3.5 w-3.5 border border-black/40 transition-transform hover:scale-125",
              state.card.color === colour.id && "ring-1 ring-white/50",
            )}
            style={{ background: colour.dot }}
            title={colour.id}
          />
        ))}
      </div>
      {/* Alignment is a property of the card, not of a selection, which is why
          it lives here rather than in the format bar. */}
      {!isImage && (
        <div className="flex items-center gap-1 border-b px-2.5 py-1.5" style={{ borderColor: col.border }}>
          {([["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight]] as const).map(([value, Icon]) => (
            <button
              key={value}
              onClick={() => { onAlign(value); onClose(); }}
              className={cn(
                "p-1 transition-colors",
                align === value ? "text-foreground" : "text-muted-foreground/50 hover:text-foreground",
              )}
              style={align === value ? { background: `${col.border}55` } : undefined}
              title={`Align ${value}`}
            >
              <Icon className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}
      {!isSub && item("Link to…", Link2, onLink)}
      {!isSub && item("Add sub-idea", CornerDownRight, onSubIdea)}
      {isImage && item("Replace image", Repeat2, onReplaceImage)}
      {item(isSub ? "Delete sub-idea" : "Delete", Trash2, onDelete, true)}
    </div>,
    document.body,
  );
}

// ── Workshop ───────────────────────────────────────────────────────────
function WorkshopView({ board }: { board: Board }) {
  const qc = useQueryClient();
  const boardRef  = useRef<HTMLDivElement>(null);
  const fileRef   = useRef<HTMLInputElement>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const replaceRef = useRef<number | null>(null);
  const sizesRef  = useRef<Map<number, CardSize>>(new Map());
  const [sizeTick, setSizeTick] = useState(0);
  const rafRef    = useRef<number | null>(null);

  const [linkSource, setLinkSource] = useState<number | null>(null);
  const [menu,       setMenu]       = useState<MenuState | null>(null);
  const [notice,     setNotice]     = useState<string | null>(null);

  // Long enough to read a sentence naming a file to run.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 9000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const cardQKey = ["/boards", board.id, "ideas"];
  const connQKey = ["/boards", board.id, "idea-connections"];

  const { data: cards = [], isLoading } = useQuery<IdeaCard[]>({
    queryKey: cardQKey,
    queryFn: () => apiRequest("GET", `/api/boards/${board.id}/ideas`).then(r => r.json()),
  });
  const { data: connections = [] } = useQuery<IdeaConnection[]>({
    queryKey: connQKey,
    queryFn: () => apiRequest("GET", `/api/boards/${board.id}/idea-connections`).then(r => r.json()),
  });

  const invalidateCards = () => qc.invalidateQueries({ queryKey: cardQKey });
  const invalidateConns = () => qc.invalidateQueries({ queryKey: connQKey });

  const createCard = useMutation({
    mutationFn: (body: object) => apiRequest("POST", `/api/boards/${board.id}/ideas`, body).then(r => r.json()),
    onSuccess: invalidateCards,
    onError: (error) => setNotice(describeError(error)),
  });

  const updateCard = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: object }) => apiRequest("PATCH", `/api/ideas/${id}`, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: cardQKey });
      const prev = qc.getQueryData<IdeaCard[]>(cardQKey);
      qc.setQueryData<IdeaCard[]>(cardQKey, old => (old ?? []).map(c => (c.id === id ? { ...c, ...patch as IdeaCard } : c)));
      return { prev };
    },
    onError: (error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(cardQKey, ctx.prev);
      setNotice(describeError(error));
    },
    onSettled: invalidateCards,
  });

  const deleteCard = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/ideas/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: cardQKey });
      const prev = qc.getQueryData<IdeaCard[]>(cardQKey);
      // Sub-ideas go with their parent on the server; mirror that optimistically
      // or the children flash at the canvas origin before the refetch lands.
      qc.setQueryData<IdeaCard[]>(cardQKey, old => (old ?? []).filter(c => c.id !== id && c.parent_id !== id));
      return { prev };
    },
    onError: (error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(cardQKey, ctx.prev);
      setNotice(describeError(error));
    },
    onSettled: invalidateCards,
  });

  const createConn = useMutation({
    mutationFn: (body: object) => apiRequest("POST", `/api/boards/${board.id}/idea-connections`, body).then(r => r.json()),
    onSuccess: invalidateConns,
    onError: (error) => setNotice(describeError(error)),
  });

  const deleteConn = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/idea-connections/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: connQKey });
      const prev = qc.getQueryData<IdeaConnection[]>(connQKey);
      qc.setQueryData<IdeaConnection[]>(connQKey, old => (old ?? []).filter(c => c.id !== id));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(connQKey, ctx.prev); },
    onSettled: invalidateConns,
  });

  // Measurements arrive one card at a time during layout; coalescing them into
  // a single frame keeps a fifty-card board from re-rendering fifty times.
  const handleMeasure = useCallback((id: number, size: CardSize) => {
    const current = sizesRef.current.get(id);
    if (current && current.w === size.w && current.h === size.h) return;
    sizesRef.current.set(id, size);
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setSizeTick(value => value + 1);
    });
  }, []);
  useEffect(() => () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); }, []);

  const topCards = useMemo(() => cards.filter(c => c.parent_id == null), [cards]);
  const childrenOf = useMemo(() => {
    const map = new Map<number, IdeaCard[]>();
    cards.forEach(card => {
      if (card.parent_id == null) return;
      const list = map.get(card.parent_id);
      if (list) list.push(card);
      else map.set(card.parent_id, [card]);
    });
    return map;
  }, [cards]);

  const handleUpdate = useCallback((id: number, patch: Partial<IdeaCard>) => {
    updateCard.mutate({ id, patch });
  }, [updateCard]);

  // ── Placement ──
  // A new card lands where the pointer last was on the canvas, which is where
  // you were looking when you pressed the shortcut. Falling back to a cascade
  // keeps cards from stacking when the pointer is elsewhere.
  const nextSpot = () => {
    const point = pointerRef.current;
    if (point) return { x: Math.max(0, Math.round(point.x - 70)), y: Math.max(0, Math.round(point.y - 24)) };
    const step = (topCards.length % 6) * 30;
    return { x: 70 + step, y: 70 + step };
  };

  const addIdea = useCallback(() => {
    const spot = nextSpot();
    const color = COLORS[topCards.length % COLORS.length].id;
    createCard.mutate({ content: "", color, pos_x: spot.x, pos_y: spot.y, width: 0, height: 0, kind: "text", align: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createCard, topCards.length]);

  const addSubIdea = (parent: IdeaCard) => {
    const parentSize = sizesRef.current.get(parent.id) ?? { w: 180, h: 80 };
    const existing = childrenOf.get(parent.id)?.length ?? 0;
    createCard.mutate({
      content: "", color: parent.color, kind: "text", align: "center",
      parent_id: parent.id,
      pos_x: Math.round(parentSize.w + 34),
      pos_y: Math.round(existing * 46),
      width: 0, height: 0,
    });
  };

  // ── Images ──
  const megabytes = (bytes: number) => `${(bytes / 1048576).toFixed(1)}MB`;

  const readImage = (file: File) => new Promise<{ src: string; width: number }>((resolve, reject) => {
    if (!IMAGE_TYPES.includes(file.type)) { reject(new Error(`${file.name}: only PNG, JPG and GIF are supported.`)); return; }
    if (file.size > IMAGE_READ_LIMIT)     { reject(new Error(`${file.name} is ${megabytes(file.size)} — too large to open.`)); return; }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`${file.name} could not be read.`));
    reader.onload = () => {
      const original = String(reader.result);
      const probe = new Image();
      probe.onerror = () => reject(new Error(`${file.name} is not a readable image.`));
      probe.onload = () => {
        // A GIF is never re-encoded: a canvas keeps one frame, and an animation
        // silently reduced to a still is worse than a refusal.
        const animated = file.type === "image/gif";
        const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(probe.naturalWidth, probe.naturalHeight));
        let src = original;

        if (!animated && (scale < 1 || original.length > IMAGE_STORE_LIMIT)) {
          const canvas = document.createElement("canvas");
          canvas.width  = Math.max(1, Math.round(probe.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(probe.naturalHeight * scale));
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(probe, 0, 0, canvas.width, canvas.height);
            // Same mime out as in, so a PNG keeps its transparency rather than
            // gaining a black background on the way through JPEG.
            const shrunk = canvas.toDataURL(file.type, 0.9);
            if (shrunk.length < src.length) src = shrunk;
          }
        }

        if (src.length > IMAGE_STORE_LIMIT) {
          reject(new Error(
            animated
              ? `${file.name} is ${megabytes(src.length)} — animated GIFs cannot be shrunk, and the limit is 3MB.`
              : `${file.name} is still ${megabytes(src.length)} after resizing — the limit is 3MB.`,
          ));
          return;
        }

        // Natural width decides the starting size: a 64px icon and a screenshot
        // should not both open at the same box.
        const naturalWidth = scale < 1 && src !== original ? probe.naturalWidth * scale : probe.naturalWidth;
        resolve({ src, width: Math.max(MIN_W, Math.min(360, Math.round(naturalWidth))) });
      };
      probe.src = original;
    };
    reader.readAsDataURL(file);
  });

  const addImages = useCallback(async (files: File[]) => {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      try {
        const { src, width } = await readImage(file);
        const target = replaceRef.current;
        if (target != null) {
          replaceRef.current = null;
          handleUpdate(target, { src, kind: "image" });
        } else {
          const spot = nextSpot();
          const stagger = index * 26;
          createCard.mutate({ content: "", color: "slate", pos_x: spot.x + stagger, pos_y: spot.y + stagger, width, height: 0, kind: "image", src });
        }
      } catch (error) {
        replaceRef.current = null;
        setNotice(error instanceof Error ? error.message : "That image could not be added.");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createCard, handleUpdate, topCards.length]);

  const pickImage = useCallback((replaceId?: number) => {
    replaceRef.current = replaceId ?? null;
    fileRef.current?.click();
  }, []);

  // ── Shortcuts ──
  // Skipped while a card editor has focus: in there Cmd+B/I/U are the browser's
  // own formatting commands, which is exactly what those keys should do.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const active = document.activeElement as HTMLElement | null;
      if (active?.closest(".idea-editor") || active?.tagName === "INPUT" || active?.tagName === "TEXTAREA") return;
      const key = e.key.toLowerCase();
      if (key === "t") { e.preventDefault(); addIdea(); }
      if (key === "i") { e.preventDefault(); pickImage(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addIdea, pickImage]);

  // Pasting an image is the fastest path there is, and it costs one handler.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      if (active?.closest(".idea-editor")) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter(f => IMAGE_TYPES.includes(f.type));
      if (files.length === 0) return;
      e.preventDefault();
      void addImages(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addImages]);

  const handleLinkClick = useCallback((id: number) => {
    if (linkSource === null) { setLinkSource(id); return; }
    if (linkSource === id)   { setLinkSource(null); return; }
    const exists = connections.some(
      c => (c.from_id === linkSource && c.to_id === id) || (c.from_id === id && c.to_id === linkSource),
    );
    if (!exists) createConn.mutate({ from_id: linkSource, to_id: id, label: "" });
    setLinkSource(null);
  }, [linkSource, connections, createConn]);

  const canvasMinH = Math.max(
    560,
    ...topCards.map(card => card.pos_y + (sizesRef.current.get(card.id)?.h ?? 120) + 160),
  );
  void sizeTick;

  if (isLoading) return (
    <div className="flex h-48 items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin opacity-50" style={{ color: ACCENT }} />
    </div>
  );

  const toolButton = "flex items-center gap-1.5 border px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.12em] transition-colors";

  return (
    <div className="flex h-full flex-col gap-3 p-5">
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={e => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";     // re-picking the same file must fire again
          void addImages(files);
        }}
      />

      {/* Header — the board's name fills the space it is given. */}
      <div className="flex shrink-0 items-end gap-4">
        <FittedTitle text={board.title} />
        <div className="flex shrink-0 items-center gap-2 pb-1">
          {linkSource !== null && (
            <button
              onClick={() => setLinkSource(null)}
              className={toolButton}
              style={{ borderColor: `${ACCENT}55`, color: ACCENT }}
            >
              <Link2Off className="h-3 w-3" />
              Cancel link
            </button>
          )}
          <button
            onClick={addIdea}
            disabled={createCard.isPending}
            className={toolButton}
            style={{ borderColor: `${ACCENT}40`, color: ACCENT }}
            title="New idea (⌘T)"
          >
            {createCard.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            Idea <span className="opacity-40">⌘T</span>
          </button>
          <button
            onClick={() => pickImage()}
            className={cn(toolButton, "text-muted-foreground hover:text-foreground")}
            style={{ borderColor: "hsl(220 15% 20%)" }}
            title="Add image (⌘I)"
          >
            <ImageIcon className="h-3 w-3" />
            Image <span className="opacity-40">⌘I</span>
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={boardRef}
        className="idea-canvas flex-1"
        style={{ minHeight: canvasMinH, cursor: linkSource !== null ? "crosshair" : "default" }}
        onMouseMove={e => {
          const bounds = boardRef.current?.getBoundingClientRect();
          if (bounds) pointerRef.current = { x: e.clientX - bounds.left, y: e.clientY - bounds.top };
        }}
        onMouseLeave={() => { pointerRef.current = null; }}
        onDragOver={e => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
        onDrop={e => {
          const files = Array.from(e.dataTransfer.files ?? []).filter(f => IMAGE_TYPES.includes(f.type));
          if (files.length === 0) return;
          e.preventDefault();
          const bounds = boardRef.current?.getBoundingClientRect();
          if (bounds) pointerRef.current = { x: e.clientX - bounds.left, y: e.clientY - bounds.top };
          void addImages(files);
        }}
        onClick={() => { if (linkSource !== null) setLinkSource(null); }}
      >
        <div className="idea-canvas-grid" />

        <ConnectionLines connections={connections} cards={topCards} sizes={sizesRef.current} onDelete={id => deleteConn.mutate(id)} />

        {linkSource !== null && (
          <div
            className="absolute left-1/2 top-3 z-30 -translate-x-1/2 border px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.12em]"
            style={{ background: "hsl(222 26% 6% / 0.9)", borderColor: `${ACCENT}55`, color: ACCENT }}
          >
            <Link2 className="mr-1.5 inline h-3 w-3" />
            Click another card to connect · click the table to cancel
          </div>
        )}

        {notice && (
          <div
            className="absolute left-1/2 top-3 z-30 -translate-x-1/2 border px-3 py-1.5 font-mono text-[9px] tracking-wide text-rose-300"
            style={{ background: "hsl(222 26% 6% / 0.92)", borderColor: "hsl(350 50% 40%)" }}
          >
            {notice}
          </div>
        )}

        {cards.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <Lightbulb className="h-10 w-10 opacity-10" />
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-40">⌘T for an idea · ⌘I for an image</p>
          </div>
        )}

        {topCards.map(card => (
          <IdeaCardView
            key={card.id}
            card={card}
            onUpdate={handleUpdate}
            onMenu={(target, e) => setMenu({ card: target, x: e.clientX, y: e.clientY })}
            onLinkClick={handleLinkClick}
            onMeasure={handleMeasure}
            isLinking={linkSource !== null}
            isLinkTarget={linkSource !== null && linkSource !== card.id}
            boardRef={boardRef}
          >
            <SubIdeaTethers parent={card} subs={childrenOf.get(card.id) ?? []} sizes={sizesRef.current} />
            {(childrenOf.get(card.id) ?? []).map(child => (
              <IdeaCardView
                key={child.id}
                card={child}
                sub
                onUpdate={handleUpdate}
                onMenu={(target, e) => setMenu({ card: target, x: e.clientX, y: e.clientY })}
                onLinkClick={handleLinkClick}
                onMeasure={handleMeasure}
                isLinking={false}
                isLinkTarget={false}
                boardRef={boardRef}
              />
            ))}
          </IdeaCardView>
        ))}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-4 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground opacity-45">
        <span>Hold-drag to move</span>
        <span>Double-click to write</span>
        <span>Right-click for colour, links, sub-ideas</span>
        <span>Corners resize</span>
        <span>Drop or paste an image</span>
      </div>

      {menu && (
        <CardMenu
          state={menu}
          onClose={() => setMenu(null)}
          onColor={color => handleUpdate(menu.card.id, { color })}
          onAlign={align => handleUpdate(menu.card.id, { align })}
          onLink={() => setLinkSource(menu.card.id)}
          onSubIdea={() => addSubIdea(menu.card)}
          onReplaceImage={() => pickImage(menu.card.id)}
          onDelete={() => deleteCard.mutate(menu.card.id)}
        />
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────
export default function IdeaWorkshop() {
  return (
    <BoardShell type="idea_workshop" label="Workshop" emptyIcon={<Lightbulb className="h-16 w-16" />}>
      {board => <WorkshopView key={board.id} board={board} />}
    </BoardShell>
  );
}
