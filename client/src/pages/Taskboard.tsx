import { useState, useRef, useCallback, useEffect } from "react";
import { Plus, Pin, PinOff, Trash2, GripHorizontal, ArrowUp, Loader2, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import BoardShell, { type Board } from "@/components/BoardShell";

// ── Types ──────────────────────────────────────────────────────────────
interface Card {
  id: number;
  content: string;
  color: string;
  pos_x: number;
  pos_y: number;
  pinned: number;
  width: number;
  on_board: number;
}

const COLORS = [
  { id: "gold",    bg: "bg-[hsl(38_55%_8%)]",   border: "border-[hsl(38_55%_28%)]",  header: "bg-[hsl(38_55%_13%)]",  text: "text-[hsl(38_80%_65%)]",   dot: "hsl(38 80% 55%)"   },
  { id: "crimson", bg: "bg-[hsl(0_45%_8%)]",    border: "border-[hsl(0_45%_28%)]",   header: "bg-[hsl(0_45%_13%)]",   text: "text-[hsl(0_60%_65%)]",    dot: "hsl(0 60% 52%)"    },
  { id: "teal",    bg: "bg-[hsl(175_45%_7%)]",  border: "border-[hsl(175_40%_26%)]", header: "bg-[hsl(175_40%_11%)]", text: "text-[hsl(175_55%_60%)]",  dot: "hsl(175 55% 42%)"  },
  { id: "slate",   bg: "bg-[hsl(220_20%_9%)]",  border: "border-[hsl(220_20%_27%)]", header: "bg-[hsl(220_20%_13%)]", text: "text-[hsl(220_25%_65%)]",  dot: "hsl(220 25% 52%)"  },
] as const;
const colorFor = (id: string) => COLORS.find(c => c.id === id) ?? COLORS[0];

// ── Sticky Card ────────────────────────────────────────────────────────
function StickyCard({ card, onUpdate, onDelete, boardRef, isOnBoard }: {
  card: Card;
  onUpdate: (id: number, patch: Partial<Card>) => void;
  onDelete: (id: number) => void;
  boardRef: React.RefObject<HTMLDivElement>;
  isOnBoard: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(card.content);
  const [pos,     setPos]     = useState({ x: card.pos_x, y: card.pos_y });
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const col = colorFor(card.color);

  useEffect(() => { setPos({ x: card.pos_x, y: card.pos_y }); }, [card.pos_x, card.pos_y]);
  useEffect(() => { setDraft(card.content); }, [card.content]);

  const startDrag = useCallback((cx: number, cy: number) => {
    if (!isOnBoard || card.pinned) return;
    dragState.current = { startX: cx, startY: cy, origX: pos.x, origY: pos.y };
  }, [isOnBoard, card.pinned, pos]);

  const moveDrag = useCallback((cx: number, cy: number) => {
    if (!dragState.current || !boardRef.current) return;
    const b  = boardRef.current.getBoundingClientRect();
    const nx = Math.max(0, Math.min(b.width - card.width - 4, dragState.current.origX + cx - dragState.current.startX));
    const ny = Math.max(0, dragState.current.origY + cy - dragState.current.startY);
    setPos({ x: nx, y: ny });
  }, [boardRef, card.width]);

  const endDrag = useCallback((cx: number, cy: number) => {
    if (!dragState.current || !boardRef.current) return;
    const b  = boardRef.current.getBoundingClientRect();
    const nx = Math.max(0, Math.min(b.width - card.width - 4, dragState.current.origX + cx - dragState.current.startX));
    const ny = Math.max(0, dragState.current.origY + cy - dragState.current.startY);
    dragState.current = null;
    onUpdate(card.id, { pos_x: nx, pos_y: ny });
  }, [boardRef, card.id, card.width, onUpdate]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (!isOnBoard || card.pinned) return;
    e.preventDefault();
    startDrag(e.clientX, e.clientY);
    const onMove = (ev: MouseEvent) => moveDrag(ev.clientX, ev.clientY);
    const onUp   = (ev: MouseEvent) => { endDrag(ev.clientX, ev.clientY); window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [isOnBoard, card.pinned, startDrag, moveDrag, endDrag]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isOnBoard || card.pinned) return;
    startDrag(e.touches[0].clientX, e.touches[0].clientY);
    const onMove = (ev: TouchEvent) => { if (!dragState.current) return; ev.preventDefault(); moveDrag(ev.touches[0].clientX, ev.touches[0].clientY); };
    const onEnd  = (ev: TouchEvent) => { endDrag(ev.changedTouches[0].clientX, ev.changedTouches[0].clientY); window.removeEventListener("touchmove", onMove); window.removeEventListener("touchend", onEnd); };
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
  }, [isOnBoard, card.pinned, startDrag, moveDrag, endDrag]);

  const saveEdit = () => { setEditing(false); if (draft !== card.content) onUpdate(card.id, { content: draft }); };

  return (
    <div
      className={cn("rounded-lg border shadow-lg select-none", col.bg, col.border, isOnBoard ? "absolute" : "inline-flex flex-col shrink-0")}
      style={isOnBoard ? { left: pos.x, top: pos.y, width: card.width, zIndex: card.pinned ? 50 : 10 } : { width: card.width }}
    >
      <div className={cn("flex items-center justify-between px-2 py-1.5 rounded-t-lg", col.header, isOnBoard && !card.pinned ? "cursor-grab active:cursor-grabbing" : "cursor-default")}
        onMouseDown={onMouseDown} onTouchStart={onTouchStart}>
        <div className="flex items-center gap-1.5">
          {isOnBoard && <GripHorizontal className={cn("w-3 h-3 opacity-40", col.text)} />}
          <div className="flex gap-1">
            {COLORS.map(c => (
              <button key={c.id} onMouseDown={e => e.stopPropagation()} onClick={() => onUpdate(card.id, { color: c.id })}
                className={cn("w-2.5 h-2.5 rounded-full border transition-transform hover:scale-125", card.color === c.id ? "ring-1 ring-white/40 scale-110" : "opacity-50")}
                style={{ background: c.dot }} />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {!isOnBoard && (
            <button onMouseDown={e => e.stopPropagation()} onClick={() => onUpdate(card.id, { on_board: 1 })}
              className={cn("p-0.5 rounded transition-opacity opacity-50 hover:opacity-100", col.text)} title="Move to board">
              <ArrowUp className="w-3 h-3" />
            </button>
          )}
          {isOnBoard && (
            <button onMouseDown={e => e.stopPropagation()} onClick={() => onUpdate(card.id, { pinned: card.pinned ? 0 : 1 })}
              className={cn("p-0.5 rounded transition-opacity", col.text, card.pinned ? "opacity-100" : "opacity-40 hover:opacity-100")}>
              {card.pinned ? <Pin className="w-3 h-3" /> : <PinOff className="w-3 h-3" />}
            </button>
          )}
          <button onMouseDown={e => e.stopPropagation()} onClick={() => onDelete(card.id)} className="p-0.5 rounded text-rose-400/40 hover:text-rose-400 transition-colors">
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
      <div className="p-3" onDoubleClick={() => setEditing(true)}>
        {editing ? (
          <textarea autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={saveEdit}
            onKeyDown={e => { if (e.key === "Escape") { setEditing(false); setDraft(card.content); } }}
            className={cn("w-full bg-transparent resize-none outline-none text-sm leading-relaxed", col.text)}
            placeholder="Write something…" rows={4} style={{ minHeight: 70 }} />
        ) : (
          <p className={cn("text-sm leading-relaxed whitespace-pre-wrap break-words min-h-[70px]", col.text, !card.content && "opacity-30 italic")} title="Double-click to edit">
            {card.content || "Double-click to edit…"}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Board view ─────────────────────────────────────────────────────────
function TaskboardView({ board }: { board: Board }) {
  const qc = useQueryClient();
  const boardRef = useRef<HTMLDivElement>(null);
  const qKey = ["/boards", board.id, "tasks"];

  const { data: cards = [], isLoading } = useQuery<Card[]>({
    queryKey: qKey,
    queryFn: () => apiRequest("GET", `/api/boards/${board.id}/tasks`).then(r => r.json()),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: qKey });

  const createMutation = useMutation({
    mutationFn: (body: object) => apiRequest("POST", `/api/boards/${board.id}/tasks`, body).then(r => r.json()),
    onSuccess: invalidate,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: object }) => apiRequest("PATCH", `/api/tasks/${id}`, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: qKey });
      const prev = qc.getQueryData<Card[]>(qKey);
      qc.setQueryData<Card[]>(qKey, old => (old ?? []).map(c => c.id === id ? { ...c, ...patch } : c));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(qKey, ctx.prev); },
    onSettled: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/tasks/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qKey });
      const prev = qc.getQueryData<Card[]>(qKey);
      qc.setQueryData<Card[]>(qKey, old => (old ?? []).filter(c => c.id !== id));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(qKey, ctx.prev); },
    onSettled: invalidate,
  });

  const addCard = () => {
    const off = (cards.length % 6) * 24;
    createMutation.mutate({ content: "", color: "gold", pos_x: 80 + off, pos_y: 80 + off, pinned: 0, width: 210, on_board: 0 });
  };

  const updateCard = useCallback((id: number, patch: Partial<Card>) => {
    updateMutation.mutate({ id, patch });
  }, [updateMutation]);

  const deleteCard = useCallback((id: number) => { deleteMutation.mutate(id); }, [deleteMutation]);

  const boardCards = cards.filter(c => c.on_board);
  const trayCards  = cards.filter(c => !c.on_board);
  const boardMinH  = Math.max(420, ...boardCards.map(c => c.pos_y + 260));

  if (isLoading) return <div className="flex items-center justify-center h-48"><Loader2 className="w-5 h-5 animate-spin text-gold-500 opacity-50" /></div>;

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-roman text-base font-bold text-gold-300 tracking-widest uppercase">{board.title}</h2>
        <button onClick={addCard} disabled={createMutation.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-[hsl(43_25%_20%)] text-gold-500 hover:text-gold-300 hover:bg-[hsl(43_30%_8%)] transition-all">
          {createMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
          New Card
        </button>
      </div>

      {/* Board */}
      <div ref={boardRef} className="relative w-full rounded-xl border border-border bg-[hsl(220_15%_6%)]" style={{ minHeight: boardMinH }}>
        <div className="absolute inset-0 pointer-events-none opacity-[0.04] rounded-xl"
          style={{ backgroundImage: "radial-gradient(circle, hsl(38 60% 60%) 1px, transparent 1px)", backgroundSize: "32px 32px" }} />
        {boardCards.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            Board is empty — move cards up from the tray
          </div>
        )}
        {boardCards.map(card => <StickyCard key={card.id} card={card} onUpdate={updateCard} onDelete={deleteCard} boardRef={boardRef} isOnBoard={true} />)}
      </div>

      {/* Tray */}
      <div className="space-y-2">
        <p className="text-xs font-mono text-gold-500/60 tracking-widest uppercase">Card Tray</p>
        <div className={cn("w-full min-h-[100px] rounded-xl border border-dashed border-border bg-[hsl(220_15%_5%)] p-3 transition-colors", trayCards.length === 0 && "flex items-center justify-center")}>
          {trayCards.length === 0
            ? <p className="text-xs text-muted-foreground">New cards appear here · click ↑ on a card to move it to the board</p>
            : <div className="flex flex-wrap gap-3">{trayCards.map(card => <StickyCard key={card.id} card={card} onUpdate={updateCard} onDelete={deleteCard} boardRef={boardRef} isOnBoard={false} />)}</div>
          }
        </div>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────
export default function Taskboard() {
  return (
    <BoardShell type="taskboard" label="Taskboard" emptyIcon={<ClipboardList className="w-16 h-16" />}>
      {board => <TaskboardView board={board} />}
    </BoardShell>
  );
}
