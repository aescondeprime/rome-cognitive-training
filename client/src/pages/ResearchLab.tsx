/**
 * ResearchLab — Investigative node research collection tool.
 *
 * Sidebar: renamable/collapsible folders; each folder holds any mix of
 *   Science Boards and Experiment Boards.
 *
 * Science Board  — link research articles, draw conclusions per article,
 *                  tag by evidence strength.
 *
 * Experiment Board — freeform canvas (like ComponentBoard) with draggable,
 *   resizable cards for each experiment component.
 *   Components: Question · Hypothesis · IV · DV · CV ·
 *               Materials · Method · Results · Analysis ·
 *               Conclusion · Limitations · References
 */

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Plus, Trash2, PenLine, ChevronLeft, Check, Loader2,
  BookOpen, FlaskConical, ExternalLink, X, ChevronDown,
  ChevronRight, Link2, FolderPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { ConstellationSidebar, type ConstellationNavNode } from "@/components/ConstellationNavigator";

// ── Types ──────────────────────────────────────────────────────────────────
type BoardType = "science_board" | "experiment_board";

interface Board {
  id: number;
  type: BoardType;
  title: string;
  created_at: number;
  updated_at: number;
}

interface Article {
  id: number;
  board_id: number;
  title: string;
  authors: string;
  year: string;
  url: string;
  abstract: string;
  tags: string;
}

type Strength = "strong" | "moderate" | "weak" | "speculative";

interface Conclusion {
  id: number;
  article_id: number;
  board_id: number;
  content: string;
  strength: Strength;
}

interface ExpSection {
  id: number;
  board_id: number;
  section_key: string;
  content: string;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
}

// Folder structure stored in localStorage
interface LabFolder {
  id: string;
  name: string;
  boardIds: number[];
  open: boolean;
}

// ── Config ─────────────────────────────────────────────────────────────────
const ACCENT_SCIENCE    = "hsl(210 65% 62%)";
const ACCENT_EXPERIMENT = "hsl(145 55% 50%)";
const FOLDERS_KEY       = "rome_research_folders_v1";

const STRENGTH_CONFIG: Record<Strength, { label: string; color: string; bg: string; border: string }> = {
  strong:     { label: "Strong",      color: "hsl(145 55% 55%)", bg: "hsl(145 30% 7%)",  border: "hsl(145 30% 20%)" },
  moderate:   { label: "Moderate",    color: "hsl(38 75% 58%)",  bg: "hsl(38 35% 7%)",   border: "hsl(38 35% 20%)" },
  weak:       { label: "Weak",        color: "hsl(0 55% 58%)",   bg: "hsl(0 30% 7%)",    border: "hsl(0 30% 20%)"  },
  speculative:{ label: "Speculative", color: "hsl(270 55% 62%)", bg: "hsl(270 25% 7%)",  border: "hsl(270 25% 20%)" },
};

// Experiment card types — each is a draggable card on the canvas
const EXP_TYPES: Record<string, { label: string; shortLabel: string; color: string; bg: string; border: string; header: string }> = {
  question:    { label: "Research Question", shortLabel: "Question",    color: "hsl(210 65% 68%)", bg: "hsl(210 35% 7%)",  border: "hsl(210 40% 24%)", header: "hsl(210 35% 11%)" },
  hypothesis:  { label: "Hypothesis",        shortLabel: "Hypothesis",  color: "hsl(270 60% 72%)", bg: "hsl(270 35% 7%)",  border: "hsl(270 40% 24%)", header: "hsl(270 35% 11%)" },
  iv:          { label: "Independent Var.",  shortLabel: "Indep. Var.", color: "hsl(38 80% 65%)",  bg: "hsl(38 35% 7%)",   border: "hsl(38 40% 24%)",  header: "hsl(38 35% 11%)"  },
  dv:          { label: "Dependent Var.",    shortLabel: "Dep. Var.",   color: "hsl(0 60% 65%)",   bg: "hsl(0 35% 7%)",    border: "hsl(0 40% 24%)",   header: "hsl(0 35% 11%)"   },
  cv:          { label: "Controlled Vars.",  shortLabel: "Control",     color: "hsl(175 55% 58%)", bg: "hsl(175 30% 6%)",  border: "hsl(175 35% 22%)", header: "hsl(175 30% 10%)" },
  materials:   { label: "Materials",         shortLabel: "Materials",   color: "hsl(var(--accent-h) 70% 62%)",  bg: "hsl(var(--accent-h) 30% 6%)",   border: "hsl(var(--accent-h) 35% 22%)",  header: "hsl(var(--accent-h) 30% 10%)"  },
  method:      { label: "Method",            shortLabel: "Method",      color: "hsl(145 55% 55%)", bg: "hsl(145 28% 6%)",  border: "hsl(145 32% 20%)", header: "hsl(145 28% 9%)"  },
  results:     { label: "Results",           shortLabel: "Results",     color: "hsl(195 60% 60%)", bg: "hsl(195 30% 6%)",  border: "hsl(195 35% 20%)", header: "hsl(195 30% 9%)"  },
  analysis:    { label: "Analysis",          shortLabel: "Analysis",    color: "hsl(240 50% 70%)", bg: "hsl(240 30% 7%)",  border: "hsl(240 35% 22%)", header: "hsl(240 30% 10%)" },
  conclusion:  { label: "Conclusion",        shortLabel: "Conclusion",  color: "hsl(145 60% 60%)", bg: "hsl(145 30% 7%)",  border: "hsl(145 36% 22%)", header: "hsl(145 30% 10%)" },
  limitations: { label: "Limitations",       shortLabel: "Limits",      color: "hsl(20 65% 62%)",  bg: "hsl(20 30% 7%)",   border: "hsl(20 35% 22%)",  header: "hsl(20 30% 10%)"  },
  references:  { label: "References",        shortLabel: "References",  color: "hsl(220 45% 65%)", bg: "hsl(220 28% 7%)",  border: "hsl(220 32% 22%)", header: "hsl(220 28% 10%)" },
};

const EXP_TYPE_ORDER = Object.keys(EXP_TYPES);

const PLACEHOLDERS: Record<string, string> = {
  question:    "What are you trying to find out?",
  hypothesis:  "If… then… because… (testable prediction)",
  iv:          "What you will deliberately change or manipulate",
  dv:          "What you will measure or observe as a result",
  cv:          "What you will keep constant to ensure a fair test",
  materials:   "List everything needed to run the experiment",
  method:      "Step-by-step description of how you'll run it",
  results:     "Record raw data, observations, measurements",
  analysis:    "Interpret the data — patterns, statistics, comparisons",
  conclusion:  "Did results support the hypothesis? What does it mean?",
  limitations: "What could have affected results? How to improve?",
  references:  "Papers, sources, or prior work that informed this",
};

// ── Shared helpers ─────────────────────────────────────────────────────────
const inputCls = "w-full bg-[hsl(220_15%_5%)] border border-[hsl(220_15%_15%)] rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-[hsl(210_40%_30%)] transition-colors placeholder:text-muted-foreground/35";
const labelCls = "block text-[9px] font-mono tracking-widest uppercase text-muted-foreground mb-1.5";

// ── Folder persistence ─────────────────────────────────────────────────────
function loadFolders(): LabFolder[] {
  try { return JSON.parse(localStorage.getItem(FOLDERS_KEY) ?? "[]"); } catch { return []; }
}
function saveFolders(folders: LabFolder[]) {
  localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
}
function genId() { return Math.random().toString(36).slice(2, 10); }

// ── Corner resize ──────────────────────────────────────────────────────────
type Corner = "nw" | "ne" | "sw" | "se";
const CORNER_POS: Record<Corner, React.CSSProperties> = {
  nw: { top: -4, left: -4, cursor: "nw-resize" },
  ne: { top: -4, right: -4, cursor: "ne-resize" },
  sw: { bottom: -4, left: -4, cursor: "sw-resize" },
  se: { bottom: -4, right: -4, cursor: "se-resize" },
};
function ResizeHandles({ onStart, color }: { onStart: (c: Corner, e: React.MouseEvent) => void; color: string }) {
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

// ══════════════════════════════════════════════════════════════════════════
// SIDEBAR
// ══════════════════════════════════════════════════════════════════════════
interface SidebarProps {
  boards: Board[];
  isLoading: boolean;
  activeBoardId: number | null;
  onSelect: (id: number) => void;
  onNew: (type: BoardType, folderId: string) => void;
  creating: boolean;
}

function Sidebar({ boards, isLoading, activeBoardId, onSelect, onNew, creating }: SidebarProps) {
  const [collapsed, setCollapsed]   = useState(false);
  const [folders,   setFolders]     = useState<LabFolder[]>(loadFolders);
  const [selectedGraphId, setSelectedGraphId] = useState("lab:root");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal,  setRenameVal]  = useState("");
  // board rename
  const [boardRenameId, setBoardRenameId] = useState<number | null>(null);
  const [boardRenameVal, setBoardRenameVal] = useState("");
  const qc = useQueryClient();

  const renameBoard = useMutation({
    mutationFn: ({ id, title }: { id: number; title: string }) => apiRequest("PATCH", `/api/boards/${id}`, { title }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/research-boards"] }),
  });
  const deleteBoard = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/boards/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/research-boards"] }),
  });

  const persist = (next: LabFolder[]) => { setFolders(next); saveFolders(next); };

  const addFolder = () => {
    const folder: LabFolder = { id: genId(), name: "New Folder", boardIds: [], open: true };
    const next = [...folders, folder];
    persist(next);
    setSelectedGraphId(`folder:${folder.id}`);
    setRenamingId(folder.id);
    setRenameVal(folder.name);
  };

  const deleteFolder = (id: string) => {
    persist(folders.filter(f => f.id !== id));
  };

  const commitRename = (id: string) => {
    persist(folders.map(f => f.id === id ? { ...f, name: renameVal.trim() || f.name } : f));
    setRenamingId(null);
  };

  const removeBoardFromFolder = (folderId: string, boardId: number) => {
    persist(folders.map(f => f.id === folderId ? { ...f, boardIds: f.boardIds.filter(b => b !== boardId) } : f));
  };

  const handleNewBoard = (type: BoardType, folderId: string) => {
    onNew(type, folderId);
  };

  useEffect(() => {
    if (activeBoardId !== null) setSelectedGraphId(`board:${activeBoardId}`);
  }, [activeBoardId]);

  useEffect(() => {
    const syncFolders = (event: StorageEvent) => {
      if (event.key === FOLDERS_KEY) setFolders(loadFolders());
    };
    window.addEventListener("storage", syncFolders);
    return () => window.removeEventListener("storage", syncFolders);
  }, []);

  const hubId = "lab:root";
  const boardsInFoldersNow = useMemo(
    () => new Set(folders.flatMap(folder => folder.boardIds)),
    [folders],
  );
  const unfiledBoards = useMemo(
    () => boards.filter(board => !boardsInFoldersNow.has(board.id)),
    [boards, boardsInFoldersNow],
  );
  const graphNodes: ConstellationNavNode[] = useMemo(() => [
      {
        id: hubId,
        label: "Research Core",
        group: "folders",
        color: "hsl(190 72% 58%)",
        kind: "hub",
        weight: 8,
        subtitle: "Investigative knowledge map",
      },
      ...folders.map(folder => ({
        id: `folder:${folder.id}`,
        label: folder.name,
        group: "folders",
        color: "hsl(190 52% 56%)",
        kind: "folder" as const,
        weight: Math.max(2, folder.boardIds.length + 1),
        subtitle: `${folder.boardIds.length} linked boards`,
      })),
      ...boards.map(board => ({
        id: `board:${board.id}`,
        label: board.title,
        group: board.type === "science_board" ? "science" : "experiments",
        color: board.type === "science_board" ? ACCENT_SCIENCE : ACCENT_EXPERIMENT,
        kind: "item" as const,
        weight: activeBoardId === board.id ? 5 : 2,
        subtitle: board.type === "science_board" ? "Science board" : "Experiment board",
      })),
    ], [activeBoardId, boards, folders]);
  const graphLinks = useMemo(() => [
      ...folders.map(folder => ({ source: hubId, target: `folder:${folder.id}` })),
      ...folders.flatMap(folder => folder.boardIds
        .filter(boardId => boards.some(board => board.id === boardId))
        .map(boardId => ({ source: `folder:${folder.id}`, target: `board:${boardId}` }))),
      ...unfiledBoards.map(board => ({ source: hubId, target: `board:${board.id}` })),
    ], [boards, folders, unfiledBoards]);

  const selectedFolder = selectedGraphId.startsWith("folder:")
    ? folders.find(folder => folder.id === selectedGraphId.slice(7))
    : undefined;
  const selectedBoard = selectedGraphId.startsWith("board:")
    ? boards.find(board => board.id === Number(selectedGraphId.slice(6)))
    : undefined;
  const boardFolder = selectedBoard
    ? folders.find(folder => folder.boardIds.includes(selectedBoard.id))
    : undefined;

  const moveBoard = (boardId: number, folderId: string) => {
    persist(folders.map(folder => {
      const without = folder.boardIds.filter(id => id !== boardId);
      return folder.id === folderId ? { ...folder, boardIds: [...without, boardId] } : { ...folder, boardIds: without };
    }));
  };

  const commitSelectedBoardRename = () => {
    if (boardRenameId && boardRenameVal.trim()) {
      renameBoard.mutate({ id: boardRenameId, title: boardRenameVal.trim() });
    }
    setBoardRenameId(null);
  };

  return (
    <ConstellationSidebar
      title="Research Lab"
      accent="hsl(190 72% 58%)"
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
      loading={isLoading}
      nodes={graphNodes}
      links={graphLinks}
      groups={[
        { id: "folders", label: "Folders", color: "hsl(190 52% 56%)" },
        { id: "science", label: "Science", color: ACCENT_SCIENCE },
        { id: "experiments", label: "Experiments", color: ACCENT_EXPERIMENT },
      ]}
      activeId={selectedGraphId}
      onSelect={id => {
        setSelectedGraphId(id);
        if (id.startsWith("board:")) onSelect(Number(id.slice(6)));
      }}
      emptyLabel="No research boards yet"
      headerActions={(
        <button
          onClick={addFolder}
          className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
          title="New folder node"
        >
          <FolderPlus className="h-3.5 w-3.5" />
        </button>
      )}
      collapsedAction={(
        <div className="space-y-1">
          <button onClick={addFolder} className="flex w-full justify-center rounded p-2 text-muted-foreground hover:bg-[hsl(220_15%_8%)] hover:text-foreground" title="New folder">
            <FolderPlus className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => onNew("science_board", "")} className="flex w-full justify-center rounded p-2 hover:bg-[hsl(220_15%_8%)]" style={{ color: ACCENT_SCIENCE }} title="New science board">
            <BookOpen className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => onNew("experiment_board", "")} className="flex w-full justify-center rounded p-2 hover:bg-[hsl(220_15%_8%)]" style={{ color: ACCENT_EXPERIMENT }} title="New experiment board">
            <FlaskConical className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      footer={(
        <div className="space-y-1.5">
          {selectedFolder && (
            <div className="rounded-sm border border-[hsl(190_30%_18%)] bg-[hsl(220_15%_6%)] p-1.5">
              <div className="flex items-center gap-1">
                {renamingId === selectedFolder.id ? (
                  <input
                    autoFocus
                    value={renameVal}
                    onChange={e => setRenameVal(e.target.value)}
                    onBlur={() => commitRename(selectedFolder.id)}
                    onKeyDown={e => {
                      if (e.key === "Enter") commitRename(selectedFolder.id);
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    className="min-w-0 flex-1 bg-transparent px-1 font-mono text-[9px] text-foreground outline-none"
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate px-1 font-mono text-[8px] text-muted-foreground/60">{selectedFolder.name}</span>
                )}
                <button
                  onClick={() => {
                    if (renamingId === selectedFolder.id) commitRename(selectedFolder.id);
                    else {
                      setRenamingId(selectedFolder.id);
                      setRenameVal(selectedFolder.name);
                    }
                  }}
                  className="rounded p-1 text-muted-foreground hover:text-foreground"
                  title="Rename folder node"
                >
                  {renamingId === selectedFolder.id ? <Check className="h-3 w-3" /> : <PenLine className="h-3 w-3" />}
                </button>
                <button
                  onClick={() => {
                    deleteFolder(selectedFolder.id);
                    setSelectedGraphId(hubId);
                  }}
                  className="rounded p-1 text-muted-foreground hover:text-rose-400"
                  title="Delete folder node"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
              {unfiledBoards.length > 0 && (
                <select
                  defaultValue=""
                  onChange={e => {
                    if (e.target.value) moveBoard(Number(e.target.value), selectedFolder.id);
                    e.currentTarget.value = "";
                  }}
                  className="mt-1.5 h-7 w-full rounded-sm border border-[hsl(220_15%_15%)] bg-[hsl(220_15%_7%)] px-2 font-mono text-[8px] text-muted-foreground outline-none"
                  aria-label="Link an unfiled board to selected folder"
                >
                  <option value="">Link existing board…</option>
                  {unfiledBoards.map(board => <option key={board.id} value={board.id}>{board.title}</option>)}
                </select>
              )}
            </div>
          )}

          {selectedBoard && (
            <div className="rounded-sm border border-[hsl(220_15%_14%)] bg-[hsl(220_15%_6%)] p-1.5">
              <div className="flex items-center gap-1">
                {boardRenameId === selectedBoard.id ? (
                  <input
                    autoFocus
                    value={boardRenameVal}
                    onChange={e => setBoardRenameVal(e.target.value)}
                    onBlur={commitSelectedBoardRename}
                    onKeyDown={e => {
                      if (e.key === "Enter") commitSelectedBoardRename();
                      if (e.key === "Escape") setBoardRenameId(null);
                    }}
                    className="min-w-0 flex-1 bg-transparent px-1 font-mono text-[9px] outline-none"
                    style={{ color: selectedBoard.type === "science_board" ? ACCENT_SCIENCE : ACCENT_EXPERIMENT }}
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate px-1 font-mono text-[8px] text-muted-foreground/60">{selectedBoard.title}</span>
                )}
                <button
                  onClick={() => {
                    if (boardRenameId === selectedBoard.id) commitSelectedBoardRename();
                    else {
                      setBoardRenameId(selectedBoard.id);
                      setBoardRenameVal(selectedBoard.title);
                    }
                  }}
                  className="rounded p-1 text-muted-foreground hover:text-foreground"
                  title="Rename board node"
                >
                  {boardRenameId === selectedBoard.id ? <Check className="h-3 w-3" /> : <PenLine className="h-3 w-3" />}
                </button>
                {boardFolder && (
                  <button
                    onClick={() => removeBoardFromFolder(boardFolder.id, selectedBoard.id)}
                    className="rounded p-1 text-muted-foreground hover:text-amber-400"
                    title="Unlink from folder"
                  >
                    <Link2 className="h-3 w-3" />
                  </button>
                )}
                <button
                  onClick={() => {
                    deleteBoard.mutate(selectedBoard.id);
                    setSelectedGraphId(hubId);
                  }}
                  className="rounded p-1 text-muted-foreground hover:text-rose-400"
                  title="Delete board node"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
              {!boardFolder && folders.length > 0 && (
                <select
                  defaultValue=""
                  onChange={e => {
                    if (e.target.value) moveBoard(selectedBoard.id, e.target.value);
                    e.currentTarget.value = "";
                  }}
                  className="mt-1.5 h-7 w-full rounded-sm border border-[hsl(220_15%_15%)] bg-[hsl(220_15%_7%)] px-2 font-mono text-[8px] text-muted-foreground outline-none"
                  aria-label="Link selected board to folder"
                >
                  <option value="">Link to folder…</option>
                  {folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                </select>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => handleNewBoard("science_board", selectedFolder?.id ?? "")}
              disabled={creating}
              className="flex items-center justify-center gap-1 rounded-sm border border-dashed px-2 py-2 font-mono text-[8px] uppercase tracking-wide hover:bg-[hsl(210_30%_9%)] disabled:opacity-50"
              style={{ borderColor: ACCENT_SCIENCE, color: ACCENT_SCIENCE }}
            >
              {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <BookOpen className="h-3 w-3" />}
              Science
            </button>
            <button
              onClick={() => handleNewBoard("experiment_board", selectedFolder?.id ?? "")}
              disabled={creating}
              className="flex items-center justify-center gap-1 rounded-sm border border-dashed px-2 py-2 font-mono text-[8px] uppercase tracking-wide hover:bg-[hsl(145_30%_9%)] disabled:opacity-50"
              style={{ borderColor: ACCENT_EXPERIMENT, color: ACCENT_EXPERIMENT }}
            >
              {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <FlaskConical className="h-3 w-3" />}
              Experiment
            </button>
          </div>
        </div>
      )}
    />
  );
}

// ══════════════════════════════════════════════════════════════════════════
// EXPERIMENT CARD (draggable + resizable)
// ══════════════════════════════════════════════════════════════════════════
interface ExpCardProps {
  sec: ExpSection;
  onUpdate: (id: number, patch: Partial<ExpSection>) => void;
  onDelete: (id: number) => void;
  boardRef: React.RefObject<HTMLDivElement>;
}

function ExpCard({ sec, onUpdate, onDelete, boardRef }: ExpCardProps) {
  const conf = EXP_TYPES[sec.section_key] ?? EXP_TYPES.question;
  const [editing, setEditing]     = useState(false);
  const [draft,   setDraft]       = useState(sec.content);
  const [pos,     setPos]         = useState({ x: sec.pos_x, y: sec.pos_y });
  const [size,    setSize]        = useState({ w: sec.width || 260, h: sec.height || 0 });
  const dragRef   = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const resizeRef = useRef<{ sx: number; sy: number; ow: number; oh: number; ox: number; oy: number; corner: Corner } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const MIN_W = 180, MIN_H = 100;

  useEffect(() => { setPos({ x: sec.pos_x, y: sec.pos_y }); }, [sec.pos_x, sec.pos_y]);
  useEffect(() => { setSize({ w: sec.width || 260, h: sec.height || 0 }); }, [sec.width, sec.height]);
  useEffect(() => { setDraft(sec.content); }, [sec.content]);

  const handleContentChange = (val: string) => {
    setDraft(val);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { onUpdate(sec.id, { content: val }); }, 700);
  };

  // ── move ──
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || editing) return;
    e.preventDefault();
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };
    const mm = (ev: MouseEvent) => {
      if (!dragRef.current || !boardRef.current) return;
      const b = boardRef.current.getBoundingClientRect();
      const nx = Math.max(0, Math.min(b.width - size.w - 4, dragRef.current.ox + ev.clientX - dragRef.current.sx));
      const ny = Math.max(0, dragRef.current.oy + ev.clientY - dragRef.current.sy);
      setPos({ x: nx, y: ny });
    };
    const mu = (ev: MouseEvent) => {
      if (!dragRef.current || !boardRef.current) return;
      const b = boardRef.current.getBoundingClientRect();
      const nx = Math.max(0, Math.min(b.width - size.w - 4, dragRef.current.ox + ev.clientX - dragRef.current.sx));
      const ny = Math.max(0, dragRef.current.oy + ev.clientY - dragRef.current.sy);
      dragRef.current = null;
      onUpdate(sec.id, { pos_x: nx, pos_y: ny });
      window.removeEventListener("mousemove", mm);
      window.removeEventListener("mouseup", mu);
    };
    window.addEventListener("mousemove", mm);
    window.addEventListener("mouseup", mu);
  };

  // ── resize ──
  const startResize = (corner: Corner, e: React.MouseEvent) => {
    e.preventDefault();
    const initH = size.h > 0 ? size.h : (e.currentTarget.closest("[data-exp-id]") as HTMLElement)?.offsetHeight ?? 160;
    resizeRef.current = { sx: e.clientX, sy: e.clientY, ow: size.w, oh: initH, ox: pos.x, oy: pos.y, corner };
    const mm = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const { sx, sy, ow, oh, ox, oy, corner } = resizeRef.current;
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      let nw = ow, nh = oh, nx = ox, ny = oy;
      if (corner === "se") { nw = Math.max(MIN_W, ow + dx); nh = Math.max(MIN_H, oh + dy); }
      if (corner === "sw") { const t = Math.max(MIN_W, ow - dx); nx = ox + (ow - t); nw = t; nh = Math.max(MIN_H, oh + dy); }
      if (corner === "ne") { nw = Math.max(MIN_W, ow + dx); const t = Math.max(MIN_H, oh - dy); ny = oy + (oh - t); nh = t; }
      if (corner === "nw") { const tw = Math.max(MIN_W, ow - dx); nx = ox + (ow - tw); nw = tw; const th = Math.max(MIN_H, oh - dy); ny = oy + (oh - th); nh = th; }
      setSize({ w: nw, h: nh });
      setPos({ x: Math.max(0, nx), y: Math.max(0, ny) });
    };
    const mu = () => {
      if (!resizeRef.current) return;
      resizeRef.current = null;
      setSize(s => { setPos(p => { onUpdate(sec.id, { width: s.w, height: s.h, pos_x: p.x, pos_y: p.y }); return p; }); return s; });
      window.removeEventListener("mousemove", mm);
      window.removeEventListener("mouseup", mu);
    };
    window.addEventListener("mousemove", mm);
    window.addEventListener("mouseup", mu);
  };

  const hasH = size.h > 0;

  return (
    <div
      data-exp-id={sec.id}
      className="absolute rounded-xl border select-none group flex flex-col"
      style={{
        left: pos.x, top: pos.y, width: size.w, height: hasH ? size.h : undefined,
        background: conf.bg, borderColor: conf.border, zIndex: editing ? 100 : 10,
        cursor: editing ? "auto" : "grab",
      }}
      onMouseDown={onMouseDown}
    >
      <ResizeHandles onStart={startResize} color={conf.border} />

      {/* Header */}
      <div
        className="flex items-center justify-between px-2.5 py-2 rounded-t-xl shrink-0"
        style={{ background: conf.header, borderBottom: `1px solid ${conf.border}` }}
      >
        <span className="text-[10px] font-mono tracking-widest uppercase" style={{ color: conf.color }}>
          {conf.shortLabel}
        </span>
        <button
          onMouseDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onDelete(sec.id); }}
          className="p-0.5 rounded text-muted-foreground/40 hover:text-rose-400 transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Body */}
      <div
        className="p-2.5 flex-1 overflow-auto"
        onDoubleClick={() => setEditing(true)}
        onMouseDown={e => { if (editing) e.stopPropagation(); }}
      >
        <textarea
          value={draft}
          onChange={e => handleContentChange(e.target.value)}
          onFocus={() => setEditing(true)}
          onBlur={() => setEditing(false)}
          placeholder={PLACEHOLDERS[sec.section_key] ?? ""}
          className="w-full h-full bg-transparent resize-none outline-none text-sm leading-relaxed"
          style={{ color: conf.color, minHeight: 60, opacity: draft || editing ? 1 : 0.7 }}
          onMouseDown={e => e.stopPropagation()}
        />
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// EXPERIMENT BOARD VIEW
// ══════════════════════════════════════════════════════════════════════════
function ExperimentBoardView({ board }: { board: Board }) {
  const qc = useQueryClient();
  const boardRef = useRef<HTMLDivElement>(null);
  const secQK = ["/boards", board.id, "experiment-sections"];

  const { data: sections = [], isLoading } = useQuery<ExpSection[]>({
    queryKey: secQK,
    queryFn: () => apiRequest("GET", `/api/boards/${board.id}/experiment-sections`).then(r => r.json()),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: secQK });

  const createSec = useMutation({
    mutationFn: (body: object) => apiRequest("POST", `/api/boards/${board.id}/experiment-sections`, body).then(r => r.json()),
    onSuccess: invalidate,
  });

  const updateSec = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<ExpSection> }) =>
      apiRequest("PATCH", `/api/experiment-sections/${id}`, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: secQK });
      const prev = qc.getQueryData<ExpSection[]>(secQK);
      qc.setQueryData<ExpSection[]>(secQK, old => (old ?? []).map(s => s.id === id ? { ...s, ...patch } : s));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(secQK, ctx.prev); },
    onSettled: invalidate,
  });

  const deleteSec = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/experiment-sections/${id}`),
    onMutate: async id => {
      await qc.cancelQueries({ queryKey: secQK });
      const prev = qc.getQueryData<ExpSection[]>(secQK);
      qc.setQueryData<ExpSection[]>(secQK, old => (old ?? []).filter(s => s.id !== id));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(secQK, ctx.prev); },
    onSettled: invalidate,
  });

  const addCard = (type: string) => {
    const off = (sections.length % 6) * 24;
    createSec.mutate({ section_key: type, content: "", pos_x: 40 + off, pos_y: 40 + off, width: 260, height: 0 });
  };

  const handleUpdate = useCallback((id: number, patch: Partial<ExpSection>) => {
    updateSec.mutate({ id, patch });
  }, [updateSec]);

  const handleDelete = useCallback((id: number) => { deleteSec.mutate(id); }, [deleteSec]);

  const canvasMinH = Math.max(560, ...sections.map(s => s.pos_y + (s.height || 200) + 60));

  if (isLoading) return (
    <div className="flex items-center justify-center h-48">
      <Loader2 className="w-5 h-5 animate-spin opacity-30" style={{ color: ACCENT_EXPERIMENT }} />
    </div>
  );

  return (
    <div className="p-4 space-y-3 h-full flex flex-col">
      {/* Header + toolbar */}
      <div className="shrink-0 space-y-2">
        <div className="flex items-center gap-3">
          <h2
            className="text-base font-bold tracking-widest uppercase"
            style={{ fontFamily: "Cinzel, serif", color: ACCENT_EXPERIMENT }}
          >
            {board.title}
          </h2>
          <span className="text-[10px] font-mono text-muted-foreground opacity-50">Experiment Board</span>
        </div>

        {/* Component type buttons */}
        <div className="flex flex-wrap gap-1.5">
          {EXP_TYPE_ORDER.map(type => {
            const c = EXP_TYPES[type];
            return (
              <button
                key={type}
                onClick={() => addCard(type)}
                disabled={createSec.isPending}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-mono transition-all hover:opacity-80"
                style={{ border: `1px solid ${c.border}`, color: c.color, background: "transparent" }}
                title={`Add ${c.label}`}
              >
                <Plus className="w-3 h-3" />
                {c.shortLabel}
              </button>
            );
          })}
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={boardRef}
        className="relative flex-1 rounded-xl border border-border"
        style={{ background: "hsl(220 15% 6%)", minHeight: canvasMinH }}
      >
        {sections.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground pointer-events-none">
            <FlaskConical className="w-10 h-10 opacity-8" />
            <p className="text-sm opacity-30">Add experiment components above to get started</p>
          </div>
        )}
        {sections.map(s => (
          <ExpCard
            key={s.id}
            sec={s}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
            boardRef={boardRef}
          />
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// ARTICLE FORM
// ══════════════════════════════════════════════════════════════════════════
interface ArticleFormProps {
  initial?: Article;
  onSave: (data: Omit<Article, "id" | "board_id">) => void;
  onCancel: () => void;
  saving: boolean;
}

function ArticleForm({ initial, onSave, onCancel, saving }: ArticleFormProps) {
  const [form, setForm] = useState({
    title: initial?.title ?? "",
    authors: initial?.authors ?? "",
    year: initial?.year ?? "",
    url: initial?.url ?? "",
    abstract: initial?.abstract ?? "",
    tags: initial?.tags ?? "",
  });
  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(v => ({ ...v, [k]: e.target.value }));

  return (
    <div className="rounded-xl border border-[hsl(210_40%_18%)] p-4 space-y-3" style={{ background: "hsl(220 15% 6%)" }}>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-mono tracking-widest uppercase" style={{ color: ACCENT_SCIENCE }}>
          {initial ? "Edit Article" : "Add Article"}
        </h3>
        <button onClick={onCancel} className="text-muted-foreground hover:text-foreground transition-colors"><X className="w-3.5 h-3.5" /></button>
      </div>
      <div>
        <label className={labelCls}>Title *</label>
        <input value={form.title} onChange={f("title")} className={inputCls} placeholder="Article title" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Authors</label>
          <input value={form.authors} onChange={f("authors")} className={inputCls} placeholder="Author(s)" />
        </div>
        <div>
          <label className={labelCls}>Year</label>
          <input value={form.year} onChange={f("year")} className={inputCls} placeholder="2024" />
        </div>
      </div>
      <div>
        <label className={labelCls}>URL / DOI</label>
        <input value={form.url} onChange={f("url")} className={inputCls} placeholder="https://..." />
      </div>
      <div>
        <label className={labelCls}>Abstract / Summary</label>
        <textarea value={form.abstract} onChange={f("abstract")} className={cn(inputCls, "resize-none")} rows={3} placeholder="Paste the abstract or write a summary…" />
      </div>
      <div>
        <label className={labelCls}>Tags</label>
        <input value={form.tags} onChange={f("tags")} className={inputCls} placeholder="memory, working memory, RCT…" />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
        <button
          onClick={() => onSave(form)}
          disabled={saving || !form.title.trim()}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-mono transition-all disabled:opacity-40"
          style={{ background: "hsl(210 40% 14%)", color: ACCENT_SCIENCE, border: `1px solid hsl(210 40% 24%)` }}
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
          Save
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// CONCLUSION ROW
// ══════════════════════════════════════════════════════════════════════════
function ConclusionRow({ c, onDelete, onPatch }: {
  c: Conclusion;
  onDelete: (id: number) => void;
  onPatch: (id: number, patch: Partial<Conclusion>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.content);
  const sc = STRENGTH_CONFIG[c.strength] ?? STRENGTH_CONFIG.moderate;
  const strengths: Strength[] = ["strong", "moderate", "weak", "speculative"];
  const save = () => { setEditing(false); if (draft !== c.content) onPatch(c.id, { content: draft }); };

  return (
    <div className="flex items-start gap-2 group">
      <button
        onClick={() => { const idx = strengths.indexOf(c.strength); onPatch(c.id, { strength: strengths[(idx + 1) % strengths.length] }); }}
        className="mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-mono shrink-0 transition-all hover:opacity-80"
        style={{ color: sc.color, background: sc.bg, border: `1px solid ${sc.border}` }}
        title="Click to change strength"
      >
        {sc.label}
      </button>
      {editing ? (
        <textarea
          autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={save}
          onKeyDown={e => { if (e.key === "Escape") { setEditing(false); setDraft(c.content); } }}
          className="flex-1 bg-transparent resize-none outline-none text-xs text-foreground/80 leading-relaxed border-b border-[hsl(210_40%_25%)]" rows={2}
        />
      ) : (
        <p className="flex-1 text-xs text-foreground/70 leading-relaxed cursor-text" onDoubleClick={() => setEditing(true)}>
          {c.content || <span className="opacity-30 italic">Double-click to write…</span>}
        </p>
      )}
      <button onClick={() => onDelete(c.id)} className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-muted-foreground hover:text-rose-400 transition-all shrink-0 mt-0.5">
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// ARTICLE CARD
// ══════════════════════════════════════════════════════════════════════════
function ArticleCard({ article, conclusions, onEdit, onDelete, onAddConclusion, onDeleteConclusion, onPatchConclusion }: {
  article: Article;
  conclusions: Conclusion[];
  onEdit: () => void;
  onDelete: () => void;
  onAddConclusion: (articleId: number) => void;
  onDeleteConclusion: (id: number) => void;
  onPatchConclusion: (id: number, patch: Partial<Conclusion>) => void;
}) {
  const [open, setOpen] = useState(false);
  const myConclusions = conclusions.filter(c => c.article_id === article.id);
  const tags = article.tags ? article.tags.split(",").map(t => t.trim()).filter(Boolean) : [];

  return (
    <motion.div layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      className="rounded-xl border border-[hsl(220_15%_12%)] overflow-hidden" style={{ background: "hsl(220 15% 7%)" }}>
      <div className="flex items-start gap-2.5 px-4 py-3 cursor-pointer hover:bg-[hsl(220_15%_9%)] transition-colors" onClick={() => setOpen(v => !v)}>
        {open ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate" style={{ fontFamily: "Cinzel, serif", color: "hsl(220 25% 82%)" }}>{article.title}</p>
          {(article.authors || article.year) && (
            <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">{[article.authors, article.year].filter(Boolean).join(" · ")}</p>
          )}
          {!open && tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {tags.slice(0, 4).map(t => (
                <span key={t} className="px-1.5 py-0.5 rounded text-[9px] font-mono" style={{ color: ACCENT_SCIENCE + "cc", background: "hsl(210 40% 9%)", border: `1px solid hsl(210 40% 18%)` }}>{t}</span>
              ))}
              {tags.length > 4 && <span className="text-[9px] text-muted-foreground">+{tags.length - 4}</span>}
            </div>
          )}
        </div>
        {myConclusions.length > 0 && (
          <span className="text-[10px] font-mono shrink-0 px-1.5 py-0.5 rounded" style={{ color: ACCENT_SCIENCE + "aa", background: "hsl(210 40% 9%)" }}>
            {myConclusions.length} {myConclusions.length === 1 ? "conclusion" : "conclusions"}
          </span>
        )}
        <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
          {article.url && (
            <a href={article.url} target="_blank" rel="noopener noreferrer" className="p-1 rounded text-muted-foreground hover:text-[hsl(210_65%_62%)] transition-colors">
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
          <button onClick={onEdit} className="p-1 rounded text-muted-foreground hover:text-[hsl(210_65%_62%)] transition-colors"><PenLine className="w-3.5 h-3.5" /></button>
          <button onClick={onDelete} className="p-1 rounded text-muted-foreground hover:text-rose-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
            <div className="px-4 pb-4 space-y-4 border-t border-[hsl(220_15%_11%)] pt-3">
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map(t => <span key={t} className="px-2 py-0.5 rounded text-[9px] font-mono" style={{ color: ACCENT_SCIENCE + "cc", background: "hsl(210 40% 9%)", border: `1px solid hsl(210 40% 18%)` }}>{t}</span>)}
                </div>
              )}
              {article.abstract && (
                <div>
                  <p className={labelCls}>Abstract / Summary</p>
                  <p className="text-xs text-foreground/60 leading-relaxed whitespace-pre-wrap">{article.abstract}</p>
                </div>
              )}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className={labelCls} style={{ marginBottom: 0 }}>Conclusions</p>
                  <button
                    onClick={() => onAddConclusion(article.id)}
                    className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded transition-all"
                    style={{ color: ACCENT_SCIENCE, background: "hsl(210 40% 9%)", border: `1px solid hsl(210 40% 20%)` }}
                  >
                    <Plus className="w-2.5 h-2.5" />
                    Add
                  </button>
                </div>
                <div className="space-y-2">
                  {myConclusions.length === 0
                    ? <p className="text-[10px] text-muted-foreground opacity-40 italic">No conclusions yet — click Add to draw one from this article.</p>
                    : myConclusions.map(c => <ConclusionRow key={c.id} c={c} onDelete={onDeleteConclusion} onPatch={onPatchConclusion} />)
                  }
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// SCIENCE BOARD VIEW
// ══════════════════════════════════════════════════════════════════════════
function ScienceBoardView({ board }: { board: Board }) {
  const qc = useQueryClient();
  const artQK  = ["/boards", board.id, "articles"];
  const concQK = ["/boards", board.id, "conclusions"];

  const { data: articles = [], isLoading: artLoading } = useQuery<Article[]>({
    queryKey: artQK,
    queryFn: () => apiRequest("GET", `/api/boards/${board.id}/articles`).then(r => r.json()),
  });
  const { data: conclusions = [] } = useQuery<Conclusion[]>({
    queryKey: concQK,
    queryFn: () => apiRequest("GET", `/api/boards/${board.id}/conclusions`).then(r => r.json()),
  });

  const invArt  = () => qc.invalidateQueries({ queryKey: artQK });
  const invConc = () => qc.invalidateQueries({ queryKey: concQK });

  const createArt = useMutation({ mutationFn: (body: object) => apiRequest("POST", `/api/boards/${board.id}/articles`, body).then(r => r.json()), onSuccess: invArt });
  const updateArt = useMutation({ mutationFn: ({ id, patch }: { id: number; patch: object }) => apiRequest("PATCH", `/api/articles/${id}`, patch), onSuccess: invArt });
  const deleteArt = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/articles/${id}`),
    onMutate: async id => { await qc.cancelQueries({ queryKey: artQK }); const prev = qc.getQueryData<Article[]>(artQK); qc.setQueryData<Article[]>(artQK, old => (old ?? []).filter(a => a.id !== id)); return { prev }; },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(artQK, ctx.prev); },
    onSettled: invArt,
  });
  const createConc = useMutation({ mutationFn: (body: object) => apiRequest("POST", `/api/boards/${board.id}/conclusions`, body).then(r => r.json()), onSuccess: invConc });
  const updateConc = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: object }) => apiRequest("PATCH", `/api/conclusions/${id}`, patch),
    onMutate: async ({ id, patch }) => { await qc.cancelQueries({ queryKey: concQK }); const prev = qc.getQueryData<Conclusion[]>(concQK); qc.setQueryData<Conclusion[]>(concQK, old => (old ?? []).map(c => c.id === id ? { ...c, ...patch as Conclusion } : c)); return { prev }; },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(concQK, ctx.prev); },
    onSettled: invConc,
  });
  const deleteConc = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/conclusions/${id}`),
    onMutate: async id => { await qc.cancelQueries({ queryKey: concQK }); const prev = qc.getQueryData<Conclusion[]>(concQK); qc.setQueryData<Conclusion[]>(concQK, old => (old ?? []).filter(c => c.id !== id)); return { prev }; },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(concQK, ctx.prev); },
    onSettled: invConc,
  });

  const [showForm, setShowForm]     = useState(false);
  const [editTarget, setEditTarget] = useState<Article | null>(null);

  const handleSave = (data: Omit<Article, "id" | "board_id">) => {
    if (editTarget) { updateArt.mutate({ id: editTarget.id, patch: data }, { onSuccess: () => setEditTarget(null) }); }
    else { createArt.mutate(data, { onSuccess: () => setShowForm(false) }); }
  };

  if (artLoading) return <div className="flex items-center justify-center h-48"><Loader2 className="w-5 h-5 animate-spin opacity-30" style={{ color: ACCENT_SCIENCE }} /></div>;

  return (
    <div className="p-5 space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold tracking-widest uppercase" style={{ fontFamily: "Cinzel, serif", color: ACCENT_SCIENCE }}>{board.title}</h2>
          <p className="text-[10px] font-mono text-muted-foreground mt-0.5">Science Board · {articles.length} article{articles.length !== 1 ? "s" : ""}</p>
        </div>
        {!showForm && !editTarget && (
          <button onClick={() => setShowForm(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono transition-all"
            style={{ border: `1px solid ${ACCENT_SCIENCE}40`, color: ACCENT_SCIENCE, background: `${ACCENT_SCIENCE}10` }}>
            <Plus className="w-3.5 h-3.5" />Add Article
          </button>
        )}
      </div>
      <AnimatePresence>
        {(showForm || editTarget) && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
            <ArticleForm initial={editTarget ?? undefined} onSave={handleSave} onCancel={() => { setShowForm(false); setEditTarget(null); }} saving={createArt.isPending || updateArt.isPending} />
          </motion.div>
        )}
      </AnimatePresence>
      {articles.length === 0 && !showForm && (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
          <BookOpen className="w-10 h-10 opacity-10" />
          <p className="text-sm opacity-40">Add your first research article</p>
        </div>
      )}
      <AnimatePresence>
        <div className="space-y-2">
          {articles.map(a => editTarget?.id === a.id ? null : (
            <ArticleCard
              key={a.id} article={a} conclusions={conclusions}
              onEdit={() => { setEditTarget(a); setShowForm(false); }}
              onDelete={() => deleteArt.mutate(a.id)}
              onAddConclusion={aid => createConc.mutate({ article_id: aid, content: "", strength: "moderate" })}
              onDeleteConclusion={id => deleteConc.mutate(id)}
              onPatchConclusion={(id, patch) => updateConc.mutate({ id, patch })}
            />
          ))}
        </div>
      </AnimatePresence>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════════════════
export default function ResearchLab() {
  const qc = useQueryClient();
  const QK = ["/research-boards"];

  const { data: boards = [], isLoading } = useQuery<Board[]>({
    queryKey: QK,
    queryFn: async () => {
      const [sciR, expR] = await Promise.all([
        apiRequest("GET", "/api/boards?type=science_board").then(r => r.json()),
        apiRequest("GET", "/api/boards?type=experiment_board").then(r => r.json()),
      ]);
      return [...sciR, ...expR].sort((a: Board, b: Board) => b.updated_at - a.updated_at);
    },
  });

  const [activeBoardId, setActiveBoardId] = useState<number | null>(null);
  const activeBoard = boards.find(b => b.id === activeBoardId) ?? null;

  // Deep-link, the same handshake `BoardShell` uses: whoever navigated here
  // left a board id behind, and it is consumed once so a later visit does not
  // re-open it. The Command Center and the Projects widget both arrive this way.
  useEffect(() => {
    if (boards.length === 0) return;
    const pending = sessionStorage.getItem("rome_open_board_id");
    if (!pending) return;
    sessionStorage.removeItem("rome_open_board_id");
    const id = parseInt(pending, 10);
    if (boards.some(b => b.id === id)) setActiveBoardId(id);
  }, [boards]);

  // Folder state lives in Sidebar but we need it to add a board to a folder after creation
  const pendingFolder = useRef<string>("");

  const createBoard = useMutation({
    mutationFn: (type: BoardType) => {
      const title = type === "science_board" ? "New Science Board" : "New Experiment Board";
      return apiRequest("POST", "/api/boards", { type, title }).then(r => r.json());
    },
    onSuccess: (board: Board) => {
      qc.invalidateQueries({ queryKey: QK });
      setActiveBoardId(board.id);
      // If created via a folder button, add it to that folder
      if (pendingFolder.current) {
        const folderId = pendingFolder.current;
        pendingFolder.current = "";
        const raw = localStorage.getItem(FOLDERS_KEY);
        const folders: LabFolder[] = raw ? JSON.parse(raw) : [];
        const next = folders.map(f => f.id === folderId ? { ...f, boardIds: [...f.boardIds, board.id] } : f);
        localStorage.setItem(FOLDERS_KEY, JSON.stringify(next));
        // Force sidebar re-render by dispatching storage event
        window.dispatchEvent(new StorageEvent("storage", { key: FOLDERS_KEY }));
      }
    },
  });

  const handleNew = (type: BoardType, folderId: string) => {
    pendingFolder.current = folderId;
    createBoard.mutate(type);
  };

  return (
    <div className="flex h-full min-h-[calc(100vh-120px)]">
      <Sidebar
        boards={boards}
        isLoading={isLoading}
        activeBoardId={activeBoardId}
        onSelect={setActiveBoardId}
        onNew={handleNew}
        creating={createBoard.isPending}
      />

      <div className="flex-1 overflow-auto">
        {activeBoard ? (
          activeBoard.type === "science_board"
            ? <ScienceBoardView board={activeBoard} />
            : <ExperimentBoardView board={activeBoard} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-6 text-muted-foreground">
            <div className="flex items-center gap-4 opacity-20">
              <BookOpen className="w-10 h-10" />
              <span className="text-2xl">+</span>
              <FlaskConical className="w-10 h-10" />
            </div>
            <p className="text-sm opacity-50">Select a board or create a new one</p>
          </div>
        )}
      </div>
    </div>
  );
}
