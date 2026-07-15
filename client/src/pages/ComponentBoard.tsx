/**
 * ComponentBoard — Investigative node detective caseboard.
 *
 * Features:
 * - Draggable evidence pins (types: evidence, suspect, location, note)
 * - Red thread lines between pins (click two pins to connect)
 * - Pin type badge + color per pin
 * - Thread labels
 * - All synced to Supabase via API
 */

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
  Plus, Trash2, Link2, Link2Off, Loader2, Eye,
  MapPin, User2, FileSearch, StickyNote,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import BoardShell, { type Board } from "@/components/BoardShell";

// ── Types ──────────────────────────────────────────────────────────────
type PinType = "fact" | "theory" | "conclusion" | "concept";
type ThreadColor = "red" | "amber" | "blue" | "green";

interface Pin {
  id: number;
  content: string;
  pin_type: PinType;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  color: string;
}

interface Thread {
  id: number;
  from_id: number;
  to_id: number;
  label: string;
  color: ThreadColor;
}

// ── Pin config ─────────────────────────────────────────────────────────
const PIN_TYPES: Record<PinType, {
  label: string;
  icon: React.ReactNode;
  bg: string;
  border: string;
  header: string;
  text: string;
  pin: string;
}> = {
  fact: {
    label: "Fact",
    icon: <FileSearch className="w-3 h-3" />,
    bg: "hsl(38 35% 7%)",
    border: "hsl(38 40% 25%)",
    header: "hsl(38 35% 11%)",
    text: "hsl(38 75% 65%)",
    pin: "hsl(38 75% 55%)",
  },
  theory: {
    label: "Theory",
    icon: <User2 className="w-3 h-3" />,
    bg: "hsl(270 35% 7%)",
    border: "hsl(270 40% 28%)",
    header: "hsl(270 35% 11%)",
    text: "hsl(270 60% 72%)",
    pin: "hsl(270 60% 58%)",
  },
  conclusion: {
    label: "Conclusion",
    icon: <MapPin className="w-3 h-3" />,
    bg: "hsl(175 30% 6%)",
    border: "hsl(175 35% 24%)",
    header: "hsl(175 30% 9%)",
    text: "hsl(175 55% 60%)",
    pin: "hsl(175 55% 45%)",
  },
  concept: {
    label: "Concept",
    icon: <StickyNote className="w-3 h-3" />,
    bg: "hsl(210 35% 7%)",
    border: "hsl(210 40% 24%)",
    header: "hsl(210 35% 10%)",
    text: "hsl(210 60% 68%)",
    pin: "hsl(210 60% 52%)",
  },
};

const THREAD_COLORS: Record<ThreadColor, { stroke: string; label: string }> = {
  red:   { stroke: "hsl(0 70% 50% / 0.6)",   label: "Red" },
  amber: { stroke: "hsl(38 75% 55% / 0.6)",  label: "Amber" },
  blue:  { stroke: "hsl(210 70% 55% / 0.6)", label: "Blue" },
  green: { stroke: "hsl(145 50% 45% / 0.6)", label: "Green" },
};

// ── Pin component ──────────────────────────────────────────────────────
interface PinProps {
  pin: Pin;
  onUpdate: (id: number, patch: Partial<Pin>) => void;
  onDelete: (id: number) => void;
  onStartThread: (id: number) => void;
  isThreading: boolean;
  isThreadTarget: boolean;
  boardRef: React.RefObject<HTMLDivElement>;
}

type Corner = "nw" | "ne" | "sw" | "se";
const CORNER_POS: Record<Corner, React.CSSProperties> = {
  nw: { top: -4,    left: -4,    cursor: "nw-resize" },
  ne: { top: -4,    right: -4,   cursor: "ne-resize" },
  sw: { bottom: -4, left: -4,    cursor: "sw-resize" },
  se: { bottom: -4, right: -4,   cursor: "se-resize" },
};
function PinResizeHandles({ onStart, color }: { onStart: (c: Corner, e: React.MouseEvent) => void; color: string }) {
  return (
    <>
      {(["nw","ne","sw","se"] as Corner[]).map(c => (
        <div
          key={c}
          className="absolute w-3 h-3 rounded-sm opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ ...CORNER_POS[c], background: "hsl(220 15% 14%)", border: `1.5px solid ${color}`, zIndex: 50 }}
          onMouseDown={e => { e.stopPropagation(); onStart(c, e); }}
        />
      ))}
    </>
  );
}

function PinComponent({ pin, onUpdate, onDelete, onStartThread, isThreading, isThreadTarget, boardRef }: PinProps) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(pin.content);
  const [pos,     setPos]     = useState({ x: pin.pos_x, y: pin.pos_y });
  const [size,    setSize]    = useState({ w: pin.width, h: pin.height ?? 0 });
  const dragRef   = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const resizeRef = useRef<{ sx: number; sy: number; ow: number; oh: number; ox: number; oy: number; corner: Corner } | null>(null);
  const conf = PIN_TYPES[pin.pin_type] ?? PIN_TYPES.evidence;
  const MIN_W = 160, MIN_H = 100;

  useEffect(() => { setPos({ x: pin.pos_x, y: pin.pos_y }); }, [pin.pos_x, pin.pos_y]);
  useEffect(() => { setSize({ w: pin.width, h: pin.height ?? 0 }); }, [pin.width, pin.height]);
  useEffect(() => { setDraft(pin.content); }, [pin.content]);

  // ── move ──
  const startDrag = (cx: number, cy: number) => {
    if (editing || isThreading) return;
    dragRef.current = { sx: cx, sy: cy, ox: pos.x, oy: pos.y };
  };
  const moveDrag = (cx: number, cy: number) => {
    if (!dragRef.current || !boardRef.current) return;
    const b = boardRef.current.getBoundingClientRect();
    const nx = Math.max(0, Math.min(b.width - size.w - 4, dragRef.current.ox + cx - dragRef.current.sx));
    const ny = Math.max(0, dragRef.current.oy + cy - dragRef.current.sy);
    setPos({ x: nx, y: ny });
  };
  const endDrag = (cx: number, cy: number) => {
    if (!dragRef.current || !boardRef.current) return;
    const b = boardRef.current.getBoundingClientRect();
    const nx = Math.max(0, Math.min(b.width - size.w - 4, dragRef.current.ox + cx - dragRef.current.sx));
    const ny = Math.max(0, dragRef.current.oy + cy - dragRef.current.sy);
    dragRef.current = null;
    onUpdate(pin.id, { pos_x: nx, pos_y: ny });
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
    if (isThreading) return;
    startDrag(e.touches[0].clientX, e.touches[0].clientY);
    const tm = (ev: TouchEvent) => { if (!dragRef.current) return; ev.preventDefault(); moveDrag(ev.touches[0].clientX, ev.touches[0].clientY); };
    const tu = (ev: TouchEvent) => { endDrag(ev.changedTouches[0].clientX, ev.changedTouches[0].clientY); window.removeEventListener("touchmove", tm); window.removeEventListener("touchend", tu); };
    window.addEventListener("touchmove", tm, { passive: false });
    window.addEventListener("touchend", tu);
  };

  // ── resize ──
  const startResize = (corner: Corner, e: React.MouseEvent) => {
    e.preventDefault();
    const initH = size.h > 0 ? size.h : (boardRef.current?.querySelector(`[data-pin-id="${pin.id}"]`) as HTMLElement)?.offsetHeight ?? 160;
    resizeRef.current = { sx: e.clientX, sy: e.clientY, ow: size.w, oh: initH, ox: pos.x, oy: pos.y, corner };
    const mm = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const { sx, sy, ow, oh, ox, oy, corner } = resizeRef.current;
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      let nw = ow, nh = oh, nx = ox, ny = oy;
      if (corner === "se") { nw = Math.max(MIN_W, ow + dx); nh = Math.max(MIN_H, oh + dy); }
      if (corner === "sw") { const nwt = Math.max(MIN_W, ow - dx); nx = ox + (ow - nwt); nw = nwt; nh = Math.max(MIN_H, oh + dy); }
      if (corner === "ne") { nw = Math.max(MIN_W, ow + dx); const nht = Math.max(MIN_H, oh - dy); ny = oy + (oh - nht); nh = nht; }
      if (corner === "nw") { const nwt = Math.max(MIN_W, ow - dx); nx = ox + (ow - nwt); nw = nwt; const nht = Math.max(MIN_H, oh - dy); ny = oy + (oh - nht); nh = nht; }
      setSize({ w: nw, h: nh });
      setPos({ x: Math.max(0, nx), y: Math.max(0, ny) });
    };
    const mu = () => {
      if (!resizeRef.current) return;
      resizeRef.current = null;
      setSize(s => {
        setPos(p => {
          onUpdate(pin.id, { width: s.w, height: s.h, pos_x: p.x, pos_y: p.y });
          return p;
        });
        return s;
      });
      window.removeEventListener("mousemove", mm);
      window.removeEventListener("mouseup", mu);
    };
    window.addEventListener("mousemove", mm);
    window.addEventListener("mouseup", mu);
  };

  const saveEdit = () => { setEditing(false); if (draft !== pin.content) onUpdate(pin.id, { content: draft }); };

  // Pin type cycle
  const PIN_TYPE_ORDER: PinType[] = ["fact", "theory", "conclusion", "concept"];
  const cycleType = (e: React.MouseEvent) => {
    e.stopPropagation();
    const idx = PIN_TYPE_ORDER.indexOf(pin.pin_type);
    const next = PIN_TYPE_ORDER[(idx + 1) % PIN_TYPE_ORDER.length];
    onUpdate(pin.id, { pin_type: next });
  };

  const hasH = size.h > 0;

  return (
    <div
      data-pin-id={pin.id}
      className={cn(
        "absolute rounded-xl border select-none transition-shadow group flex flex-col",
        isThreading && "cursor-crosshair",
        !isThreading && !editing && "cursor-grab active:cursor-grabbing"
      )}
      style={{
        left: pos.x,
        top:  pos.y,
        width: size.w,
        height: hasH ? size.h : undefined,
        background: conf.bg,
        borderColor: isThreadTarget ? "hsl(0 70% 55%)" : conf.border,
        zIndex: editing ? 100 : 10,
        boxShadow: isThreadTarget ? `0 0 0 2px hsl(0 70% 50%), 0 0 20px hsl(0 60% 40% / 0.4)` : undefined,
      }}
      onMouseDown={isThreading ? undefined : onMouseDown}
      onTouchStart={isThreading ? undefined : onTouchStart}
      onClick={isThreading ? () => onStartThread(pin.id) : undefined}
    >
      {/* Resize handles */}
      {!isThreading && <PinResizeHandles onStart={startResize} color={conf.border} />}

      {/* Pin marker dot (top centre) */}
      <div
        className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full border border-black/30"
        style={{ background: conf.pin }}
      />

      {/* Header */}
      <div
        className="flex items-center justify-between px-2.5 py-2 rounded-t-xl shrink-0"
        style={{ background: conf.header, borderBottom: `1px solid ${conf.border}` }}
      >
        {/* Type badge */}
        <button
          onMouseDown={e => e.stopPropagation()}
          onClick={cycleType}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono tracking-wide transition-opacity hover:opacity-80"
          style={{ background: conf.pin + "22", color: conf.text, border: `1px solid ${conf.pin}44` }}
          title="Click to change type"
        >
          {conf.icon}
          {conf.label}
        </button>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onStartThread(pin.id); }}
            className="p-0.5 rounded transition-opacity opacity-40 hover:opacity-100"
            style={{ color: conf.text }}
            title="Connect with a thread"
          >
            <Link2 className="w-3 h-3" />
          </button>
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onDelete(pin.id); }}
            className="p-0.5 rounded text-rose-400/40 hover:text-rose-400 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div
        className="p-2.5 flex-1 overflow-auto"
        onDoubleClick={() => { if (!isThreading) setEditing(true); }}
      >
        {editing ? (
          <textarea
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={saveEdit}
            onKeyDown={e => { if (e.key === "Escape") { setEditing(false); setDraft(pin.content); } }}
            className="w-full bg-transparent resize-none outline-none text-sm leading-relaxed"
            style={{ color: conf.text, minHeight: 70 }}
            placeholder="Write evidence or note…"
            rows={3}
          />
        ) : (
          <p
            className="text-sm leading-relaxed whitespace-pre-wrap break-words"
            style={{ color: conf.text, minHeight: 70, opacity: pin.content ? 1 : 0.3 }}
          >
            {pin.content || "Double-click to write…"}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Thread lines ───────────────────────────────────────────────────────
function ThreadLines({
  threads,
  pins,
  onDelete,
}: {
  threads: Thread[];
  pins: Pin[];
  onDelete: (id: number) => void;
}) {
  const pinMap = useMemo(() => {
    const m: Record<number, Pin> = {};
    pins.forEach(p => { m[p.id] = p; });
    return m;
  }, [pins]);

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      style={{ width: "100%", height: "100%", overflow: "visible", zIndex: 5 }}
    >
      {threads.map(thread => {
        const from = pinMap[thread.from_id];
        const to   = pinMap[thread.to_id];
        if (!from || !to) return null;
        const tConf = THREAD_COLORS[thread.color] ?? THREAD_COLORS.red;

        const x1 = from.pos_x + from.width / 2;
        const y1 = from.pos_y + 24; // top of pin body
        const x2 = to.pos_x + to.width / 2;
        const y2 = to.pos_y + 24;
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        // Sag the thread downward like a real string
        const sag = Math.hypot(x2 - x1, y2 - y1) * 0.12;
        const cpx = mx;
        const cpy = my + sag;

        return (
          <g key={thread.id}>
            <path
              d={`M${x1},${y1} Q${cpx},${cpy} ${x2},${y2}`}
              fill="none"
              stroke={tConf.stroke}
              strokeWidth="1.5"
            />
            {/* Hit target */}
            <path
              d={`M${x1},${y1} Q${cpx},${cpy} ${x2},${y2}`}
              fill="none"
              stroke="transparent"
              strokeWidth="14"
              style={{ cursor: "pointer", pointerEvents: "stroke" }}
              onClick={() => onDelete(thread.id)}
            />
            {thread.label && (
              <text
                x={cpx}
                y={cpy + 14}
                textAnchor="middle"
                fill="hsl(0 60% 60% / 0.7)"
                fontSize="10"
                fontFamily="DM Mono, monospace"
              >
                {thread.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ── Thread color picker modal ──────────────────────────────────────────
function ThreadColorPicker({
  onSelect,
  onCancel,
}: {
  onSelect: (color: ThreadColor) => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 9999, background: "hsl(222 16% 4% / 0.7)" }}
      onClick={onCancel}
    >
      <div
        className="rounded-xl border border-[hsl(220_15%_18%)] p-5 space-y-3"
        style={{ background: "hsl(220 15% 9%)" }}
        onClick={e => e.stopPropagation()}
      >
        <p className="text-xs font-mono tracking-widest text-muted-foreground uppercase">Choose thread color</p>
        <div className="flex gap-3">
          {(Object.entries(THREAD_COLORS) as [ThreadColor, { stroke: string; label: string }][]).map(([key, val]) => (
            <button
              key={key}
              onClick={() => onSelect(key)}
              className="flex flex-col items-center gap-2 px-3 py-2 rounded-lg border border-[hsl(220_15%_18%)] hover:border-[hsl(220_15%_30%)] transition-all"
            >
              <div className="w-8 h-1.5 rounded-full" style={{ background: val.stroke.replace("0.6", "1") }} />
              <span className="text-[10px] font-mono text-muted-foreground">{val.label}</span>
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
    mutationFn: (id: number) => apiRequest("DELETE", `/api/pins/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: pinQKey });
      const prev = qc.getQueryData<Pin[]>(pinQKey);
      qc.setQueryData<Pin[]>(pinQKey, old => (old ?? []).filter(p => p.id !== id));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(pinQKey, ctx.prev); },
    onSettled: invalidatePins,
  });

  // ── Thread mutations ──────────────────────────────────────────────────
  const createThread = useMutation({
    mutationFn: (body: object) => apiRequest("POST", `/api/boards/${board.id}/threads`, body).then(r => r.json()),
    onSuccess: invalidateThreads,
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

  // ── Thread mode ───────────────────────────────────────────────────────
  const [threadSource,    setThreadSource]    = useState<number | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [pendingThread,   setPendingThread]   = useState<{ from: number; to: number } | null>(null);

  const handlePinThreadClick = useCallback((id: number) => {
    if (threadSource === null) {
      setThreadSource(id);
    } else if (threadSource === id) {
      setThreadSource(null);
    } else {
      const exists = threads.some(
        t => (t.from_id === threadSource && t.to_id === id) || (t.from_id === id && t.to_id === threadSource)
      );
      if (!exists) {
        setPendingThread({ from: threadSource, to: id });
        setShowColorPicker(true);
      }
      setThreadSource(null);
    }
  }, [threadSource, threads]);

  const confirmThread = (color: ThreadColor) => {
    if (pendingThread) {
      createThread.mutate({ from_id: pendingThread.from, to_id: pendingThread.to, label: "", color });
    }
    setShowColorPicker(false);
    setPendingThread(null);
    setThreadSource(null);
  };

  // ── Add pin ───────────────────────────────────────────────────────────
  const PIN_TYPE_ORDER: PinType[] = ["fact", "theory", "conclusion", "concept"];
  const addPin = (type: PinType) => {
    const off = (pins.length % 6) * 28;
    createPin.mutate({ content: "", pin_type: type, pos_x: 60 + off, pos_y: 60 + off, width: 200, color: type });
  };

  const handleUpdate = useCallback((id: number, patch: Partial<Pin>) => {
    updatePin.mutate({ id, patch });
  }, [updatePin]);

  const handleDelete = useCallback((id: number) => { deletePin.mutate(id); }, [deletePin]);

  const canvasMinH = Math.max(520, ...pins.map(p => p.pos_y + 260));

  if (isLoading) return (
    <div className="flex items-center justify-center h-48">
      <Loader2 className="w-5 h-5 animate-spin text-[hsl(175_55%_45%)] opacity-50" />
    </div>
  );

  return (
    <div className="p-5 space-y-3 h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between shrink-0 flex-wrap gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="font-roman text-base font-bold tracking-widest uppercase"
            style={{ color: "hsl(175 55% 60%)" }}>
            {board.title}
          </h2>
          {threadSource !== null && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs"
              style={{ background: "hsl(0 35% 8%)", color: "hsl(0 60% 68%)", border: "1px solid hsl(0 40% 24%)" }}>
              <Link2 className="w-3 h-3" />
              Click another pin to connect
              <button className="underline ml-1" onClick={() => setThreadSource(null)}>cancel</button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {threadSource !== null && (
            <button
              onClick={() => setThreadSource(null)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs"
              style={{ background: "hsl(0 35% 8%)", color: "hsl(0 60% 60%)", border: "1px solid hsl(0 35% 24%)" }}
            >
              <Link2Off className="w-3 h-3" />
              Cancel
            </button>
          )}
          {PIN_TYPE_ORDER.map(type => {
            const c = PIN_TYPES[type];
            return (
              <button
                key={type}
                onClick={() => addPin(type)}
                disabled={createPin.isPending}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] transition-all"
                style={{ border: `1px solid ${c.border}`, color: c.text, background: "transparent" }}
                title={`Add ${c.label} pin`}
              >
                {createPin.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : c.icon}
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={boardRef}
        className="relative flex-1 rounded-xl"
        style={{
          minHeight: canvasMinH,
          background: "hsl(220 12% 5%)",
          border: "1px solid hsl(220 12% 11%)",
          cursor: threadSource !== null ? "crosshair" : "default",
        }}
      >
        {/* Cork/grid texture */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.025] rounded-xl"
          style={{ backgroundImage: "radial-gradient(circle, hsl(38 60% 60%) 1px, transparent 1px)", backgroundSize: "20px 20px" }} />

        {/* Thread lines */}
        <ThreadLines threads={threads} pins={pins} onDelete={id => deleteThread.mutate(id)} />

        {/* Empty state */}
        {pins.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground pointer-events-none">
            <Eye className="w-10 h-10 opacity-10" />
            <p className="text-sm opacity-40">Add evidence pins to the board to begin your case</p>
          </div>
        )}

        {/* Pins */}
        {pins.map(pin => (
          <PinComponent
            key={pin.id}
            pin={pin}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
            onStartThread={handlePinThreadClick}
            isThreading={threadSource !== null}
            isThreadTarget={threadSource !== null && threadSource !== pin.id}
            boardRef={boardRef}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 shrink-0 text-[10px] text-muted-foreground opacity-50 flex-wrap">
        <span>Click type badge on pin to cycle type</span>
        <span><Link2 className="w-2.5 h-2.5 inline mr-0.5" />click link icon → click another pin to string a thread</span>
        <span>Click a thread line to remove it</span>
        <span>Double-click pin body to edit</span>
      </div>

      {/* Color picker modal */}
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
    <BoardShell type="component_board" label="Case Board" emptyIcon={<Eye className="w-16 h-16" />}>
      {board => <ComponentBoardView board={board} />}
    </BoardShell>
  );
}
