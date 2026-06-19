import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Plus, Pin, PinOff, Trash2, GripHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────
interface Card {
  id: number;
  content: string;
  color: string;
  posX: number;
  posY: number;
  pinned: number;
  width: number;
}

const COLORS: { id: string; label: string; bg: string; border: string; header: string; text: string }[] = [
  { id: "gold",    label: "Gold",    bg: "bg-[hsl(38_55%_8%)]",  border: "border-[hsl(38_55%_30%)]", header: "bg-[hsl(38_55%_14%)]", text: "text-[hsl(38_80%_65%)]"  },
  { id: "crimson", label: "Crimson", bg: "bg-[hsl(0_45%_8%)]",   border: "border-[hsl(0_45%_30%)]",  header: "bg-[hsl(0_45%_14%)]",  text: "text-[hsl(0_60%_65%)]"   },
  { id: "teal",    label: "Teal",    bg: "bg-[hsl(175_45%_7%)]", border: "border-[hsl(175_40%_28%)]", header: "bg-[hsl(175_40%_12%)]", text: "text-[hsl(175_55%_60%)]" },
  { id: "slate",   label: "Slate",   bg: "bg-[hsl(220_20%_9%)]", border: "border-[hsl(220_20%_28%)]", header: "bg-[hsl(220_20%_14%)]", text: "text-[hsl(220_25%_65%)]" },
];

const colorFor = (id: string) => COLORS.find(c => c.id === id) ?? COLORS[0];

// ── Sticky Card ────────────────────────────────────────────────────────
function StickyCard({
  card,
  onUpdate,
  onDelete,
  boardRef,
}: {
  card: Card;
  onUpdate: (id: number, patch: Partial<Card>) => void;
  onDelete: (id: number) => void;
  boardRef: React.RefObject<HTMLDivElement>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(card.content);
  const [pos, setPos] = useState({ x: card.posX, y: card.posY });
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const col = colorFor(card.color);

  // Sync if external update
  useEffect(() => { setPos({ x: card.posX, y: card.posY }); }, [card.posX, card.posY]);
  useEffect(() => { setDraft(card.content); }, [card.content]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (card.pinned) return;
    e.preventDefault();
    dragState.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };

    const onMove = (ev: MouseEvent) => {
      if (!dragState.current || !boardRef.current) return;
      const board = boardRef.current.getBoundingClientRect();
      const dx = ev.clientX - dragState.current.startX;
      const dy = ev.clientY - dragState.current.startY;
      const nx = Math.max(0, Math.min(board.width - card.width - 4, dragState.current.origX + dx));
      const ny = Math.max(0, dragState.current.origY + dy);
      setPos({ x: nx, y: ny });
    };

    const onUp = (ev: MouseEvent) => {
      if (!dragState.current || !boardRef.current) return;
      const board = boardRef.current.getBoundingClientRect();
      const dx = ev.clientX - dragState.current.startX;
      const dy = ev.clientY - dragState.current.startY;
      const nx = Math.max(0, Math.min(board.width - card.width - 4, dragState.current.origX + dx));
      const ny = Math.max(0, dragState.current.origY + dy);
      dragState.current = null;
      onUpdate(card.id, { posX: nx, posY: ny });
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [card.id, card.pinned, card.width, pos, onUpdate, boardRef]);

  const saveEdit = () => {
    setEditing(false);
    if (draft !== card.content) onUpdate(card.id, { content: draft });
  };

  return (
    <div
      className={cn("absolute rounded-lg border shadow-lg select-none", col.bg, col.border)}
      style={{ left: pos.x, top: pos.y, width: card.width, zIndex: card.pinned ? 50 : 10 }}
    >
      {/* Drag handle header */}
      <div
        className={cn(
          "flex items-center justify-between px-2 py-1.5 rounded-t-lg cursor-grab active:cursor-grabbing",
          col.header,
          card.pinned && "cursor-default"
        )}
        onMouseDown={onMouseDown}
      >
        <div className="flex items-center gap-1">
          <GripHorizontal className={cn("w-3 h-3 opacity-50", col.text)} />
          {/* Color picker dots */}
          <div className="flex gap-1 ml-1">
            {COLORS.map(c => (
              <button
                key={c.id}
                onMouseDown={e => { e.stopPropagation(); onUpdate(card.id, { color: c.id }); }}
                className={cn(
                  "w-2.5 h-2.5 rounded-full border transition-transform hover:scale-125",
                  c.text.replace("text-", "bg-").replace("[hsl", "[hsl"),
                  card.color === c.id ? "ring-1 ring-white/40" : "opacity-50"
                )}
                style={{ background: c.id === "gold" ? "hsl(38 80% 55%)" : c.id === "crimson" ? "hsl(0 60% 52%)" : c.id === "teal" ? "hsl(175 55% 45%)" : "hsl(220 25% 52%)" }}
              />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={() => onUpdate(card.id, { pinned: card.pinned ? 0 : 1 })}
            className={cn("p-0.5 rounded hover:opacity-100 transition-opacity", col.text, card.pinned ? "opacity-100" : "opacity-40")}
            title={card.pinned ? "Unpin" : "Pin"}
          >
            {card.pinned ? <Pin className="w-3 h-3" /> : <PinOff className="w-3 h-3" />}
          </button>
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={() => onDelete(card.id)}
            className="p-0.5 rounded text-rose-400/50 hover:text-rose-400 transition-colors"
            title="Delete"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className="p-3" onDoubleClick={() => setEditing(true)}>
        {editing ? (
          <textarea
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={saveEdit}
            onKeyDown={e => { if (e.key === "Escape") { setEditing(false); setDraft(card.content); } }}
            className={cn(
              "w-full bg-transparent resize-none outline-none text-sm leading-relaxed",
              col.text, "placeholder:opacity-40"
            )}
            placeholder="Write something…"
            rows={4}
            style={{ minHeight: 80 }}
          />
        ) : (
          <p
            className={cn("text-sm leading-relaxed whitespace-pre-wrap break-words", col.text, !card.content && "opacity-30 italic")}
            title="Double-click to edit"
          >
            {card.content || "Double-click to edit…"}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Taskboard Page ─────────────────────────────────────────────────────
export default function Taskboard() {
  const qc = useQueryClient();
  const boardRef = useRef<HTMLDivElement>(null);

  const { data: cards = [], isLoading } = useQuery<Card[]>({
    queryKey: ["/api/taskboard"],
    queryFn: () => apiRequest("GET", "/api/taskboard").then(r => r.json()),
  });

  const createMut = useMutation({
    mutationFn: (data: Partial<Card>) => apiRequest("POST", "/api/taskboard", data).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/taskboard"] }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<Card> }) =>
      apiRequest("PATCH", `/api/taskboard/${id}`, patch).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/taskboard"] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/taskboard/${id}`).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/taskboard"] }),
  });

  const addCard = useCallback(() => {
    // Stagger new cards so they don't stack exactly
    const offset = (cards.length % 6) * 30;
    createMut.mutate({ content: "", color: "gold", posX: 80 + offset, posY: 80 + offset, width: 220 });
  }, [cards.length, createMut]);

  const handleUpdate = useCallback((id: number, patch: Partial<Card>) => {
    updateMut.mutate({ id, patch });
  }, [updateMut]);

  const handleDelete = useCallback((id: number) => {
    deleteMut.mutate(id);
  }, [deleteMut]);

  // Board height = tallest card bottom + padding
  const boardMinHeight = Math.max(
    600,
    ...cards.map(c => c.posY + 220)
  );

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-roman text-xl font-bold text-gold-300 tracking-widest uppercase">Taskboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Drag cards anywhere · Double-click to edit · Pin to lock in place</p>
        </div>
        <Button onClick={addCard} size="sm" className="gap-2" disabled={createMut.isPending}>
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
        {/* Subtle grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.04] pointer-events-none"
          style={{
            backgroundImage: "linear-gradient(hsl(38 60% 60%) 1px, transparent 1px), linear-gradient(90deg, hsl(38 60% 60%) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />

        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
            Loading board…
          </div>
        )}

        {!isLoading && cards.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <p className="text-sm">Your board is empty.</p>
            <Button onClick={addCard} size="sm" variant="outline" className="gap-2">
              <Plus className="w-4 h-4" />
              Add your first card
            </Button>
          </div>
        )}

        {cards.map(card => (
          <StickyCard
            key={card.id}
            card={card}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
            boardRef={boardRef}
          />
        ))}
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Cards are saved automatically · {cards.length} card{cards.length !== 1 ? "s" : ""} on board
      </p>
    </div>
  );
}
