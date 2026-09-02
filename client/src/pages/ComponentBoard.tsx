/**
 * ComponentBoard — the investigative caseboard.
 *
 * The cards behave exactly as the Idea Workshop's do, because they are the same
 * gesture: no permanent chrome, hold-drag to move, double-click to edit rich
 * text in place, corners to pin a size, right-click for everything else. What
 * differs is what a card *is* — this board has kinds that mean something (fact,
 * theory, conclusion, concept), evidence captured out of a document, notes
 * stuck to a card, venn items, and lines that carry a named relationship.
 *
 * Shared with the Workshop, in one place rather than two: `lib/cardText` for
 * the sanitiser, `components/CardChrome` for the format bar and the resize
 * corners, and the `.idea-card` styles, which are driven entirely by the
 * `--idea-accent` / `--idea-glow` / `--idea-halo` custom properties this board
 * sets from its own palette.
 *
 * Four decisions worth knowing before changing anything here.
 *
 * **A card is measured, not assumed.** An auto-sized card has no width until it
 * has been laid out, so the relationship lines read a `ResizeObserver` map
 * rather than the stored columns — which are 0 for a card that sizes itself.
 *
 * **A sticky note lives inside its card's wrapper.** It stores which card it is
 * attached to and an offset, and both sit in one positioned element, so moving
 * a card moves its notes without a single child row being written.
 *
 * **A capture is a card whose face is an image.** The Analysis State cuts a
 * region out of a document and posts it here with whatever was typed about it,
 * so evidence arrives from the Forge already framed. The annotation under it is
 * ordinary card text and edits like any other.
 *
 * **A venn item keeps its structure in `data`.** Its labels are not prose and
 * squeezing them into `content` would mean parsing them back out.
 *
 * The last three need the columns added by
 * `script/sql/2026-09-forge-analysis-state.sql`. Everything renders without
 * them; nothing new persists until it has run.
 */

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  Trash2, Link2, Link2Off, Loader2, Eye, Check, X,
  MapPin, User2, FileSearch, StickyNote, Image as ImageIcon, CircleDashed,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import BoardShell, { type Board } from "@/components/BoardShell";
import { contentToHtml, isBlankHtml, sanitizeHtml } from "@/lib/cardText";
import { FormatBar, ResizeHandles, type Corner } from "@/components/CardChrome";

// ── Types ──────────────────────────────────────────────────────────────
type PinType = "fact" | "theory" | "conclusion" | "concept" | "capture" | "note" | "venn";
type ThreadColor = "red" | "amber" | "blue" | "green";

/** A venn item's sets and what sits where they meet. Two or three circles. */
interface VennData {
  sets: string[];
  overlap: string;
}

interface Pin {
  id: number;
  content: string;
  pin_type: PinType;
  pos_x: number;
  pos_y: number;
  /** 0 means "size to content", as in the Idea Workshop. */
  width: number;
  height: number;
  color: string;
  /** A capture from the Analysis State: a data URL, and where it came from. */
  image?: string | null;
  source_label?: string | null;
  /** Set on a sticky note: the card it belongs to, and its offset from it. */
  attached_to?: number | null;
  offset_x?: number | null;
  offset_y?: number | null;
  data?: VennData | null;
}

interface Thread {
  id: number;
  from_id: number;
  to_id: number;
  label: string;
  color: ThreadColor;
}

interface CardSize { w: number; h: number }

// ── Palette ────────────────────────────────────────────────────────────
// Backgrounds are translucent so the cork grain reads through a card.
interface PinStyle {
  label: string;
  icon: React.ReactNode;
  dot: string;
  bg: string;
  border: string;
  glow: string;
  halo: string;
  text: string;
}

const PIN_TYPES: Record<PinType, PinStyle> = {
  fact: {
    label: "Fact", icon: <FileSearch className="h-3 w-3" />,
    dot: "hsl(38 78% 55%)", bg: "hsl(38 34% 8% / 0.88)", border: "hsl(38 38% 30%)",
    glow: "hsl(38 88% 62%)", halo: "hsl(38 85% 52% / 0.28)", text: "hsl(38 62% 82%)",
  },
  theory: {
    label: "Theory", icon: <User2 className="h-3 w-3" />,
    dot: "hsl(270 60% 58%)", bg: "hsl(270 32% 9% / 0.88)", border: "hsl(270 38% 32%)",
    glow: "hsl(270 80% 66%)", halo: "hsl(270 75% 55% / 0.28)", text: "hsl(270 55% 84%)",
  },
  conclusion: {
    label: "Conclusion", icon: <MapPin className="h-3 w-3" />,
    dot: "hsl(175 55% 45%)", bg: "hsl(168 32% 7% / 0.88)", border: "hsl(172 36% 28%)",
    glow: "hsl(172 70% 55%)", halo: "hsl(172 65% 45% / 0.28)", text: "hsl(172 52% 80%)",
  },
  concept: {
    label: "Concept", icon: <StickyNote className="h-3 w-3" />,
    dot: "hsl(210 60% 55%)", bg: "hsl(210 32% 8% / 0.88)", border: "hsl(210 38% 30%)",
    glow: "hsl(210 78% 66%)", halo: "hsl(210 70% 55% / 0.28)", text: "hsl(210 58% 82%)",
  },
  capture: {
    label: "Capture", icon: <ImageIcon className="h-3 w-3" />,
    dot: "hsl(190 65% 55%)", bg: "hsl(190 30% 7% / 0.88)", border: "hsl(190 40% 28%)",
    glow: "hsl(190 80% 62%)", halo: "hsl(190 75% 50% / 0.28)", text: "hsl(190 55% 80%)",
  },
  venn: {
    label: "Venn", icon: <CircleDashed className="h-3 w-3" />,
    dot: "hsl(300 55% 60%)", bg: "hsl(300 26% 8% / 0.88)", border: "hsl(300 34% 30%)",
    glow: "hsl(300 70% 66%)", halo: "hsl(300 65% 52% / 0.26)", text: "hsl(300 52% 82%)",
  },
  note: {
    label: "Note", icon: <StickyNote className="h-3 w-3" />,
    dot: "hsl(48 80% 60%)", bg: "hsl(48 52% 13% / 0.94)", border: "hsl(48 50% 32%)",
    glow: "hsl(48 88% 66%)", halo: "hsl(48 85% 55% / 0.26)", text: "hsl(48 78% 82%)",
  },
};

/** The kinds you can put on the board directly, and cycle between. */
const CARD_TYPES: PinType[] = ["fact", "theory", "conclusion", "concept"];

const THREAD_COLORS: Record<ThreadColor, { stroke: string; label: string }> = {
  red:   { stroke: "hsl(0 70% 55%)",   label: "Red" },
  amber: { stroke: "hsl(38 80% 58%)",  label: "Amber" },
  blue:  { stroke: "hsl(205 75% 58%)", label: "Blue" },
  green: { stroke: "hsl(150 55% 48%)", label: "Green" },
};

const MIN_W = 130;
const MIN_H = 56;
const AUTO_MAX_W = 300;
const NOTE_MAX_W = 190;
const DEFAULT_VENN: VennData = { sets: ["A", "B"], overlap: "" };

const styleOf = (pin: Pin): PinStyle => PIN_TYPES[pin.pin_type] ?? PIN_TYPES.fact;

function vennOf(pin: Pin): VennData {
  const data = pin.data;
  if (!data || !Array.isArray(data.sets) || data.sets.length < 2) return DEFAULT_VENN;
  return { sets: data.sets.slice(0, 3).map(String), overlap: String(data.overlap ?? "") };
}

// ── Card ───────────────────────────────────────────────────────────────
interface CardProps {
  pin: Pin;
  /** A sticky note: positioned inside its card's wrapper, not on the board. */
  note?: boolean;
  onUpdate: (id: number, patch: Partial<Pin>) => void;
  onMenu: (pin: Pin, e: React.MouseEvent) => void;
  onLinkClick: (id: number) => void;
  onMeasure: (id: number, size: CardSize) => void;
  isLinking: boolean;
  isLinkTarget: boolean;
  boardRef: React.RefObject<HTMLDivElement>;
  children?: React.ReactNode;
}

function CaseCardView({
  pin, note = false,
  onUpdate, onMenu, onLinkClick, onMeasure,
  isLinking, isLinkTarget, boardRef, children,
}: CardProps) {
  const [editing, setEditing] = useState(false);
  const [busy,    setBusy]    = useState(false);
  const [pos,     setPos]     = useState({ x: pin.pos_x, y: pin.pos_y });
  const [size,    setSize]    = useState({ w: pin.width ?? 0, h: pin.height ?? 0 });

  const cardRef   = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const dragRef   = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const resizeRef = useRef<{ sx: number; sy: number; ow: number; oh: number; ox: number; oy: number; corner: Corner } | null>(null);

  const conf    = styleOf(pin);
  const html    = useMemo(() => contentToHtml(pin.content), [pin.content]);
  const isImage = pin.pin_type === "capture" && Boolean(pin.image);
  const isVenn  = pin.pin_type === "venn";
  const autoW   = !(size.w > 0);
  const autoH   = !(size.h > 0);

  // A note's position is an offset from its card; every other card's is the
  // board. Both arrive in the same two fields as far as this component knows.
  const originX = note ? (pin.offset_x ?? 0) : pin.pos_x;
  const originY = note ? (pin.offset_y ?? 0) : pin.pos_y;
  useEffect(() => { setPos({ x: originX, y: originY }); }, [originX, originY]);
  useEffect(() => { setSize({ w: pin.width ?? 0, h: pin.height ?? 0 }); }, [pin.width, pin.height]);

  // Relationship lines need a real box, and an auto-sized card does not have
  // one until it has been laid out.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const publish = () => onMeasure(pin.id, { w: el.offsetWidth, h: el.offsetHeight });
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => observer.disconnect();
  }, [pin.id, onMeasure]);

  // ── Move ──
  const beginDrag = (cx: number, cy: number) => {
    dragRef.current = { sx: cx, sy: cy, ox: pos.x, oy: pos.y, moved: false };
    setBusy(true);
  };
  const moveDrag = (cx: number, cy: number) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = cx - drag.sx;
    const dy = cy - drag.sy;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    // A note may sit to the left of its card; the board itself may not.
    setPos({ x: note ? drag.ox + dx : Math.max(0, drag.ox + dx), y: note ? drag.oy + dy : Math.max(0, drag.oy + dy) });
  };
  const endDrag = (cx: number, cy: number) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setBusy(false);
    if (!drag || !drag.moved) return;
    const x = note ? drag.ox + cx - drag.sx : Math.max(0, drag.ox + cx - drag.sx);
    const y = note ? drag.oy + cy - drag.sy : Math.max(0, drag.oy + cy - drag.sy);
    onUpdate(pin.id, note ? { offset_x: x, offset_y: y } : { pos_x: x, pos_y: y });
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || editing || isLinking) return;
    // Anything marked no-drag is a control inside the card — a venn label, an
    // input — and dragging from it would make it impossible to click into.
    if ((e.target as HTMLElement).closest(".case-nodrag")) return;
    e.preventDefault();
    e.stopPropagation();
    beginDrag(e.clientX, e.clientY);
    const move = (ev: MouseEvent) => moveDrag(ev.clientX, ev.clientY);
    const up = (ev: MouseEvent) => {
      endDrag(ev.clientX, ev.clientY);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (editing || isLinking) return;
    if ((e.target as HTMLElement).closest(".case-nodrag")) return;
    beginDrag(e.touches[0].clientX, e.touches[0].clientY);
    const move = (ev: TouchEvent) => { if (!dragRef.current) return; ev.preventDefault(); moveDrag(ev.touches[0].clientX, ev.touches[0].clientY); };
    const end = (ev: TouchEvent) => {
      endDrag(ev.changedTouches[0].clientX, ev.changedTouches[0].clientY);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
    };
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", end);
  };

  // ── Resize ──
  const startResize = (corner: Corner, e: React.MouseEvent) => {
    e.preventDefault();
    const el = cardRef.current;
    resizeRef.current = {
      sx: e.clientX, sy: e.clientY,
      ow: size.w || el?.offsetWidth || MIN_W,
      oh: size.h || el?.offsetHeight || MIN_H,
      ox: pos.x, oy: pos.y, corner,
    };
    setBusy(true);
    const move = (ev: MouseEvent) => {
      const state = resizeRef.current;
      if (!state) return;
      const dx = ev.clientX - state.sx;
      const dy = ev.clientY - state.sy;
      let w = state.ow, h = state.oh, x = state.ox, y = state.oy;
      if (state.corner === "se") { w = Math.max(MIN_W, state.ow + dx); h = Math.max(MIN_H, state.oh + dy); }
      if (state.corner === "sw") { const nw = Math.max(MIN_W, state.ow - dx); x = state.ox + (state.ow - nw); w = nw; h = Math.max(MIN_H, state.oh + dy); }
      if (state.corner === "ne") { w = Math.max(MIN_W, state.ow + dx); const nh = Math.max(MIN_H, state.oh - dy); y = state.oy + (state.oh - nh); h = nh; }
      if (state.corner === "nw") { const nw = Math.max(MIN_W, state.ow - dx); x = state.ox + (state.ow - nw); w = nw; const nh = Math.max(MIN_H, state.oh - dy); y = state.oy + (state.oh - nh); h = nh; }
      setSize({ w, h });
      setPos({ x: note ? x : Math.max(0, x), y: note ? y : Math.max(0, y) });
    };
    const up = () => {
      const state = resizeRef.current;
      resizeRef.current = null;
      setBusy(false);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      if (!state) return;
      setSize(s => { setPos(p => {
        onUpdate(pin.id, note
          ? { width: s.w, height: s.h, offset_x: p.x, offset_y: p.y }
          : { width: s.w, height: s.h, pos_x: p.x, pos_y: p.y });
        return p;
      }); return s; });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  // ── Edit ──
  useEffect(() => {
    if (!editing) return;
    const el = editorRef.current;
    if (!el) return;
    el.innerHTML = contentToHtml(pin.content);   // read once, then left alone
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    // Only on entry: re-running this on every content change is exactly the
    // caret-stealing bug a contenteditable exists to avoid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const saveEdit = () => {
    const el = editorRef.current;
    setEditing(false);
    if (!el) return;
    const clean = sanitizeHtml(el.innerHTML);
    const next = isBlankHtml(clean) ? "" : clean;
    if (next !== pin.content) onUpdate(pin.id, { content: next });
  };

  const placeholder = isImage ? "Double-click to annotate…" : note ? "Note…" : "Double-click to write…";

  const cardBox = (
    <div
      ref={cardRef}
      data-pin-id={pin.id}
      className={cn(
        "idea-card group flex flex-col",
        note && "is-sub",
        (busy || editing) && "is-busy",
        editing && "is-editing",
        isLinking ? "cursor-crosshair" : !editing && "cursor-grab active:cursor-grabbing",
      )}
      style={{
        ...(note ? { left: pos.x, top: pos.y } : {}),
        width:    autoW ? "max-content" : size.w,
        minWidth: note ? 110 : 140,
        maxWidth: autoW ? (note ? NOTE_MAX_W : AUTO_MAX_W) : undefined,
        height:   autoH ? undefined : size.h,
        background: conf.bg,
        ["--idea-accent" as string]: isLinkTarget ? conf.glow : conf.border,
        ["--idea-glow"   as string]: conf.glow,
        ["--idea-halo"   as string]: conf.halo,
        transform: note ? "rotate(-1.1deg)" : undefined,
        zIndex: editing ? 110 : note ? 20 : 2,
        boxShadow: isLinkTarget ? `0 0 0 1px ${conf.glow}, 0 0 22px ${conf.halo}` : undefined,
      }}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      onClick={isLinking ? e => { e.stopPropagation(); onLinkClick(pin.id); } : undefined}
      onDoubleClick={e => {
        if (isLinking || isVenn) return;
        e.stopPropagation();
        setEditing(true);
      }}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onMenu(pin, e); }}
    >
      {!isLinking && !editing && <ResizeHandles onStart={startResize} color={conf.border} />}
      {editing && <FormatBar accent={conf.glow} />}

      {/* The kind is the identity of a card on this board, so it is always on
          screen rather than hidden in the menu the way a colour is. */}
      <div className="flex items-center gap-1 px-2 pt-1.5" style={{ color: conf.text, opacity: 0.6 }}>
        {conf.icon}
        <span className="font-mono text-[8px] uppercase tracking-[0.18em]">{conf.label}</span>
      </div>

      {isImage && (
        <img
          src={pin.image ?? ""}
          alt={pin.source_label ?? "Capture"}
          draggable={false}
          className="mt-1 block w-full select-none"
          style={{ objectFit: autoH ? "contain" : "cover", maxHeight: autoH ? 420 : undefined }}
        />
      )}

      {isVenn ? (
        <VennFigure pin={pin} conf={conf} onUpdate={onUpdate} />
      ) : editing ? (
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          data-placeholder={placeholder}
          className={cn("idea-editor case-nodrag flex-1 px-2.5 pb-2 pt-1", note ? "text-[11px] leading-snug" : "text-sm leading-relaxed")}
          style={{ color: conf.text }}
          onBlur={saveEdit}
          onKeyDown={e => {
            e.stopPropagation();
            if (e.key === "Escape") { setEditing(false); return; }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveEdit(); }
          }}
        />
      ) : (
        <div
          className={cn("idea-content flex-1 px-2.5 pb-2 pt-1", note ? "text-[11px] leading-snug" : "text-sm leading-relaxed")}
          style={{ color: conf.text, opacity: pin.content ? 1 : 0.35 }}
          dangerouslySetInnerHTML={{ __html: html || placeholder }}
        />
      )}

      {pin.source_label && (
        <p className="px-2.5 pb-1.5 font-mono text-[8px] tracking-wide" style={{ color: conf.text, opacity: 0.4 }}>
          {pin.source_label}
        </p>
      )}
    </div>
  );

  // A note sits inside its card's wrapper and has no cluster of its own. A card
  // owns the wrapper, and the wrapper carries the position — which is how
  // dragging a card moves every note stuck to it without writing a child row.
  if (note) return cardBox;

  return (
    <div className="idea-node" style={{ left: pos.x, top: pos.y, zIndex: editing ? 110 : 10 }}>
      {cardBox}
      {children}
    </div>
  );
}

/* ── The venn item ─────────────────────────────────────────────────────── */

/**
 * Two or three circles, and what sits where they meet.
 *
 * The labels are inputs rather than an edit mode, because a venn is almost
 * never written once — you put the circles up and then argue with yourself
 * about what to call them.
 */
function VennFigure({ pin, conf, onUpdate }: { pin: Pin; conf: PinStyle; onUpdate: (id: number, patch: Partial<Pin>) => void }) {
  const venn = vennOf(pin);
  const three = venn.sets.length >= 3;

  const setLabel = (index: number, value: string) => {
    const sets = [...venn.sets];
    sets[index] = value;
    onUpdate(pin.id, { data: { ...venn, sets } });
  };

  return (
    <div className="case-nodrag space-y-2 px-2.5 pb-2 pt-1">
      <svg viewBox="0 0 200 150" className="w-full" style={{ maxHeight: 150 }}>
        <circle cx={three ? 74 : 78} cy={three ? 62 : 75} r="46" fill="hsl(300 60% 55% / .16)" stroke="hsl(300 55% 62%)" strokeWidth="1" />
        <circle cx={three ? 126 : 122} cy={three ? 62 : 75} r="46" fill="hsl(190 60% 55% / .16)" stroke="hsl(190 55% 60%)" strokeWidth="1" />
        {three && <circle cx="100" cy="102" r="46" fill="hsl(48 60% 55% / .16)" stroke="hsl(48 60% 60%)" strokeWidth="1" />}
        {venn.overlap && (
          <text x="100" y={three ? 74 : 79} textAnchor="middle" fontSize="9" fontFamily="DM Mono, monospace" fill="hsl(0 0% 92%)">
            {venn.overlap.slice(0, 22)}
          </text>
        )}
      </svg>

      <div className="space-y-1">
        {venn.sets.map((label, index) => (
          <input
            key={index}
            value={label}
            onChange={e => setLabel(index, e.target.value)}
            placeholder={`Set ${index + 1}`}
            className="w-full bg-transparent px-1.5 py-1 text-[11px] outline-none"
            style={{ color: conf.text, border: `1px solid ${conf.border}` }}
          />
        ))}
        <input
          value={venn.overlap}
          onChange={e => onUpdate(pin.id, { data: { ...venn, overlap: e.target.value } })}
          placeholder="What they share"
          className="w-full bg-transparent px-1.5 py-1 text-[11px] outline-none"
          style={{ color: "hsl(0 0% 88%)", border: `1px dashed ${conf.border}` }}
        />
        <button
          onClick={() => onUpdate(pin.id, { data: { ...venn, sets: three ? venn.sets.slice(0, 2) : [...venn.sets, "C"] } })}
          className="font-mono text-[9px] tracking-widest"
          style={{ color: conf.text, opacity: 0.55 }}
        >
          {three ? "TWO CIRCLES" : "THREE CIRCLES"}
        </button>
      </div>
    </div>
  );
}

/* ── Tethers ───────────────────────────────────────────────────────────── */

/**
 * The line from a card to the notes stuck to it.
 *
 * Drawn in the wrapper rather than inside the card, so the card's hover scale
 * cannot drag the lines away from the notes they point at.
 */
function NoteTethers({ parent, notes, sizes }: { parent: Pin; notes: Pin[]; sizes: Map<number, CardSize> }) {
  if (notes.length === 0) return null;
  const conf = styleOf(parent);
  const parentSize = sizes.get(parent.id) ?? { w: 180, h: 80 };
  return (
    <svg
      className="pointer-events-none absolute left-0 top-0"
      style={{ width: parentSize.w, height: parentSize.h, overflow: "visible", zIndex: 1 }}
    >
      {notes.map(note => {
        const size = sizes.get(note.id) ?? { w: 140, h: 50 };
        return (
          <line
            key={note.id}
            x1={parentSize.w / 2}
            y1={parentSize.h / 2}
            x2={(note.offset_x ?? 0) + size.w / 2}
            y2={(note.offset_y ?? 0) + size.h / 2}
            stroke={conf.glow}
            strokeWidth="1"
            strokeDasharray="3 3"
            opacity="0.4"
          />
        );
      })}
    </svg>
  );
}

// ── Relationship lines ─────────────────────────────────────────────────

/**
 * The relationship between two cards.
 *
 * Clicking a line used to delete it, which made the label unreachable and the
 * deletion a surprise. It selects instead, and the selection is where the
 * label, the colour and the deletion live. Anchors come from the measured
 * boxes, because an auto-sized card's stored width is 0.
 */
function ThreadLines({ threads, pins, sizes, selectedId, onSelect }: {
  threads: Thread[];
  pins: Pin[];
  sizes: Map<number, CardSize>;
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const pinMap = useMemo(() => new Map(pins.map(pin => [pin.id, pin])), [pins]);
  const centre = (pin: Pin) => {
    const size = sizes.get(pin.id) ?? { w: pin.width || 180, h: pin.height || 80 };
    return { x: pin.pos_x + size.w / 2, y: pin.pos_y + size.h / 2 };
  };

  return (
    <svg
      className="absolute inset-0"
      style={{ width: "100%", height: "100%", overflow: "visible", zIndex: 5, pointerEvents: "none" }}
    >
      {threads.map(thread => {
        const from = pinMap.get(thread.from_id);
        const to   = pinMap.get(thread.to_id);
        if (!from || !to) return null;
        const tone = THREAD_COLORS[thread.color] ?? THREAD_COLORS.red;
        const selected = selectedId === thread.id;

        const a = centre(from);
        const b = centre(to);
        // Sag the line downward like a real string on a cork wall.
        const sag = Math.hypot(b.x - a.x, b.y - a.y) * 0.12;
        const cpx = (a.x + b.x) / 2;
        const cpy = (a.y + b.y) / 2 + sag;
        const path = `M${a.x},${a.y} Q${cpx},${cpy} ${b.x},${b.y}`;
        // The quadratic's own midpoint, which is where a label belongs.
        const lx = (a.x + 2 * cpx + b.x) / 4;
        const ly = (a.y + 2 * cpy + b.y) / 4;
        const width = Math.min(190, Math.max(46, thread.label.length * 6.2 + 16));

        return (
          <g key={thread.id}>
            <path d={path} fill="none" stroke={tone.stroke} strokeWidth={selected ? 2.4 : 1.4} opacity={selected ? 1 : 0.6} />
            <path
              d={path}
              fill="none"
              stroke="transparent"
              strokeWidth="16"
              style={{ cursor: "pointer", pointerEvents: "stroke" }}
              onClick={() => onSelect(thread.id)}
            />
            <g style={{ cursor: "pointer", pointerEvents: "all" }} onClick={() => onSelect(thread.id)}>
              <rect
                x={lx - width / 2} y={ly - 8} width={width} height={16} rx={2}
                fill="hsl(220 14% 7% / .9)" stroke={tone.stroke} strokeOpacity={selected ? 1 : 0.55}
              />
              <text
                x={lx} y={ly + 3.5} textAnchor="middle"
                fill={thread.label ? "hsl(0 0% 88%)" : "hsl(0 0% 55%)"}
                fontSize="10" fontFamily="DM Mono, monospace"
                style={{ pointerEvents: "none" }}
              >
                {thread.label ? thread.label.slice(0, 28) : "name it"}
              </text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}

/** Naming a relationship, recolouring it, or cutting it. */
function ThreadEditor({ thread, onSave, onDelete, onClose }: {
  thread: Thread;
  onSave: (patch: { label?: string; color?: ThreadColor }) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(thread.label ?? "");
  useEffect(() => { setLabel(thread.label ?? ""); }, [thread.id, thread.label]);

  return (
    <div
      className="absolute right-3 top-3 z-40 w-64 space-y-2 border p-3"
      style={{ background: "hsl(222 26% 6% / 0.97)", borderColor: "hsl(220 15% 22%)", backdropFilter: "blur(10px)" }}
    >
      <div className="flex items-center">
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">Relationship</span>
        <button onClick={onClose} className="ml-auto text-muted-foreground/50 hover:text-foreground"><X className="h-3 w-3" /></button>
      </div>
      <input
        autoFocus
        value={label}
        onChange={e => setLabel(e.target.value)}
        onKeyDown={e => {
          e.stopPropagation();
          if (e.key === "Enter") { onSave({ label: label.trim() }); onClose(); }
          if (e.key === "Escape") onClose();
        }}
        placeholder="causes, contradicts, depends on…"
        className="w-full bg-[hsl(222_20%_4%)] px-2 py-1.5 text-[11px] text-foreground/85 outline-none"
        style={{ border: "1px solid hsl(220 15% 18%)" }}
      />
      <div className="flex items-center gap-2">
        {(Object.entries(THREAD_COLORS) as [ThreadColor, { stroke: string; label: string }][]).map(([key, tone]) => (
          <button key={key} onClick={() => onSave({ color: key })} title={tone.label}
            className="flex h-5 w-8 items-center justify-center border"
            style={{ borderColor: thread.color === key ? "hsl(0 0% 80%)" : "hsl(220 15% 18%)" }}>
            <span className="h-1 w-5" style={{ background: tone.stroke }} />
          </button>
        ))}
        <button onClick={onDelete} title="Cut this line" className="ml-auto text-rose-400/60 hover:text-rose-400"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
      <button
        onClick={() => { onSave({ label: label.trim() }); onClose(); }}
        className="flex w-full items-center justify-center gap-1.5 py-1.5 font-mono text-[9px] tracking-widest"
        style={{ background: "hsl(175 30% 10%)", border: "1px solid hsl(175 35% 26%)", color: "hsl(175 55% 62%)" }}
      >
        <Check className="h-3 w-3" /> SAVE LABEL
      </button>
    </div>
  );
}

// ── Context menu ───────────────────────────────────────────────────────
interface MenuState { pin: Pin; x: number; y: number }

function CardMenu({ state, onClose, onType, onLink, onNote, onDelete }: {
  state: MenuState;
  onClose: () => void;
  onType: (type: PinType) => void;
  onLink: () => void;
  onNote: () => void;
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

  const conf = styleOf(state.pin);
  const isNote = Boolean(state.pin.attached_to);
  // A capture is evidence and a venn is a figure; neither is one of a set of
  // interchangeable card kinds, so neither offers the type row.
  const typeable = CARD_TYPES.includes(state.pin.pin_type);

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
      // Clamped, so a card near the right or bottom edge still gets a whole menu.
      style={{
        position: "fixed",
        left: Math.min(state.x, window.innerWidth - 200),
        top:  Math.min(state.y, window.innerHeight - 200),
        zIndex: 400,
        background: "hsl(222 26% 6% / 0.97)",
        border: `1px solid ${conf.border}`,
        backdropFilter: "blur(10px)",
        minWidth: 180,
      }}
      onMouseDown={e => e.stopPropagation()}
      onContextMenu={e => e.preventDefault()}
    >
      {typeable && (
        <div className="flex items-center gap-1.5 border-b px-2.5 py-2" style={{ borderColor: conf.border }}>
          {CARD_TYPES.map(type => (
            <button
              key={type}
              onClick={() => { onType(type); onClose(); }}
              className={cn(
                "h-3.5 w-3.5 border border-black/40 transition-transform hover:scale-125",
                state.pin.pin_type === type && "ring-1 ring-white/50",
              )}
              style={{ background: PIN_TYPES[type].dot }}
              title={PIN_TYPES[type].label}
            />
          ))}
        </div>
      )}
      {!isNote && item("Link to…", Link2, onLink)}
      {!isNote && item("Stick a note", StickyNote, onNote)}
      {item(isNote ? "Delete note" : "Delete", Trash2, onDelete, true)}
    </div>,
    document.body,
  );
}

// ── Line colour picker ─────────────────────────────────────────────────
function ThreadColorPicker({ onSelect, onCancel }: { onSelect: (color: ThreadColor) => void; onCancel: () => void }) {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 9999, background: "hsl(222 16% 4% / 0.7)" }}
      onClick={onCancel}
    >
      <div
        className="space-y-3 border p-5"
        style={{ background: "hsl(220 15% 9%)", borderColor: "hsl(220 15% 20%)" }}
        onClick={e => e.stopPropagation()}
      >
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Choose line colour</p>
        <div className="flex gap-3">
          {(Object.entries(THREAD_COLORS) as [ThreadColor, { stroke: string; label: string }][]).map(([key, tone]) => (
            <button
              key={key}
              onClick={() => onSelect(key)}
              className="flex flex-col items-center gap-2 border px-3 py-2 transition-colors hover:border-white/40"
              style={{ borderColor: "hsl(220 15% 18%)" }}
            >
              <div className="h-1.5 w-8" style={{ background: tone.stroke }} />
              <span className="font-mono text-[10px] text-muted-foreground">{tone.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Board View ─────────────────────────────────────────────────────────
function ComponentBoardView({ board }: { board: Board }) {
  const qc = useQueryClient();
  const boardRef = useRef<HTMLDivElement>(null);
  const pinQKey    = ["/boards", board.id, "pins"];
  const threadQKey = ["/boards", board.id, "threads"];

  const { data: pins = [], isLoading } = useQuery<Pin[]>({
    queryKey: pinQKey,
    queryFn: () => apiRequest("GET", `/api/boards/${board.id}/pins`).then(r => r.json()),
  });

  const { data: threads = [] } = useQuery<Thread[]>({
    queryKey: threadQKey,
    queryFn: () => apiRequest("GET", `/api/boards/${board.id}/threads`).then(r => r.json()),
  });

  const invalidatePins    = () => qc.invalidateQueries({ queryKey: pinQKey });
  const invalidateThreads = () => qc.invalidateQueries({ queryKey: threadQKey });

  const [sizes, setSizes] = useState<Map<number, CardSize>>(new Map());
  const onMeasure = useCallback((id: number, size: CardSize) => {
    setSizes(previous => {
      const known = previous.get(id);
      if (known && known.w === size.w && known.h === size.h) return previous;
      const next = new Map(previous);
      next.set(id, size);
      return next;
    });
  }, []);

  // Cards, and the notes stuck to them. A note whose card is gone is not
  // rendered; deleting a card removes both, and this covers a row that
  // survived a failure.
  const cards = pins.filter(pin => !pin.attached_to);
  const notesByParent = useMemo(() => {
    const map = new Map<number, Pin[]>();
    for (const pin of pins) {
      if (!pin.attached_to) continue;
      const list = map.get(pin.attached_to) ?? [];
      list.push(pin);
      map.set(pin.attached_to, list);
    }
    return map;
  }, [pins]);

  // ── Pin mutations ─────────────────────────────────────────────────────
  const createPin = useMutation({
    mutationFn: (body: object) => apiRequest("POST", `/api/boards/${board.id}/pins`, body).then(r => r.json()),
    onSuccess: invalidatePins,
  });

  const updatePin = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: object }) => apiRequest("PATCH", `/api/pins/${id}`, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: pinQKey });
      const prev = qc.getQueryData<Pin[]>(pinQKey);
      qc.setQueryData<Pin[]>(pinQKey, old => (old ?? []).map(p => p.id === id ? { ...p, ...patch as Pin } : p));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(pinQKey, ctx.prev); },
    onSettled: invalidatePins,
  });

  const deletePin = useMutation({
    // One call: the API deletes the notes stuck to a card and the lines drawn
    // to it, because the board tables carry no foreign keys to do it for us.
    mutationFn: (id: number) => apiRequest("DELETE", `/api/pins/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: pinQKey });
      const prev = qc.getQueryData<Pin[]>(pinQKey);
      qc.setQueryData<Pin[]>(pinQKey, old => (old ?? []).filter(p => p.id !== id && p.attached_to !== id));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(pinQKey, ctx.prev); },
    onSettled: () => { invalidatePins(); invalidateThreads(); },
  });

  // ── Thread mutations ──────────────────────────────────────────────────
  const [selectedThread, setSelectedThread] = useState<number | null>(null);

  const createThread = useMutation({
    mutationFn: (body: object) => apiRequest("POST", `/api/boards/${board.id}/threads`, body).then(r => r.json()),
    // Straight into the editor: a line without a name is half a relationship.
    onSuccess: (created: Thread) => { invalidateThreads(); setSelectedThread(created?.id ?? null); },
  });

  const updateThread = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: object }) => apiRequest("PATCH", `/api/threads/${id}`, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: threadQKey });
      const prev = qc.getQueryData<Thread[]>(threadQKey);
      qc.setQueryData<Thread[]>(threadQKey, old => (old ?? []).map(t => t.id === id ? { ...t, ...patch as Thread } : t));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(threadQKey, ctx.prev); },
    onSettled: invalidateThreads,
  });

  const deleteThread = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/threads/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: threadQKey });
      const prev = qc.getQueryData<Thread[]>(threadQKey);
      qc.setQueryData<Thread[]>(threadQKey, old => (old ?? []).filter(t => t.id !== id));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(threadQKey, ctx.prev); },
    onSettled: invalidateThreads,
  });

  // ── Linking ───────────────────────────────────────────────────────────
  const [linkSource,      setLinkSource]      = useState<number | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [pendingThread,   setPendingThread]   = useState<{ from: number; to: number } | null>(null);
  const [menu,            setMenu]            = useState<MenuState | null>(null);

  const handleLinkClick = useCallback((id: number) => {
    if (linkSource === null) { setLinkSource(id); return; }
    if (linkSource === id) { setLinkSource(null); return; }
    const exists = threads.some(
      t => (t.from_id === linkSource && t.to_id === id) || (t.from_id === id && t.to_id === linkSource),
    );
    if (!exists) {
      setPendingThread({ from: linkSource, to: id });
      setShowColorPicker(true);
    }
    setLinkSource(null);
  }, [linkSource, threads]);

  const confirmThread = (color: ThreadColor) => {
    if (pendingThread) createThread.mutate({ from_id: pendingThread.from, to_id: pendingThread.to, label: "", color });
    setShowColorPicker(false);
    setPendingThread(null);
    setLinkSource(null);
  };

  // ── Adding ────────────────────────────────────────────────────────────
  const addCard = (type: PinType) => {
    const off = (pins.length % 6) * 28;
    // Width and height 0: a card sizes to its content until you resize it.
    createPin.mutate({ content: "", pin_type: type, pos_x: 60 + off, pos_y: 60 + off, width: 0, height: 0, color: type });
  };

  const addVenn = () => {
    const off = (pins.length % 6) * 28;
    createPin.mutate({
      content: "", pin_type: "venn", pos_x: 80 + off, pos_y: 80 + off,
      width: 230, height: 0, color: "venn", data: DEFAULT_VENN,
    });
  };

  /** A note is created on a card, never on the board: it has nowhere else to be. */
  const addNote = (parentId: number) => {
    const parent = pins.find(pin => pin.id === parentId);
    if (!parent) return;
    const siblings = notesByParent.get(parentId)?.length ?? 0;
    const parentSize = sizes.get(parentId) ?? { w: parent.width || 180, h: parent.height || 90 };
    const offsetX = parentSize.w - 30;
    const offsetY = 24 + siblings * 26;
    createPin.mutate({
      content: "", pin_type: "note", color: "note",
      // A position is written too, so a build without the migration still puts
      // the note somewhere sensible rather than at the origin.
      pos_x: parent.pos_x + offsetX, pos_y: parent.pos_y + offsetY,
      width: 0, height: 0,
      attached_to: parentId, offset_x: offsetX, offset_y: offsetY,
    });
  };

  const handleUpdate = useCallback((id: number, patch: Partial<Pin>) => {
    updatePin.mutate({ id, patch });
  }, [updatePin]);

  const canvasMinH = Math.max(520, ...pins.map(p => p.pos_y + 280));
  const selected = threads.find(thread => thread.id === selectedThread) ?? null;

  if (isLoading) return (
    <div className="flex h-48 items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-[hsl(175_55%_45%)] opacity-50" />
    </div>
  );

  return (
    <div className="flex h-full flex-col space-y-3 p-5">
      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-roman text-base font-bold uppercase tracking-widest" style={{ color: "hsl(175 55% 60%)" }}>
            {board.title}
          </h2>
          {linkSource !== null && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 text-xs"
              style={{ background: "hsl(0 35% 8%)", color: "hsl(0 60% 68%)", border: "1px solid hsl(0 40% 24%)" }}>
              <Link2 className="h-3 w-3" />
              Click another card to draw the relationship
              <button className="ml-1 underline" onClick={() => setLinkSource(null)}>cancel</button>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {linkSource !== null && (
            <button
              onClick={() => setLinkSource(null)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs"
              style={{ background: "hsl(0 35% 8%)", color: "hsl(0 60% 60%)", border: "1px solid hsl(0 35% 24%)" }}
            >
              <Link2Off className="h-3 w-3" /> Cancel
            </button>
          )}
          {CARD_TYPES.map(type => {
            const conf = PIN_TYPES[type];
            return (
              <button
                key={type}
                onClick={() => addCard(type)}
                disabled={createPin.isPending}
                className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] transition-colors"
                style={{ border: `1px solid ${conf.border}`, color: conf.text, background: "transparent" }}
                title={`Add a ${conf.label.toLowerCase()} card`}
              >
                {createPin.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : conf.icon}
                {conf.label}
              </button>
            );
          })}
          <button
            onClick={addVenn}
            disabled={createPin.isPending}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] transition-colors"
            style={{ border: `1px solid ${PIN_TYPES.venn.border}`, color: PIN_TYPES.venn.text, background: "transparent" }}
            title="Add a venn item"
          >
            <CircleDashed className="h-3 w-3" /> Venn
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={boardRef}
        className="relative flex-1"
        style={{
          minHeight: canvasMinH,
          background: "hsl(220 12% 5%)",
          border: "1px solid hsl(220 12% 11%)",
          cursor: linkSource !== null ? "crosshair" : "default",
        }}
      >
        {/* Cork grain */}
        <div className="pointer-events-none absolute inset-0 opacity-[0.025]"
          style={{ backgroundImage: "radial-gradient(circle, hsl(38 60% 60%) 1px, transparent 1px)", backgroundSize: "20px 20px" }} />

        <ThreadLines threads={threads} pins={pins} sizes={sizes} selectedId={selectedThread} onSelect={setSelectedThread} />

        {pins.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <Eye className="h-10 w-10 opacity-10" />
            <p className="text-sm opacity-40">Add a card, or capture evidence from a document in the Forge</p>
          </div>
        )}

        {cards.map(pin => {
          const notes = notesByParent.get(pin.id) ?? [];
          return (
            <CaseCardView
              key={pin.id}
              pin={pin}
              onUpdate={handleUpdate}
              onMenu={(target, event) => setMenu({ pin: target, x: event.clientX, y: event.clientY })}
              onLinkClick={handleLinkClick}
              onMeasure={onMeasure}
              isLinking={linkSource !== null}
              isLinkTarget={linkSource !== null && linkSource !== pin.id}
              boardRef={boardRef}
            >
              <NoteTethers parent={pin} notes={notes} sizes={sizes} />
              {notes.map(note => (
                <CaseCardView
                  key={note.id}
                  pin={note}
                  note
                  onUpdate={handleUpdate}
                  onMenu={(target, event) => setMenu({ pin: target, x: event.clientX, y: event.clientY })}
                  onLinkClick={handleLinkClick}
                  onMeasure={onMeasure}
                  isLinking={false}
                  isLinkTarget={false}
                  boardRef={boardRef}
                />
              ))}
            </CaseCardView>
          );
        })}

        {selected && (
          <ThreadEditor
            thread={selected}
            onSave={patch => updateThread.mutate({ id: selected.id, patch })}
            onDelete={() => { deleteThread.mutate(selected.id); setSelectedThread(null); }}
            onClose={() => setSelectedThread(null)}
          />
        )}
      </div>

      {/* Legend */}
      <div className="flex shrink-0 flex-wrap items-center gap-4 text-[10px] text-muted-foreground opacity-50">
        <span>Hold-drag to move · double-click to write · corners to resize</span>
        <span>Right-click a card for kind, links, notes and deletion</span>
        <span>Click a line to name or cut it</span>
      </div>

      {menu && (
        <CardMenu
          state={menu}
          onClose={() => setMenu(null)}
          onType={type => handleUpdate(menu.pin.id, { pin_type: type, color: type })}
          onLink={() => setLinkSource(menu.pin.id)}
          onNote={() => addNote(menu.pin.id)}
          onDelete={() => deletePin.mutate(menu.pin.id)}
        />
      )}

      {showColorPicker && (
        <ThreadColorPicker
          onSelect={confirmThread}
          onCancel={() => { setShowColorPicker(false); setPendingThread(null); }}
        />
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────
export default function ComponentBoard() {
  return (
    <BoardShell type="component_board" label="Case Board" emptyIcon={<Eye className="h-16 w-16" />}>
      {board => <ComponentBoardView board={board} />}
    </BoardShell>
  );
}
