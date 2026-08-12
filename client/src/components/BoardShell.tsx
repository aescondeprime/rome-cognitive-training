/**
 * BoardShell — shared sidebar + header for multi-board pages.
 * Used by Taskboard, Idea Workshop, and Component Board.
 *
 * Shows a list of boards of a given type, lets you create/rename/delete,
 * and renders the active board's content as children.
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Plus, Trash2, ChevronLeft, PenLine, Check, Loader2, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConstellationSidebar, type ConstellationNavNode } from "@/components/ConstellationNavigator";

export interface Board {
  id: number;
  type: string;
  title: string;
  created_at: number;
  updated_at: number;
}

interface Props {
  type: "taskboard" | "idea_workshop" | "component_board";
  label: string;           // e.g. "Taskboard"
  emptyIcon?: React.ReactNode;
  children: (board: Board) => React.ReactNode;
}

export default function BoardShell({ type, label, emptyIcon, children }: Props) {
  const qc = useQueryClient();
  const [activeBoardId, setActiveBoardId] = useState<number | null>(null);
  const [editingId,     setEditingId]     = useState<number | null>(null);
  const [editTitle,     setEditTitle]     = useState("");
  const [collapsed,     setCollapsed]     = useState(false);

  const { data: boards = [], isLoading } = useQuery<Board[]>({
    queryKey: ["/boards", type],
    queryFn:  () => apiRequest("GET", `/api/boards?type=${type}`).then(r => r.json()),
  });

  // Deep-link: if sessionStorage has a pending board ID, auto-select it once boards load
  useEffect(() => {
    if (boards.length === 0) return;
    const pending = sessionStorage.getItem("rome_open_board_id");
    if (pending) {
      const id = parseInt(pending);
      sessionStorage.removeItem("rome_open_board_id");
      if (boards.find(b => b.id === id)) {
        setActiveBoardId(id);
      }
    }
  }, [boards]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/boards", type] });

  const createBoard = useMutation({
    mutationFn: () => apiRequest("POST", "/api/boards", { type, title: `New ${label}` }).then(r => r.json()),
    onSuccess: (board: Board) => { invalidate(); setActiveBoardId(board.id); },
  });

  const renameBoard = useMutation({
    mutationFn: ({ id, title }: { id: number; title: string }) =>
      apiRequest("PATCH", `/api/boards/${id}`, { title }),
    onSuccess: invalidate,
  });

  const deleteBoard = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/boards/${id}`),
    onSuccess: (_, id) => {
      invalidate();
      if (activeBoardId === id) setActiveBoardId(null);
    },
  });

  const startRename = useCallback((board: Board) => {
    setEditingId(board.id);
    setEditTitle(board.title);
  }, []);

  const commitRename = useCallback(() => {
    if (editingId && editTitle.trim()) {
      renameBoard.mutate({ id: editingId, title: editTitle.trim() });
    }
    setEditingId(null);
  }, [editingId, editTitle, renameBoard]);

  const activeBoard = boards.find(b => b.id === activeBoardId) ?? null;
  const graphEnabled = type === "idea_workshop" || type === "component_board";
  const graphAccent = type === "idea_workshop" ? "hsl(192 100% 62%)" : "hsl(38 78% 58%)";
  const graphHubId = `hub:${type}`;
  const graphNodes: ConstellationNavNode[] = useMemo(() => [
      {
        id: graphHubId,
        label: type === "idea_workshop" ? "Creative Core" : "Investigative Core",
        group: type,
        color: graphAccent,
        kind: "hub",
        weight: 7,
        subtitle: `${label} constellation`,
      },
      ...boards.map(board => ({
        id: `board:${board.id}`,
        label: board.title,
        group: type,
        color: graphAccent,
        kind: "item" as const,
        subtitle: `Updated ${new Date(board.updated_at).toLocaleDateString()}`,
        weight: activeBoardId === board.id ? 5 : Math.max(1, 4 - Math.floor((Date.now() - board.updated_at) / 86_400_000)),
      })),
    ], [activeBoardId, boards, graphAccent, graphHubId, label, type]);
  const graphLinks = useMemo(
    () => boards.map(board => ({ source: graphHubId, target: `board:${board.id}` })),
    [boards, graphHubId],
  );

  return (
    <div className="flex h-full min-h-[calc(100vh-120px)]" style={{ gap: 0 }}>

      {/* ── Sidebar / node constellation ──────────────────────────────── */}
      {graphEnabled ? (
        <ConstellationSidebar
          title={type === "idea_workshop" ? "Workshops" : "Case Boards"}
          accent={graphAccent}
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
          loading={isLoading}
          nodes={graphNodes}
          links={graphLinks}
          activeId={activeBoardId ? `board:${activeBoardId}` : graphHubId}
          onSelect={id => {
            if (id.startsWith("board:")) setActiveBoardId(Number(id.slice(6)));
          }}
          emptyLabel={`No ${label.toLowerCase()}s yet`}
          collapsedAction={(
            <button
              onClick={() => createBoard.mutate()}
              disabled={createBoard.isPending}
              className="flex w-full justify-center rounded p-2 text-gold-500 transition-colors hover:bg-[hsl(43_30%_8%)] hover:text-gold-300"
              title={`New ${label}`}
            >
              {createBoard.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            </button>
          )}
          footer={(
            <div className="space-y-1.5">
              {activeBoard && (
                <div className="flex items-center gap-1 rounded-sm border border-[hsl(220_15%_14%)] bg-[hsl(220_15%_6%)] p-1">
                  {editingId === activeBoard.id ? (
                    <input
                      autoFocus
                      value={editTitle}
                      onChange={e => setEditTitle(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={e => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="min-w-0 flex-1 bg-transparent px-1 font-mono text-[9px] text-gold-300 outline-none"
                    />
                  ) : (
                    <span className="min-w-0 flex-1 truncate px-1 font-mono text-[8px] text-muted-foreground/60">{activeBoard.title}</span>
                  )}
                  <button
                    onClick={() => editingId === activeBoard.id ? commitRename() : startRename(activeBoard)}
                    className="rounded p-1 text-muted-foreground hover:text-gold-400"
                    title="Rename selected node"
                  >
                    {editingId === activeBoard.id ? <Check className="h-3 w-3" /> : <PenLine className="h-3 w-3" />}
                  </button>
                  <button
                    onClick={() => deleteBoard.mutate(activeBoard.id)}
                    className="rounded p-1 text-muted-foreground hover:text-rose-400"
                    title="Delete selected node"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              )}
              <button
                onClick={() => createBoard.mutate()}
                disabled={createBoard.isPending}
                className="flex w-full items-center justify-center gap-1.5 rounded-sm border border-dashed px-3 py-2 font-mono text-[9px] uppercase tracking-[0.12em] text-gold-500 transition-all hover:border-gold-600 hover:bg-[hsl(43_30%_8%)] hover:text-gold-300"
                style={{ borderColor: graphAccent, color: graphAccent }}
              >
                {createBoard.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                New {label}
              </button>
            </div>
          )}
        />
      ) : (
      <div
        className={cn(
          "flex flex-col border-r border-border bg-[hsl(220_15%_5%)] transition-all duration-300 shrink-0",
          collapsed ? "w-10" : "w-56"
        )}
      >
        {/* Sidebar header */}
        <div className="flex items-center justify-between px-3 py-3 border-b border-border">
          {!collapsed && (
            <span className="text-xs font-mono text-gold-500 tracking-widest uppercase truncate">
              {label}s
            </span>
          )}
          <button
            onClick={() => setCollapsed(v => !v)}
            className="p-1 rounded text-muted-foreground hover:text-gold-400 transition-colors ml-auto"
            title={collapsed ? "Expand" : "Collapse"}
          >
            <ChevronLeft className={cn("w-3.5 h-3.5 transition-transform", collapsed && "rotate-180")} />
          </button>
        </div>

        {/* Board list */}
        {!collapsed && (
          <div className="flex-1 overflow-y-auto py-2 space-y-0.5 px-2">
            {isLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="w-4 h-4 animate-spin text-gold-500 opacity-50" />
              </div>
            ) : boards.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6 px-2">
                No {label.toLowerCase()}s yet
              </p>
            ) : (
              boards.map(board => (
                <div
                  key={board.id}
                  className={cn(
                    "group flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer transition-colors",
                    activeBoardId === board.id
                      ? "bg-[hsl(43_30%_10%)] text-gold-400"
                      : "hover:bg-[hsl(220_15%_8%)] text-muted-foreground hover:text-foreground"
                  )}
                  onClick={() => setActiveBoardId(board.id)}
                >
                  <BookOpen className="w-3 h-3 shrink-0 opacity-60" />
                  {editingId === board.id ? (
                    <input
                      autoFocus
                      value={editTitle}
                      onChange={e => setEditTitle(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={e => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      onClick={e => e.stopPropagation()}
                      className="flex-1 bg-transparent outline-none text-xs text-gold-300 min-w-0"
                    />
                  ) : (
                    <span className="flex-1 text-xs truncate">{board.title}</span>
                  )}
                  <div className="hidden group-hover:flex items-center gap-0.5">
                    <button
                      onClick={e => { e.stopPropagation(); startRename(board); }}
                      className="p-0.5 rounded hover:text-gold-400 transition-colors"
                      title="Rename"
                    >
                      {editingId === board.id
                        ? <Check className="w-2.5 h-2.5" />
                        : <PenLine className="w-2.5 h-2.5" />
                      }
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); deleteBoard.mutate(board.id); }}
                      className="p-0.5 rounded hover:text-rose-400 transition-colors"
                      title="Delete board"
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* New board button */}
        {!collapsed && (
          <div className="p-2 border-t border-border">
            <button
              onClick={() => createBoard.mutate()}
              disabled={createBoard.isPending}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs text-gold-500 hover:text-gold-300 hover:bg-[hsl(43_30%_8%)] border border-dashed border-[hsl(43_25%_18%)] hover:border-gold-600 transition-all"
            >
              {createBoard.isPending
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <Plus className="w-3 h-3" />
              }
              New {label}
            </button>
          </div>
        )}

        {/* Collapsed new button */}
        {collapsed && (
          <div className="p-1 border-t border-border">
            <button
              onClick={() => createBoard.mutate()}
              className="w-full flex justify-center p-2 rounded text-gold-500 hover:text-gold-300 hover:bg-[hsl(43_30%_8%)] transition-colors"
              title={`New ${label}`}
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
      )}

      {/* ── Main content ──────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        {activeBoard ? (
          children(activeBoard)
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
            {emptyIcon && <div className="opacity-20">{emptyIcon}</div>}
            <p className="text-sm">Select a {label.toLowerCase()} from the sidebar, or create one</p>
            <button
              onClick={() => createBoard.mutate()}
              disabled={createBoard.isPending}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[hsl(43_25%_20%)] text-gold-500 hover:text-gold-300 hover:bg-[hsl(43_30%_8%)] text-sm transition-all"
            >
              {createBoard.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Plus className="w-4 h-4" />
              }
              New {label}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
