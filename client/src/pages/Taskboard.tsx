import { useState, useRef, useCallback, useEffect } from "react";
import { Plus, Pin, PinOff, Trash2, GripHorizontal, ArrowUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

// ── Types ──────────────────────────────────────────────────────────────
interface Card {
  id: number;           // server integer id
  content: string;
  color: string;
  posX: number;
  posY: number;
  pinned: boolean;
  width: number;
  onBoard: boolean;
}

// Server row shape
interface ServerCard {
  id: number;
  content: string;
  color: string;
  pos_x: number;
  pos_y: number;
  pinned: number | boolean;
  width: number;
  on_board: number | boolean;
}

function fromServer(s: ServerCard): Card {
  return {
    id:      s.id,
    content: s.content ?? "",
    color:   s.color ?? "gold",
    posX:    s.pos_x ?? 80,
    posY:    s.pos_y ?? 80,
    pinned:  !!s.pinned,
    width:   s.width ?? 210,
    onBoard: !!s.on_board,
  };
}

const COLORS = [
  { id: "gold",    bg: "bg-[hsl(38_55%_8%)]",   border: "border-[hsl(38_55%_28%)]",  header: "bg-[hsl(38_55%_13%)]",  text: "text-[hsl(38_80%_65%)]",   dot: "hsl(38 80% 55%)"   },
  { id: "crimson", bg: "bg-[hsl(0_45%_8%)]",    border: "border-[hsl(0_45%_28%)]",   header: "bg-[hsl(0_45%_13%)]",   text: "text-[hsl(0_60%_65%)]",    dot: "hsl(0 60% 52%)"    },
  { id: "teal",    bg: "bg-[hsl(175_45%_7%)]",  border: "border-[hsl(175_40%_26%)]", header: "bg-[hsl(175_40%_11%)]", text: "text-[hsl(175_55%_60%)]",  dot: "hsl(175 55% 42%)"  },
  { id: "slate",   bg: "bg-[hsl(220_20%_9%)]",  border: "border-[hsl(220_20%_27%)]", header: "bg-[hsl(220_20%_13%)]", text: "text-[hsl(220_25%_65%)]",  dot: "hsl(220 25% 52%)"  },
] as const;

const colorFor = (id: string) => COLORS.find(c => c.id === id) ?? COLORS[0];

// ── Sticky Card ────────────────────────────────────────────────────────
function StickyCard({
  card,
  onUpdate,
  onDelete,
  boardRef,
  isOnBoard,
}: {
  card: Card;
  onUpdate: (id: number, patch: Partial<Card>) => void;
  onDelete: (id: number) => void;
  boardRef: React.RefObject<HTMLDivElement>;
  isOnBoard: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(card.content);
  const [pos,     setPos]     = useState({ x: card.posX, y: card.posY });
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const col = colorFor(card.color);

  useEffect(() => { setPos({ x: card.posX, y: card.posY }); }, [card.posX, card.posY]);
  useEffect(() => { setDraft(card.content); }, [card.content]);

  // ── Shared drag logic ─────────────────────────────────────────────
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

  // ── Mouse ─────────────────────────────────────────────────────────
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (!isOnBoard || card.pinned) return;
    e.preventDefault();
    startDrag(e.clientX, e.clientY);
    const onMove = (ev: MouseEvent) => moveDrag(ev.clientX, ev.clientY);
    const onUp   = (ev: MouseEvent) => {
      endDrag(ev.clientX, ev.clientY);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
  }, [isOnBoard, card.pinned, startDrag, moveDrag, endDrag]);

  // ── Touch ─────────────────────────────────────────────────────────
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isOnBoard || card.pinned) return;
    const touch = e.touches[0];
    startDrag(touch.clientX, touch.clientY);
    const onMove = (ev: TouchEvent) => {
      if (!dragState.current) return;
      ev.preventDefault();
      moveDrag(ev.touches[0].clientX, ev.touches[0].clientY);
    };
    const onEnd = (ev: TouchEvent) => {
      endDrag(ev.changedTouches[0].clientX, ev.changedTouches[0].clientY);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend",  onEnd);
    };
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend",  onEnd);
  }, [isOnBoard, card.pinned, startDrag, moveDrag, endDrag]);

  const saveEdit = () => {
    setEditing(false);
    if (draft !== card.content) onUpdate(card.id, { content: draft });
  };

  return (
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
}

// ── Taskboard Page ─────────────────────────────────────────────────────
export default function Taskboard() {
  const qc = useQueryClient();
  const boardRef = useRef<HTMLDivElement>(null);

  // ── Fetch cards from server ──────────────────────────────────────
  const { data: serverCards, isLoading, isError } = useQuery<ServerCard[]>({
    queryKey: ["/api/taskboard"],
    queryFn: () => apiRequest("GET", "/api/taskboard").then(r => r.json()),
  });

  const cards: Card[] = (serverCards ?? []).map(fromServer);

  // ── Mutations ────────────────────────────────────────────────────
  const invalidate = () => qc.invalidateQueries({ queryKey: ["/api/taskboard"] });

  const createMutation = useMutation({
    mutationFn: (body: object) =>
      apiRequest("POST", "/api/taskboard", body).then(r => r.json()),
    onSuccess: invalidate,
  });

  // Optimistic update — apply locally first, then PATCH server
  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: object }) =>
      apiRequest("PATCH", `/api/taskboard/${id}`, patch).then(r => r.json()),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ["/api/taskboard"] });
      const prev = qc.getQueryData<ServerCard[]>(["/api/taskboard"]);
      qc.setQueryData<ServerCard[]>(["/api/taskboard"], old =>
        (old ?? []).map(c => c.id === id ? { ...c, ...patch } : c)
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["/api/taskboard"], ctx.prev);
    },
    onSettled: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest("DELETE", `/api/taskboard/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["/api/taskboard"] });
      const prev = qc.getQueryData<ServerCard[]>(["/api/taskboard"]);
      qc.setQueryData<ServerCard[]>(["/api/taskboard"], old => (old ?? []).filter(c => c.id !== id));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["/api/taskboard"], ctx.prev);
    },
    onSettled: invalidate,
  });

  // ── Card operations ───────────────────────────────────────────────
  const addCard = useCallback(() => {
    const offset = (cards.length % 6) * 24;
    createMutation.mutate({
      content: "",
      color:   "gold",
      posX:    80 + offset,
      posY:    80 + offset,
      pinned:  false,
      width:   210,
      onBoard: false,
    });
  }, [cards.length, createMutation]);

  const updateCard = useCallback((id: number, patch: Partial<Card>) => {
    // Map camelCase → snake_case for server
    const serverPatch: Record<string, unknown> = {};
    if (patch.content  !== undefined) serverPatch.content   = patch.content;
    if (patch.color    !== undefined) serverPatch.color     = patch.color;
    if (patch.posX     !== undefined) serverPatch.pos_x     = patch.posX;
    if (patch.posY     !== undefined) serverPatch.pos_y     = patch.posY;
    if (patch.pinned   !== undefined) serverPatch.pinned    = patch.pinned ? 1 : 0;
    if (patch.width    !== undefined) serverPatch.width     = patch.width;
    if (patch.onBoard  !== undefined) serverPatch.on_board  = patch.onBoard ? 1 : 0;
    updateMutation.mutate({ id, patch: serverPatch });
  }, [updateMutation]);

  const deleteCard = useCallback((id: number) => {
    deleteMutation.mutate(id);
  }, [deleteMutation]);

  const boardCards = cards.filter(c => c.onBoard);
  const trayCards  = cards.filter(c => !c.onBoard);

  const boardMinHeight = Math.max(520, ...boardCards.map(c => c.posY + 240));

  // ── Render ────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-gold-400" />
        <span className="ml-3 text-sm text-muted-foreground">Loading your board…</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-64 text-rose-400 text-sm">
        Could not load cards — make sure you are logged in.
      </div>
    );
  }

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
        <Button onClick={addCard} size="sm" className="gap-2" disabled={createMutation.isPending}>
          {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          New Card
        </Button>
      </div>

      {/* Board */}
      <div
        ref={boardRef}
        className="relative w-full rounded-xl border border-border bg-[hsl(220_15%_6%)] overflow-hidden"
        style={{ minHeight: boardMinHeight }}
      >
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
        Synced to your profile · {boardCards.length} on board · {trayCards.length} in tray
      </p>
    </div>
  );
}
