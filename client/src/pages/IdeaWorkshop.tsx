/**
 * IdeaWorkshop — Creative node canvas.
 *
 * Features:
 * - Draggable idea cards on a free canvas (dot-grid)
 * - Connect cards by clicking "link" mode then two cards → SVG line + optional label
 * - Energy level indicator (1-5 flame icons) per card
 * - Tags per card (comma-separated, displayed as chips)
 * - Color picker per card
 * - All synced to Supabase via API
 */

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
  Plus, Trash2, Link2, Link2Off, Zap, Tag,
  Loader2, Lightbulb, X, Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import BoardShell, { type Board } from "@/components/BoardShell";

// ── Types ──────────────────────────────────────────────────────────────
interface IdeaCard {
  id: number;
  content: string;
  color: string;
  pos_x: number;
  pos_y: number;
  width: number;
  tags: string;
  energy: number;
}

interface IdeaConnection {
  id: number;
  from_id: number;
  to_id: number;
  label: string;
}

// ── Palette ────────────────────────────────────────────────────────────
const COLORS = [
  { id: "violet", dot: "hsl(270 60% 58%)", bg: "hsl(270 35% 7%)",  border: "hsl(270 35% 26%)", header: "hsl(270 35% 11%)", text: "hsl(270 60% 72%)"  },
  { id: "rose",   dot: "hsl(340 60% 58%)", bg: "hsl(340 35% 7%)",  border: "hsl(340 35% 26%)", header: "hsl(340 35% 11%)", text: "hsl(340 60% 72%)"  },
  { id: "amber",  dot: "hsl(38 75% 55%)",  bg: "hsl(38 40% 7%)",   border: "hsl(38 40% 24%)",  header: "hsl(38 40% 11%)",  text: "hsl(38 75% 68%)"   },
  { id: "teal",   dot: "hsl(175 55% 45%)", bg: "hsl(175 35% 6%)",  border: "hsl(175 35% 24%)", header: "hsl(175 35% 10%)", text: "hsl(175 55% 62%)"  },
  { id: "slate",  dot: "hsl(220 30% 55%)", bg: "hsl(220 18% 8%)",  border: "hsl(220 18% 25%)", header: "hsl(220 18% 12%)", text: "hsl(220 30% 68%)"  },
] as const;
type ColorId = typeof COLORS[number]["id"];
const colorFor = (id: string) => COLORS.find(c => c.id === id) ?? COLORS[0];

// ── Energy Icons ───────────────────────────────────────────────────────
function EnergyBar({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          onClick={e => { e.stopPropagation(); onChange(n); }}
          className={cn(
            "text-[10px] transition-opacity select-none",
            n <= value ? "opacity-100" : "opacity-20"
          )}
          title={`Energy ${n}`}
        >
          ⚡
        </button>
      ))}
    </div>
  );
}

// ── Tag Editor ─────────────────────────────────────────────────────────
function TagChips({ tags, onSave }: { tags: string; onSave: (t: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(tags);
  const chips = tags.split(",").map(t => t.trim()).filter(Boolean);

  const commit = () => {
    setEditing(false);
    if (draft !== tags) onSave(draft);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setEditing(false); setDraft(tags); } }}
        onClick={e => e.stopPropagation()}
        placeholder="tag1, tag2, tag3"
        className="w-full bg-transparent text-[10px] outline-none text-current opacity-80 border-b border-current/20"
      />
    );
  }

  return (
    <div className="flex flex-wrap gap-1 cursor-text" onClick={e => { e.stopPropagation(); setEditing(true); }}>
      {chips.length === 0
        ? <span className="text-[10px] opacity-30 italic flex items-center gap-0.5"><Tag className="w-2.5 h-2.5" />add tags…</span>
        : chips.map(t => (
          <span key={t} className="px-1.5 py-0.5 rounded text-[9px] font-mono tracking-wide bg-current/10 opacity-70">
            {t}
          </span>
        ))
      }
    </div>
  );
}

// ── Idea Card ──────────────────────────────────────────────────────────
interface IdeaCardProps {
  card: IdeaCard;
  onUpdate: (id: number, patch: Partial<IdeaCard>) => void;
  onDelete: (id: number) => void;
  onStartLink: (id: number) => void;
  isLinking: boolean;
  isLinkTarget: boolean;
  boardRef: React.RefObject<HTMLDivElement>;
}

function IdeaCardComponent({ card, onUpdate, onDelete, onStartLink, isLinking, isLinkTarget, boardRef }: IdeaCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(card.content);
  const [pos,     setPos]     = useState({ x: card.pos_x, y: card.pos_y });
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const col = colorFor(card.color);

  useEffect(() => { setPos({ x: card.pos_x, y: card.pos_y }); }, [card.pos_x, card.pos_y]);
  useEffect(() => { setDraft(card.content); }, [card.content]);

  const startDrag = (cx: number, cy: number) => {
    if (editing) return;
    dragRef.current = { sx: cx, sy: cy, ox: pos.x, oy: pos.y };
  };

  const moveDrag = (cx: number, cy: number) => {
    if (!dragRef.current || !boardRef.current) return;
    const b = boardRef.current.getBoundingClientRect();
    const nx = Math.max(0, Math.min(b.width - card.width - 4, dragRef.current.ox + cx - dragRef.current.sx));
    const ny = Math.max(0, dragRef.current.oy + cy - dragRef.current.sy);
    setPos({ x: nx, y: ny });
  };

  const endDrag = (cx: number, cy: number) => {
    if (!dragRef.current || !boardRef.current) return;
    const b = boardRef.current.getBoundingClientRect();
    const nx = Math.max(0, Math.min(b.width - card.width - 4, dragRef.current.ox + cx - dragRef.current.sx));
    const ny = Math.max(0, dragRef.current.oy + cy - dragRef.current.sy);
    dragRef.current = null;
    onUpdate(card.id, { pos_x: nx, pos_y: ny });
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    startDrag(e.clientX, e.clientY);
    const mm = (ev: MouseEvent) => moveDrag(ev.clientX, ev.clientY);
    const mu = (ev: MouseEvent) => { endDrag(ev.clientX, ev.clientY); window.removeEventListener("mousemove", mm); window.removeEventListener("mouseup", mu); };
    window.addEventListener("mousemove", mm);
    window.addEventListener("mouseup", mu);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    startDrag(e.touches[0].clientX, e.touches[0].clientY);
    const tm = (ev: TouchEvent) => { if (!dragRef.current) return; ev.preventDefault(); moveDrag(ev.touches[0].clientX, ev.touches[0].clientY); };
    const tu = (ev: TouchEvent) => { endDrag(ev.changedTouches[0].clientX, ev.changedTouches[0].clientY); window.removeEventListener("touchmove", tm); window.removeEventListener("touchend", tu); };
    window.addEventListener("touchmove", tm, { passive: false });
    window.addEventListener("touchend", tu);
  };

  const saveEdit = () => { setEditing(false); if (draft !== card.content) onUpdate(card.id, { content: draft }); };

  const cardStyle: React.CSSProperties = {
    left: pos.x,
    top:  pos.y,
    width: card.width,
    background: col.bg,
    borderColor: isLinkTarget ? "hsl(270 80% 65%)" : col.border,
    zIndex: editing ? 100 : 10,
    boxShadow: isLinkTarget ? `0 0 0 2px hsl(270 80% 65%), 0 0 20px hsl(270 60% 50% / 0.4)` : undefined,
  };

  return (
    <div
      className={cn(
        "absolute rounded-xl border select-none transition-shadow",
        isLinking && "cursor-crosshair",
        !isLinking && !editing && "cursor-grab active:cursor-grabbing"
      )}
      style={cardStyle}
      onMouseDown={isLinking ? undefined : onMouseDown}
      onTouchStart={isLinking ? undefined : onTouchStart}
      onClick={isLinking ? () => onStartLink(card.id) : undefined}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-2.5 py-2 rounded-t-xl"
        style={{ background: col.header, borderBottom: `1px solid ${col.border}` }}
      >
        {/* Color dots */}
        <div className="flex gap-1">
          {COLORS.map(c => (
            <button
              key={c.id}
              onMouseDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); onUpdate(card.id, { color: c.id }); }}
              className={cn("w-2.5 h-2.5 rounded-full border border-black/20 transition-transform hover:scale-125",
                card.color === c.id ? "ring-1 ring-white/40 scale-110" : "opacity-50")}
              style={{ background: c.dot }}
            />
          ))}
        </div>
        {/* Actions */}
        <div className="flex items-center gap-1">
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onStartLink(card.id); }}
            className="p-0.5 rounded transition-opacity opacity-40 hover:opacity-100"
            style={{ color: col.text }}
            title="Connect to another card"
          >
            <Link2 className="w-3 h-3" />
          </button>
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onDelete(card.id); }}
            className="p-0.5 rounded text-rose-400/40 hover:text-rose-400 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="p-2.5 space-y-2.5" onDoubleClick={() => { if (!isLinking) setEditing(true); }}>
        {editing ? (
          <textarea
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={saveEdit}
            onKeyDown={e => { if (e.key === "Escape") { setEditing(false); setDraft(card.content); } }}
            className="w-full bg-transparent resize-none outline-none text-sm leading-relaxed"
            style={{ color: col.text, minHeight: 80 }}
            placeholder="Write your idea…"
            rows={4}
          />
        ) : (
          <p
            className="text-sm leading-relaxed whitespace-pre-wrap break-words"
            style={{ color: col.text, minHeight: 80, opacity: card.content ? 1 : 0.3 }}
          >
            {card.content || "Double-click to write…"}
          </p>
        )}

        {/* Energy */}
        <EnergyBar value={card.energy} onChange={v => onUpdate(card.id, { energy: v })} />

        {/* Tags */}
        <div style={{ color: col.text }}>
          <TagChips tags={card.tags} onSave={t => onUpdate(card.id, { tags: t })} />
        </div>
      </div>
    </div>
  );
}

// ── SVG Connections ────────────────────────────────────────────────────
function ConnectionLines({
  connections,
  cards,
  onDelete,
}: {
  connections: IdeaConnection[];
  cards: IdeaCard[];
  onDelete: (id: number) => void;
}) {
  const cardMap = useMemo(() => {
    const m: Record<number, IdeaCard> = {};
    cards.forEach(c => { m[c.id] = c; });
    return m;
  }, [cards]);

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      style={{ width: "100%", height: "100%", overflow: "visible", zIndex: 5 }}
    >
      <defs>
        <marker id="arrow-idea" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 Z" fill="hsl(270 60% 58% / 0.6)" />
        </marker>
      </defs>
      {connections.map(conn => {
        const from = cardMap[conn.from_id];
        const to   = cardMap[conn.to_id];
        if (!from || !to) return null;

        const x1 = from.pos_x + from.width / 2;
        const y1 = from.pos_y + 60;
        const x2 = to.pos_x + to.width / 2;
        const y2 = to.pos_y + 60;
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        const cpx = mx + (y2 - y1) * 0.15;
        const cpy = my - (x2 - x1) * 0.15;

        return (
          <g key={conn.id}>
            <path
              d={`M${x1},${y1} Q${cpx},${cpy} ${x2},${y2}`}
              fill="none"
              stroke="hsl(270 60% 58% / 0.35)"
              strokeWidth="1.5"
              strokeDasharray="5 3"
              markerEnd="url(#arrow-idea)"
            />
            {/* Invisible wider hit target */}
            <path
              d={`M${x1},${y1} Q${cpx},${cpy} ${x2},${y2}`}
              fill="none"
              stroke="transparent"
              strokeWidth="12"
              style={{ cursor: "pointer", pointerEvents: "stroke" }}
              onClick={() => onDelete(conn.id)}
            />
            {conn.label && (
              <text
                x={cpx}
                y={cpy - 6}
                textAnchor="middle"
                fill="hsl(270 60% 70% / 0.7)"
                fontSize="10"
                fontFamily="DM Mono, monospace"
              >
                {conn.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ── Workshop View ──────────────────────────────────────────────────────
function WorkshopView({ board }: { board: Board }) {
  const qc = useQueryClient();
  const boardRef = useRef<HTMLDivElement>(null);
  const cardQKey = ["/boards", board.id, "ideas"];
  const connQKey = ["/boards", board.id, "idea-connections"];

  const { data: cards = [], isLoading: cardsLoading } = useQuery<IdeaCard[]>({
    queryKey: cardQKey,
    queryFn: () => apiRequest("GET", `/api/boards/${board.id}/ideas`).then(r => r.json()),
  });

  const { data: connections = [] } = useQuery<IdeaConnection[]>({
    queryKey: connQKey,
    queryFn: () => apiRequest("GET", `/api/boards/${board.id}/idea-connections`).then(r => r.json()),
  });

  const invalidateCards = () => qc.invalidateQueries({ queryKey: cardQKey });
  const invalidateConns = () => qc.invalidateQueries({ queryKey: connQKey });

  // ── Card mutations ────────────────────────────────────────────────────
  const createCard = useMutation({
    mutationFn: (body: object) => apiRequest("POST", `/api/boards/${board.id}/ideas`, body).then(r => r.json()),
    onSuccess: invalidateCards,
  });

  const updateCard = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: object }) => apiRequest("PATCH", `/api/ideas/${id}`, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: cardQKey });
      const prev = qc.getQueryData<IdeaCard[]>(cardQKey);
      qc.setQueryData<IdeaCard[]>(cardQKey, old => (old ?? []).map(c => c.id === id ? { ...c, ...patch as IdeaCard } : c));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(cardQKey, ctx.prev); },
    onSettled: invalidateCards,
  });

  const deleteCard = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/ideas/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: cardQKey });
      const prev = qc.getQueryData<IdeaCard[]>(cardQKey);
      qc.setQueryData<IdeaCard[]>(cardQKey, old => (old ?? []).filter(c => c.id !== id));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(cardQKey, ctx.prev); },
    onSettled: invalidateCards,
  });

  // ── Connection mutations ───────────────────────────────────────────────
  const createConn = useMutation({
    mutationFn: (body: object) => apiRequest("POST", `/api/boards/${board.id}/idea-connections`, body).then(r => r.json()),
    onSuccess: invalidateConns,
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

  // ── Link mode ─────────────────────────────────────────────────────────
  const [linkSource, setLinkSource] = useState<number | null>(null);

  const handleCardLinkClick = useCallback((id: number) => {
    if (linkSource === null) {
      setLinkSource(id);
    } else if (linkSource === id) {
      setLinkSource(null);
    } else {
      // Check if connection already exists
      const exists = connections.some(
        c => (c.from_id === linkSource && c.to_id === id) || (c.from_id === id && c.to_id === linkSource)
      );
      if (!exists) {
        createConn.mutate({ from_id: linkSource, to_id: id, label: "" });
      }
      setLinkSource(null);
    }
  }, [linkSource, connections, createConn]);

  // ── Add card ─────────────────────────────────────────────────────────
  const addCard = () => {
    const off = (cards.length % 5) * 28;
    const colors: ColorId[] = ["violet", "rose", "amber", "teal", "slate"];
    const color = colors[cards.length % colors.length];
    createCard.mutate({ content: "", color, pos_x: 60 + off, pos_y: 60 + off, width: 220, tags: "", energy: 3 });
  };

  const handleUpdate = useCallback((id: number, patch: Partial<IdeaCard>) => {
    updateCard.mutate({ id, patch });
  }, [updateCard]);

  const handleDelete = useCallback((id: number) => {
    deleteCard.mutate(id);
  }, [deleteCard]);

  const canvasMinH = Math.max(520, ...cards.map(c => c.pos_y + 280));

  if (cardsLoading) return (
    <div className="flex items-center justify-center h-48">
      <Loader2 className="w-5 h-5 animate-spin text-[hsl(270_60%_58%)] opacity-50" />
    </div>
  );

  return (
    <div className="p-5 space-y-3 h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="font-roman text-base font-bold tracking-widest uppercase"
            style={{ color: "hsl(270 60% 72%)" }}>
            {board.title}
          </h2>
          {linkSource !== null && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs"
              style={{ background: "hsl(270 35% 10%)", color: "hsl(270 60% 72%)", border: "1px solid hsl(270 35% 26%)" }}>
              <Link2 className="w-3 h-3" />
              Click another card to connect · click same card or
              <button className="underline ml-1" onClick={() => setLinkSource(null)}>cancel</button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {linkSource !== null && (
            <button
              onClick={() => setLinkSource(null)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs transition-all"
              style={{ background: "hsl(270 35% 10%)", color: "hsl(270 60% 65%)", border: "1px solid hsl(270 35% 26%)" }}
            >
              <Link2Off className="w-3 h-3" />
              Cancel Link
            </button>
          )}
          <button
            onClick={addCard}
            disabled={createCard.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all"
            style={{
              border: "1px solid hsl(270 35% 26%)",
              color: "hsl(270 60% 68%)",
              background: "transparent",
            }}
          >
            {createCard.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
            New Idea
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={boardRef}
        className="relative flex-1 rounded-xl"
        style={{
          minHeight: canvasMinH,
          background: "hsl(220 15% 5%)",
          border: "1px solid hsl(220 15% 12%)",
          cursor: linkSource !== null ? "crosshair" : "default",
        }}
      >
        {/* Dot grid */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.035] rounded-xl"
          style={{ backgroundImage: "radial-gradient(circle, hsl(270 60% 70%) 1px, transparent 1px)", backgroundSize: "28px 28px" }} />

        {/* Connection lines */}
        <ConnectionLines connections={connections} cards={cards} onDelete={id => deleteConn.mutate(id)} />

        {/* Empty state */}
        {cards.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground pointer-events-none">
            <Lightbulb className="w-10 h-10 opacity-10" />
            <p className="text-sm opacity-40">Add an idea card to get started</p>
          </div>
        )}

        {/* Cards */}
        {cards.map(card => (
          <IdeaCardComponent
            key={card.id}
            card={card}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
            onStartLink={handleCardLinkClick}
            isLinking={linkSource !== null}
            isLinkTarget={linkSource !== null && linkSource !== card.id}
            boardRef={boardRef}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 shrink-0 text-[10px] text-muted-foreground opacity-50">
        <span>⚡ = energy level (click to set)</span>
        <span><Tag className="w-2.5 h-2.5 inline mr-0.5" />click tags area to edit</span>
        <span><Link2 className="w-2.5 h-2.5 inline mr-0.5" />click link icon → click another card</span>
        <span>Click a connection line to remove it</span>
        <span>Double-click card body to edit</span>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────
export default function IdeaWorkshop() {
  return (
    <BoardShell type="idea_workshop" label="Workshop" emptyIcon={<Lightbulb className="w-16 h-16" />}>
      {board => <WorkshopView board={board} />}
    </BoardShell>
  );
}
