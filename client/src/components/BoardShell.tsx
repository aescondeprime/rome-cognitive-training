/**
 * BoardShell — shared sidebar + header for multi-board pages.
 * Used by Taskboard, Idea Workshop, and Component Board.
 *
 * Shows a list of boards of a given type, lets you create/rename/delete,
 * and renders the active board's content as children.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Plus, Trash2, ChevronLeft, PenLine, Check, Loader2, BookOpen, FolderPlus, Folder as FolderIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConstellationSidebar, type ConstellationNavNode } from "@/components/ConstellationNavigator";

export interface Board {
  id: number;
  type: string;
  title: string;
  folder_id: number | null;
  created_at: number;
  updated_at: number;
}

/** A core: the renamable file boards are organised into. */
export interface BoardFolder {
  id: number;
  type: string;
  name: string;
  color: string;
  created_at: number;
  updated_at: number;
}

// Boards with no core still have to be reachable, so they hang off a core that
// is not a row. Zero is safe as its id: identity columns start at one.
const UNFILED_ID = 0;

interface Props {
  type: "taskboard" | "idea_workshop" | "component_board";
  label: string;           // e.g. "Taskboard"
  emptyIcon?: React.ReactNode;
  children: (board: Board) => React.ReactNode;
}

function graphAccentFor(type: string) {
  return type === "idea_workshop" ? "hsl(192 100% 62%)" : "hsl(38 78% 58%)";
}

// Cores are told apart by hue before they are read, so a new one takes the next
// colour rather than the domain accent every time.
const CORE_COLORS = [
  "hsl(192 100% 62%)",
  "hsl(270 70% 68%)",
  "hsl(150 60% 55%)",
  "hsl(38 85% 60%)",
  "hsl(340 70% 65%)",
  "hsl(210 80% 66%)",
] as const;

/** Right-click menu for a core node on the graph. */
function CoreMenu({
  folder, x, y, onClose, onColor, onRename, onDelete,
}: {
  folder: BoardFolder;
  x: number;
  y: number;
  onClose: () => void;
  onColor: (color: string) => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Hit-tested rather than trusting handler order: the graph stops pointer
    // events on its nodes, so a capture-phase listener is the only one certain
    // to run — and it would otherwise close the menu before a click landed.
    const dismiss = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("mousedown", dismiss, true);
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("mousedown", dismiss, true); window.removeEventListener("keydown", escape); };
  }, [onClose]);

  const item = (text: string, Icon: typeof PenLine, action: () => void, danger = false) => (
    <button
      onClick={() => { action(); onClose(); }}
      className={cn(
        "flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-mono text-[9px] uppercase tracking-[0.1em] transition-colors",
        danger ? "text-rose-400/70 hover:bg-rose-500/10 hover:text-rose-300" : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
      )}
    >
      <Icon className="h-3 w-3" />
      {text}
    </button>
  );

  return createPortal(
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        left: Math.min(x, window.innerWidth - 190),
        top:  Math.min(y, window.innerHeight - 150),
        zIndex: 400,
        background: "hsl(222 26% 6% / 0.97)",
        border: `1px solid ${folder.color || "hsl(220 15% 22%)"}`,
        backdropFilter: "blur(10px)",
        minWidth: 170,
      }}
      onContextMenu={e => e.preventDefault()}
    >
      <div className="flex items-center gap-1.5 border-b px-2.5 py-2" style={{ borderColor: folder.color || "hsl(220 15% 22%)" }}>
        {CORE_COLORS.map(color => (
          <button
            key={color}
            onClick={() => { onColor(color); onClose(); }}
            className={cn(
              "h-3.5 w-3.5 border border-black/40 transition-transform hover:scale-125",
              folder.color === color && "ring-1 ring-white/50",
            )}
            style={{ background: color }}
            title="Core colour"
          />
        ))}
      </div>
      {item("Rename core", PenLine, onRename)}
      {item("Delete core", Trash2, onDelete, true)}
    </div>,
    document.body,
  );
}

export default function BoardShell({ type, label, emptyIcon, children }: Props) {
  const qc = useQueryClient();
  const [activeBoardId,    setActiveBoardId]    = useState<number | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  // Keyed rather than numeric: a core and a board can share an id.
  const [editingKey,       setEditingKey]       = useState<string | null>(null);
  const [editTitle,        setEditTitle]        = useState("");
  const [collapsed,        setCollapsed]        = useState(false);
  const [coreMenu,         setCoreMenu]         = useState<{ folder: BoardFolder; x: number; y: number } | null>(null);

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

  const { data: folders = [] } = useQuery<BoardFolder[]>({
    queryKey: ["/board-folders", type],
    queryFn:  () => apiRequest("GET", `/api/board-folders?type=${type}`).then(r => r.json()),
  });

  const invalidate       = () => qc.invalidateQueries({ queryKey: ["/boards", type] });
  const invalidateCores  = () => qc.invalidateQueries({ queryKey: ["/board-folders", type] });

  // A board created while a core is selected lands in it. Anything else is
  // unfiled, which is a place, not an error state.
  const createBoard = useMutation({
    mutationFn: () => apiRequest("POST", "/api/boards", {
      type,
      title: `New ${label}`,
      folder_id: selectedFolderId && selectedFolderId !== UNFILED_ID ? selectedFolderId : null,
    }).then(r => r.json()),
    onSuccess: (board: Board) => { invalidate(); setActiveBoardId(board.id); setSelectedFolderId(null); },
  });

  const createFolder = useMutation({
    mutationFn: () => apiRequest("POST", "/api/board-folders", { type, name: "New Core", color: CORE_COLORS[folders.length % CORE_COLORS.length] }).then(r => r.json()),
    onSuccess: (folder: BoardFolder) => {
      invalidateCores();
      setSelectedFolderId(folder.id);
      setEditingKey(`folder:${folder.id}`);
      setEditTitle(folder.name);
    },
  });

  const updateFolder = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: { name?: string; color?: string } }) =>
      apiRequest("PATCH", `/api/board-folders/${id}`, patch),
    onSuccess: invalidateCores,
  });

  const deleteFolder = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/board-folders/${id}`),
    onSuccess: (_, id) => {
      invalidateCores();
      invalidate();               // its boards just became unfiled
      if (selectedFolderId === id) setSelectedFolderId(null);
    },
  });

  const moveBoard = useMutation({
    mutationFn: ({ id, folderId }: { id: number; folderId: number | null }) =>
      apiRequest("PATCH", `/api/boards/${id}`, { folder_id: folderId }),
    onSuccess: invalidate,
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
    setEditingKey(`board:${board.id}`);
    setEditTitle(board.title);
  }, []);

  const commitRename = useCallback(() => {
    const key = editingKey;
    const value = editTitle.trim();
    setEditingKey(null);
    if (!key || !value) return;
    const [kind, rawId] = key.split(":");
    const id = Number(rawId);
    if (kind === "board")  renameBoard.mutate({ id, title: value });
    if (kind === "folder") updateFolder.mutate({ id, patch: { name: value } });
  }, [editingKey, editTitle, renameBoard, updateFolder]);

  const activeBoard  = boards.find(b => b.id === activeBoardId) ?? null;
  const graphEnabled = type === "idea_workshop" || type === "component_board";
  const graphAccent  = graphAccentFor(type);

  const folderById = useMemo(() => new Map(folders.map(f => [f.id, f])), [folders]);
  const selectedFolder = selectedFolderId !== null && selectedFolderId !== UNFILED_ID
    ? folderById.get(selectedFolderId) ?? null
    : null;

  // A board whose folder_id points at a core that no longer exists reads as
  // unfiled rather than vanishing — the delete route unfiles, but a row written
  // by an older build, or by the other API twin, must not be able to hide work.
  const coreIdFor = useCallback((board: Board) => (
    board.folder_id != null && folderById.has(board.folder_id) ? board.folder_id : UNFILED_ID
  ), [folderById]);

  const unfiledCount = useMemo(
    () => boards.filter(board => coreIdFor(board) === UNFILED_ID).length,
    [boards, coreIdFor],
  );
  // The Unfiled core earns its place only when something is in it, or when
  // there is nothing else on the graph at all.
  const showUnfiled = unfiledCount > 0 || folders.length === 0;

  const graphNodes: ConstellationNavNode[] = useMemo(() => {
    const coreNodes: ConstellationNavNode[] = folders.map(folder => ({
      id: `folder:${folder.id}`,
      label: folder.name,
      group: `core:${folder.id}`,
      color: folder.color || graphAccent,
      kind: "folder" as const,
      weight: 6,
      subtitle: `${boards.filter(b => coreIdFor(b) === folder.id).length} ${label.toLowerCase()}s`,
    }));
    if (showUnfiled) {
      coreNodes.push({
        id: `folder:${UNFILED_ID}`,
        label: "Unfiled",
        group: `core:${UNFILED_ID}`,
        color: "hsl(218 14% 52%)",
        kind: "folder",
        weight: 5,
        subtitle: `${unfiledCount} ${label.toLowerCase()}s`,
      });
    }
    return [
      ...coreNodes,
      ...boards.map(board => {
        const coreId = coreIdFor(board);
        return {
          id: `board:${board.id}`,
          label: board.title,
          group: `core:${coreId}`,
          color: folderById.get(coreId)?.color || (coreId === UNFILED_ID ? "hsl(218 14% 52%)" : graphAccent),
          kind: "item" as const,
          subtitle: `Updated ${new Date(board.updated_at).toLocaleDateString()}`,
          weight: activeBoardId === board.id ? 5 : Math.max(1, 4 - Math.floor((Date.now() - board.updated_at) / 86_400_000)),
        };
      }),
    ];
  }, [activeBoardId, boards, coreIdFor, folderById, folders, graphAccent, label, showUnfiled, unfiledCount]);

  const graphLinks = useMemo(
    () => boards.map(board => ({ source: `folder:${coreIdFor(board)}`, target: `board:${board.id}` })),
    [boards, coreIdFor],
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
          activeId={
            selectedFolderId !== null ? `folder:${selectedFolderId}`
            : activeBoardId !== null  ? `board:${activeBoardId}`
            : null
          }
          onNodeContextMenu={(id, e) => {
            // Unfiled is not a row: there is nothing to recolour, rename or
            // delete, so it gets no menu rather than a menu of dead items.
            if (!id.startsWith("folder:")) return;
            const folder = folderById.get(Number(id.slice(7)));
            if (!folder) return;
            setSelectedFolderId(folder.id);
            setCoreMenu({ folder, x: e.clientX, y: e.clientY });
          }}
          onSelect={id => {
            if (id.startsWith("board:")) {
              setActiveBoardId(Number(id.slice(6)));
              setSelectedFolderId(null);
            } else if (id.startsWith("folder:")) {
              // Selecting a core does not close the open board: it re-aims the
              // footer controls at the core, which is what you want when you
              // are filing rather than reading.
              setSelectedFolderId(Number(id.slice(7)));
            }
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
              {/* A core is selected: rename or remove the file itself. */}
              {selectedFolderId !== null && (
                <div className="flex items-center gap-1 rounded-sm border border-[hsl(220_15%_14%)] bg-[hsl(220_15%_6%)] p-1">
                  <FolderIcon className="ml-1 h-3 w-3 shrink-0" style={{ color: selectedFolder?.color || "hsl(218 14% 52%)" }} />
                  {selectedFolder && editingKey === `folder:${selectedFolder.id}` ? (
                    <input
                      autoFocus
                      value={editTitle}
                      onChange={e => setEditTitle(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={e => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") setEditingKey(null);
                      }}
                      className="min-w-0 flex-1 bg-transparent px-1 font-mono text-[9px] text-gold-300 outline-none"
                    />
                  ) : (
                    <span className="min-w-0 flex-1 truncate px-1 font-mono text-[8px] text-muted-foreground/60">
                      {selectedFolder?.name ?? "Unfiled"}
                    </span>
                  )}
                  {/* Unfiled is not a row, so it can be neither renamed nor deleted. */}
                  {selectedFolder && (
                    <>
                      <button
                        onClick={() => {
                          if (editingKey === `folder:${selectedFolder.id}`) commitRename();
                          else { setEditingKey(`folder:${selectedFolder.id}`); setEditTitle(selectedFolder.name); }
                        }}
                        className="rounded p-1 text-muted-foreground hover:text-gold-400"
                        title="Rename core"
                      >
                        {editingKey === `folder:${selectedFolder.id}` ? <Check className="h-3 w-3" /> : <PenLine className="h-3 w-3" />}
                      </button>
                      <button
                        onClick={() => deleteFolder.mutate(selectedFolder.id)}
                        className="rounded p-1 text-muted-foreground hover:text-rose-400"
                        title="Delete core — its boards become unfiled"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => setSelectedFolderId(null)}
                    className="rounded p-1 text-muted-foreground hover:text-foreground"
                    title="Clear core selection"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}

              {/* A board is selected: rename, refile, or remove it. */}
              {selectedFolderId === null && activeBoard && (
                <>
                  <div className="flex items-center gap-1 rounded-sm border border-[hsl(220_15%_14%)] bg-[hsl(220_15%_6%)] p-1">
                    {editingKey === `board:${activeBoard.id}` ? (
                      <input
                        autoFocus
                        value={editTitle}
                        onChange={e => setEditTitle(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={e => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") setEditingKey(null);
                        }}
                        className="min-w-0 flex-1 bg-transparent px-1 font-mono text-[9px] text-gold-300 outline-none"
                      />
                    ) : (
                      <span className="min-w-0 flex-1 truncate px-1 font-mono text-[8px] text-muted-foreground/60">{activeBoard.title}</span>
                    )}
                    <button
                      onClick={() => editingKey === `board:${activeBoard.id}` ? commitRename() : startRename(activeBoard)}
                      className="rounded p-1 text-muted-foreground hover:text-gold-400"
                      title="Rename selected node"
                    >
                      {editingKey === `board:${activeBoard.id}` ? <Check className="h-3 w-3" /> : <PenLine className="h-3 w-3" />}
                    </button>
                    <button
                      onClick={() => deleteBoard.mutate(activeBoard.id)}
                      className="rounded p-1 text-muted-foreground hover:text-rose-400"
                      title="Delete selected node"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                  <select
                    value={coreIdFor(activeBoard)}
                    onChange={e => {
                      const next = Number(e.target.value);
                      moveBoard.mutate({ id: activeBoard.id, folderId: next === UNFILED_ID ? null : next });
                    }}
                    className="w-full rounded-sm border border-[hsl(220_15%_14%)] bg-[hsl(220_15%_6%)] px-1.5 py-1 font-mono text-[8px] uppercase tracking-[0.1em] text-muted-foreground/80 outline-none"
                    title="File this board under a core"
                  >
                    <option value={UNFILED_ID}>Unfiled</option>
                    {folders.map(folder => (
                      <option key={folder.id} value={folder.id}>{folder.name}</option>
                    ))}
                  </select>
                </>
              )}

              <div className="flex gap-1.5">
                <button
                  onClick={() => createBoard.mutate()}
                  disabled={createBoard.isPending}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-sm border border-dashed px-2 py-2 font-mono text-[9px] uppercase tracking-[0.12em] transition-all hover:bg-[hsl(43_30%_8%)]"
                  style={{ borderColor: graphAccent, color: graphAccent }}
                  title={selectedFolder ? `New ${label} in ${selectedFolder.name}` : `New ${label}`}
                >
                  {createBoard.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                  {label}
                </button>
                <button
                  onClick={() => createFolder.mutate()}
                  disabled={createFolder.isPending}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-sm border border-dashed border-[hsl(220_15%_20%)] px-2 py-2 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground/70 transition-all hover:border-[hsl(220_15%_32%)] hover:text-foreground"
                  title="New core"
                >
                  {createFolder.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <FolderPlus className="h-3 w-3" />}
                  Core
                </button>
              </div>
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
                  {editingKey === `board:${board.id}` ? (
                    <input
                      autoFocus
                      value={editTitle}
                      onChange={e => setEditTitle(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={e => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") setEditingKey(null);
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
                      {editingKey === `board:${board.id}`
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

      {coreMenu && (
        <CoreMenu
          folder={coreMenu.folder}
          x={coreMenu.x}
          y={coreMenu.y}
          onClose={() => setCoreMenu(null)}
          onColor={color => updateFolder.mutate({ id: coreMenu.folder.id, patch: { color } })}
          onRename={() => { setEditingKey(`folder:${coreMenu.folder.id}`); setEditTitle(coreMenu.folder.name); }}
          onDelete={() => deleteFolder.mutate(coreMenu.folder.id)}
        />
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
