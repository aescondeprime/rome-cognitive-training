import { useState, useRef, useCallback, useEffect } from "react";
import { Plus, Pin, PinOff, Trash2, GripHorizontal, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { loadCardData, saveCardData } from "@/lib/cardStore";

// ── Types ──────────────────────────────────────────────────────────────
interface Card {
  id: string;
  content: string;
  color: string;
  posX: number;
  posY: number;
  pinned: boolean;
  width: number;
  onBoard: boolean; // false = in staging tray
}

const COLORS = [
  { id: "gold",    bg: "bg-[hsl(38_55%_8%)]",   border: "border-[hsl(38_55%_28%)]",  header: "bg-[hsl(38_55%_13%)]",  text: "text-[hsl(38_80%_65%)]",   dot: "hsl(38 80% 55%)"   },
  { id: "crimson", bg: "bg-[hsl(0_45%_8%)]",    border: "border-[hsl(0_45%_28%)]",   header: "bg-[hsl(0_45%_13%)]",   text: "text-[hsl(0_60%_65%)]",    dot: "hsl(0 60% 52%)"    },
  { id: "teal",    bg: "bg-[hsl(175_45%_7%)]",  border: "border-[hsl(175_40%_26%)]", header: "bg-[hsl(175_40%_11%)]", text: "text-[hsl(175_55%_60%)]",  dot: "hsl(175 55% 42%)"  },
  { id: "slate",   bg: "bg-[hsl(220_20%_9%)]",  border: "border-[hsl(220_20%_27%)]", header: "bg-[hsl(220_20%_13%)]", text: "text-[hsl(220_25%_65%)]",  dot: "hsl(220 25% 52%)"  },
] as const;

const colorFor = (id: string) => COLORS.find(c => c.id === id) ?? COLORS[0];

// ── Persistence (via cardStore.ts) ──────────────────────────────────────
const loadCards = () => loadCardData<Card>();
const saveCards = (cards: Card[]) => saveCardData<Card>(cards);

function makeId() {
  return `card_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ── Sticky Card ────────────────────────────────────────────────────────
function StickyCard({
  card,
  onUpdate,
  onDelete,
  boardRef,
  isOnBoard,
}: {
  card: Card;
  onUpdate: (id: string, patch: Partial<Card>) => void;
  onDelete: (id: string) => void;
  boardRef: React.RefObject<HTMLDivElement>;
  isOnBoard: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(card.content);
  const [pos, setPos] = useState({ x: card.posX, y: card.posY });
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const col = colorFor(card.color);

  useEffect(() => { setPos({ x: card.posX, y: card.posY }); }, [card.posX, card.posY]);
  useEffect(() => { setDraft(card.content); }, [card.content]);

  // Shared drag logic for both mouse and touch
  const startDrag = useCallback((clientX: number, clientY: number) => {
    if (!isOnBoard || card.pinned) return;
    dragState.current = { startX: clientX, startY: clientY, origX: pos.x, origY: pos.y };
  }, [isOnBoard, card.pinned, pos]);

  const moveDrag = useCallback((clientX: number, clientY: number) => {
    if (!dragState.current || !boardRef.current) return;
    const board = boardRef.current.getBoundingClientRect();
    const dx = clientX - dragState.current.startX;
    const dy = clientY - dragState.current.startY;
    const nx = Math.max(0, Math.min(board.width - card.width - 4, dragState.current.origX + dx));
    const ny = Math.max(0, dragState.current.origY + dy);
    setPos({ x: nx, y: ny });
  }, [boardRef, card.width]);

  const endDrag = useCallback((clientX: number, clientY: number) => {
    if (!dragState.current || !boardRef.current) return;
    const board = boardRef.current.getBoundingClientRect();
    const dx = clientX - dragState.current.startX;
    const dy = clientY - dragState.current.startY;
    const nx = Math.max(0, Math.min(board.width - card.width - 4, dragState.current.origX + dx));
    const ny = Math.max(0, dragState.current.origY + dy);
    dragState.current = null;
    onUpdate(card.id, { posX: nx, posY: ny });
  }, [boardRef, card.id, card.width, onUpdate]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (!isOnBoard || card.pinned) return;
    e.preventDefault();
    startDrag(e.clientX, e.clientY);

    const onMove = (ev: MouseEvent) => moveDrag(ev.clientX, ev.clientY);
    const onUp   = (ev: MouseEvent) => {
      endDrag(ev.clientX, ev.clientY);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [isOnBoard, card.pinned, startDrag, moveDrag, endDrag]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isOnBoard || card.pinned) return;
    // Don't prevent default globally — only prevent scroll if we're actually dragging
    const touch = e.touches[0];
    startDrag(touch.clientX, touch.clientY);

    const onMove = (ev: TouchEvent) => {
      if (!dragState.current) return;
      ev.preventDefault(); // prevent scroll only once drag is confirmed
      const t = ev.touches[0];
      moveDrag(t.clientX, t.clientY);
    };
    const onEnd = (ev: TouchEvent) => {
      const t = ev.changedTouches[0];
      endDrag(t.clientX, t.clientY);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
  }, [isOnBoard, card.pinned, startDrag, moveDrag, endDrag]);

  const saveEdit = () => {
    setEditing(false);
    if (draft !== card.content) onUpdate(card.id, { content: draft });
  };

  const cardEl = (
    <div
      className={cn(
        "rounded-lg border shadow-lg select-none",
        col.bg, col.border,
        isOnBoard ? "absolute" : "inline-flex flex-col w-[210px] shrink-0"
      )}
      style={isOnBoard ? { left: pos.x, top: pos.y, width: card.width, zIndex: card.pinned ? 50 : 10 } : { width: card.width }}
    >
      {/* Header / drag bar */}
      <div
        className={cn(
          "flex items-center justify-between px-2 py-1.5 rounded-t-lg",
          col.header,
          isOnBoard && !card.pinned ? "cursor-grab active:cursor-grabbing" : "cursor-default"
        )}
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
      >
        <div className="flex items-center gap-1.5">
          {isOnBoard && <GripHorizontal className={cn("w-3 h-3 opacity-40", col.text)} />}
          {/* Color dots */}
          <div className="flex gap-1">
            {COLORS.map(c => (
              <button
                key={c.id}
                onMouseDown={e => e.stopPropagation()}
                onClick={() => onUpdate(card.id, { color: c.id })}
                className={cn(
                  "w-2.5 h-2.5 rounded-full border transition-transform hover:scale-125",
                  card.color === c.id ? "ring-1 ring-white/40 scale-110" : "opacity-50"
                )}
                style={{ background: c.dot }}
              />
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1">
          {/* Move to board button (only in tray) */}
          {!isOnBoard && (
            <button
              onMouseDown={e => e.stopPropagation()}
              onClick={() => onUpdate(card.id, { onBoard: true })}
              className={cn("p-0.5 rounded transition-opacity opacity-50 hover:opacity-100", col.text)}
              title="Move to board"
            >
              <ArrowUp className="w-3 h-3" />
            </button>
          )}
          {/* Pin (board only) */}
          {isOnBoard && (
            <button
              onMouseDown={e => e.stopPropagation()}
              onClick={() => onUpdate(card.id, { pinned: !card.pinned })}
              className={cn("p-0.5 rounded transition-opacity", col.text, card.pinned ? "opacity-100" : "opacity-40 hover:opacity-100")}
              title={card.pinned ? "Unpin" : "Pin"}
            >
              {card.pinned ? <Pin className="w-3 h-3" /> : <PinOff className="w-3 h-3" />}
            </button>
          )}
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={() => onDelete(card.id)}
            className="p-0.5 rounded text-rose-400/40 hover:text-rose-400 transition-colors"
            title="Delete"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="p-3" onDoubleClick={() => setEditing(true)}>
        {editing ? (
          <textarea
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={saveEdit}
            onKeyDown={e => {
              if (e.key === "Escape") { setEditing(false); setDraft(card.content); }
            }}
            className={cn("w-full bg-transparent resize-none outline-none text-sm leading-relaxed", col.text)}
            placeholder="Write something…"
            rows={4}
            style={{ minHeight: 70 }}
          />
        ) : (
          <p
            className={cn("text-sm leading-relaxed whitespace-pre-wrap break-words min-h-[70px]", col.text, !card.content && "opacity-30 italic")}
            title="Double-click to edit"
          >
            {card.content || "Double-click to edit…"}
          </p>
        )}
      </div>
    </div>
  );

  return cardEl;
}

// ── Taskboard Page ─────────────────────────────────────────────────────
export default function Taskboard() {
  const [cards, setCards] = useState<Card[]>(() => loadCards());
  const boardRef = useRef<HTMLDivElement>(null);

  // Persist on every change
  useEffect(() => { saveCards(cards); }, [cards]);

  const updateCard = useCallback((id: string, patch: Partial<Card>) => {
    setCards(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
  }, []);

  const deleteCard = useCallback((id: string) => {
    setCards(prev => prev.filter(c => c.id !== id));
  }, []);

  const addCard = useCallback(() => {
    const newCard: Card = {
      id: makeId(),
      content: "",
      color: "gold",
      posX: 80 + (cards.length % 6) * 24,
      posY: 80 + (cards.length % 6) * 24,
      pinned: false,
      width: 210,
      onBoard: false, // starts in tray
    };
    setCards(prev => [...prev, newCard]);
  }, [cards.length]);

  const boardCards = cards.filter(c => c.onBoard);
  const trayCards  = cards.filter(c => !c.onBoard);

  const boardMinHeight = Math.max(
    520,
    ...boardCards.map(c => c.posY + 240)
  );

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5 animate-fade-in">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-roman text-xl font-bold text-gold-300 tracking-widest uppercase">Taskboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Drag cards anywhere · Double-click to edit · Pin to lock in place
          </p>
        </div>
        <Button onClick={addCard} size="sm" className="gap-2">
          <Plus className="w-4 h-4" />
          New Card
        </Button>
      </div>

      {/* Board */}
      <div
        ref={boardRef}
        className="relative w-full rounded-xl border border-border bg-[hsl(220_15%_6%)] overflow-hidden"
        style={{ minHeight: boardMinHeight }}
      >
        {/* Subtle dot grid */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.045]"
          style={{
            backgroundImage: "radial-gradient(circle, hsl(38 60% 60%) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />

        {boardCards.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <p className="text-sm">Board is empty — drag cards up from the tray below.</p>
          </div>
        )}

        {boardCards.map(card => (
          <StickyCard
            key={card.id}
            card={card}
            onUpdate={updateCard}
            onDelete={deleteCard}
            boardRef={boardRef}
            isOnBoard={true}
          />
        ))}
      </div>

      {/* Staging Tray */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-mono text-gold-500 tracking-widest uppercase">Card Tray</p>
          <span className="text-xs text-muted-foreground">
            {trayCards.length} card{trayCards.length !== 1 ? "s" : ""} · click ↑ to move to board
          </span>
        </div>

        <div
          className={cn(
            "w-full min-h-[130px] rounded-xl border border-dashed border-border bg-[hsl(220_15%_5%)] p-4 transition-colors",
            trayCards.length === 0 && "flex items-center justify-center"
          )}
        >
          {trayCards.length === 0 ? (
            <div className="text-center space-y-2">
              <p className="text-xs text-muted-foreground">New cards appear here</p>
              <Button onClick={addCard} size="sm" variant="outline" className="gap-2">
                <Plus className="w-3 h-3" />
                New Card
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-3">
              {trayCards.map(card => (
                <StickyCard
                  key={card.id}
                  card={card}
                  onUpdate={updateCard}
                  onDelete={deleteCard}
                  boardRef={boardRef}
                  isOnBoard={false}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Cards saved locally · {boardCards.length} on board · {trayCards.length} in tray
      </p>
    </div>
  );
}
