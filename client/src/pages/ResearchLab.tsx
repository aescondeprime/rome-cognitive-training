/**
 * ResearchLab — Investigative node research collection tool.
 *
 * Two board types accessible from the same sidebar:
 *
 * Science Board  — link research articles, pull key conclusions from each,
 *                  tag by evidence strength.
 *
 * Experiment Board — structured experiment process:
 *   Question → Hypothesis → Variables → Method →
 *   Materials → Procedure → Results → Analysis → Conclusion
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Plus, Trash2, PenLine, ChevronLeft, Check, Loader2,
  BookOpen, FlaskConical, ExternalLink, X, ChevronDown,
  ChevronRight, Link2, Lightbulb, Microscope,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

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
}

// ── Config ─────────────────────────────────────────────────────────────────
const ACCENT_SCIENCE    = "hsl(210 65% 62%)";
const ACCENT_EXPERIMENT = "hsl(145 55% 50%)";

const STRENGTH_CONFIG: Record<Strength, { label: string; color: string; bg: string; border: string }> = {
  strong:     { label: "Strong",      color: "hsl(145 55% 55%)", bg: "hsl(145 30% 7%)",  border: "hsl(145 30% 20%)" },
  moderate:   { label: "Moderate",    color: "hsl(38 75% 58%)",  bg: "hsl(38 35% 7%)",   border: "hsl(38 35% 20%)" },
  weak:       { label: "Weak",        color: "hsl(0 55% 58%)",   bg: "hsl(0 30% 7%)",    border: "hsl(0 30% 20%)"  },
  speculative:{ label: "Speculative", color: "hsl(270 55% 62%)", bg: "hsl(270 25% 7%)",  border: "hsl(270 25% 20%)" },
};

const EXPERIMENT_SECTIONS = [
  { key: "question",     label: "Research Question",     placeholder: "What are you trying to find out?" },
  { key: "hypothesis",   label: "Hypothesis",            placeholder: "State your testable prediction (If… then… because…)" },
  { key: "iv",           label: "Independent Variable",  placeholder: "What you will deliberately change or manipulate" },
  { key: "dv",           label: "Dependent Variable",    placeholder: "What you will measure or observe as a result" },
  { key: "cv",           label: "Controlled Variables",  placeholder: "What you will keep constant to ensure a fair test" },
  { key: "materials",    label: "Materials",             placeholder: "List everything needed to run the experiment" },
  { key: "method",       label: "Method / Procedure",    placeholder: "Step-by-step description of how you'll run the experiment" },
  { key: "results",      label: "Results",               placeholder: "Record raw data, observations, measurements" },
  { key: "analysis",     label: "Analysis",              placeholder: "Interpret the data — patterns, statistics, comparisons" },
  { key: "conclusion",   label: "Conclusion",            placeholder: "Did the results support your hypothesis? What does it mean?" },
  { key: "limitations",  label: "Limitations",           placeholder: "What could have affected the results? How could this be improved?" },
  { key: "references",   label: "References",            placeholder: "Link to any papers, sources, or prior work that informed this experiment" },
];

// ── Shared helpers ─────────────────────────────────────────────────────────
const inputCls = "w-full bg-[hsl(220_15%_5%)] border border-[hsl(220_15%_15%)] rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-[hsl(210_40%_30%)] transition-colors placeholder:text-muted-foreground/35";
const labelCls = "block text-[9px] font-mono tracking-widest uppercase text-muted-foreground mb-1.5";

// ── Sidebar ────────────────────────────────────────────────────────────────
interface SidebarProps {
  boards: Board[];
  isLoading: boolean;
  activeBoardId: number | null;
  onSelect: (id: number) => void;
  onNew: (type: BoardType) => void;
  creating: boolean;
}

function Sidebar({ boards, isLoading, activeBoardId, onSelect, onNew, creating }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const qc = useQueryClient();

  const renameBoard = useMutation({
    mutationFn: ({ id, title }: { id: number; title: string }) =>
      apiRequest("PATCH", `/api/boards/${id}`, { title }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/research-boards"] });
    },
  });

  const deleteBoard = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/boards/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/research-boards"] }),
  });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const startRename = (b: Board) => { setEditingId(b.id); setEditTitle(b.title); };
  const commitRename = () => {
    if (editingId && editTitle.trim()) renameBoard.mutate({ id: editingId, title: editTitle.trim() });
    setEditingId(null);
  };

  const sciBoards = boards.filter(b => b.type === "science_board");
  const expBoards = boards.filter(b => b.type === "experiment_board");

  const BoardRow = ({ board }: { board: Board }) => {
    const isScience = board.type === "science_board";
    const accent = isScience ? ACCENT_SCIENCE : ACCENT_EXPERIMENT;
    const isActive = activeBoardId === board.id;
    return (
      <div
        className={cn(
          "group flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer transition-colors",
          isActive ? "text-foreground" : "hover:bg-[hsl(220_15%_8%)] text-muted-foreground hover:text-foreground"
        )}
        style={{ background: isActive ? `${accent}18` : undefined }}
        onClick={() => onSelect(board.id)}
      >
        {isScience
          ? <BookOpen className="w-3 h-3 shrink-0" style={{ color: isActive ? accent : undefined }} />
          : <FlaskConical className="w-3 h-3 shrink-0" style={{ color: isActive ? accent : undefined }} />
        }
        {editingId === board.id ? (
          <input
            autoFocus
            value={editTitle}
            onChange={e => setEditTitle(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditingId(null); }}
            onClick={e => e.stopPropagation()}
            className="flex-1 bg-transparent outline-none text-xs min-w-0"
            style={{ color: accent }}
          />
        ) : (
          <span className="flex-1 text-xs truncate">{board.title}</span>
        )}
        <div className="hidden group-hover:flex items-center gap-0.5">
          <button onClick={e => { e.stopPropagation(); startRename(board); }} className="p-0.5 rounded hover:text-foreground transition-colors">
            <PenLine className="w-2.5 h-2.5" />
          </button>
          <button onClick={e => { e.stopPropagation(); deleteBoard.mutate(board.id); }} className="p-0.5 rounded hover:text-rose-400 transition-colors">
            <Trash2 className="w-2.5 h-2.5" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className={cn("flex flex-col border-r border-border bg-[hsl(220_15%_5%)] transition-all duration-300 shrink-0", collapsed ? "w-10" : "w-60")}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-border">
        {!collapsed && <span className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground">Research Lab</span>}
        <button onClick={() => setCollapsed(v => !v)} className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors ml-auto">
          <ChevronLeft className={cn("w-3.5 h-3.5 transition-transform", collapsed && "rotate-180")} />
        </button>
      </div>

      {!collapsed && (
        <>
          <div className="flex-1 overflow-y-auto py-2 px-2 space-y-3">
            {isLoading ? (
              <div className="flex justify-center py-6"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground opacity-50" /></div>
            ) : (
              <>
                {/* Science boards */}
                <div>
                  <p className="text-[9px] font-mono tracking-widest uppercase px-2 py-1" style={{ color: ACCENT_SCIENCE + "99" }}>
                    Science Boards
                  </p>
                  {sciBoards.length === 0
                    ? <p className="text-[10px] text-muted-foreground px-2 pb-1 opacity-50">None yet</p>
                    : sciBoards.map(b => <BoardRow key={b.id} board={b} />)
                  }
                </div>
                {/* Experiment boards */}
                <div>
                  <p className="text-[9px] font-mono tracking-widest uppercase px-2 py-1" style={{ color: ACCENT_EXPERIMENT + "99" }}>
                    Experiment Boards
                  </p>
                  {expBoards.length === 0
                    ? <p className="text-[10px] text-muted-foreground px-2 pb-1 opacity-50">None yet</p>
                    : expBoards.map(b => <BoardRow key={b.id} board={b} />)
                  }
                </div>
              </>
            )}
          </div>

          {/* New board buttons */}
          <div className="p-2 border-t border-border space-y-1.5">
            <button
              onClick={() => onNew("science_board")}
              disabled={creating}
              className="w-full flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs border border-dashed transition-all"
              style={{ color: ACCENT_SCIENCE, borderColor: ACCENT_SCIENCE + "35", background: "transparent" }}
            >
              {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              New Science Board
            </button>
            <button
              onClick={() => onNew("experiment_board")}
              disabled={creating}
              className="w-full flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs border border-dashed transition-all"
              style={{ color: ACCENT_EXPERIMENT, borderColor: ACCENT_EXPERIMENT + "35", background: "transparent" }}
            >
              {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              New Experiment Board
            </button>
          </div>
        </>
      )}

      {collapsed && (
        <div className="p-1 border-t border-border space-y-1">
          <button onClick={() => onNew("science_board")} className="w-full flex justify-center p-2 rounded transition-colors hover:bg-[hsl(220_15%_8%)]" style={{ color: ACCENT_SCIENCE }} title="New Science Board">
            <BookOpen className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onNew("experiment_board")} className="w-full flex justify-center p-2 rounded transition-colors hover:bg-[hsl(220_15%_8%)]" style={{ color: ACCENT_EXPERIMENT }} title="New Experiment Board">
            <FlaskConical className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Article form ───────────────────────────────────────────────────────────
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

// ── Conclusion row ─────────────────────────────────────────────────────────
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
      {/* Strength cycle badge */}
      <button
        onClick={() => {
          const idx = strengths.indexOf(c.strength);
          onPatch(c.id, { strength: strengths[(idx + 1) % strengths.length] });
        }}
        className="mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-mono shrink-0 transition-all hover:opacity-80"
        style={{ color: sc.color, background: sc.bg, border: `1px solid ${sc.border}` }}
        title="Click to change strength"
      >
        {sc.label}
      </button>

      {editing ? (
        <textarea
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={e => { if (e.key === "Escape") { setEditing(false); setDraft(c.content); } }}
          className="flex-1 bg-transparent resize-none outline-none text-xs text-foreground/80 leading-relaxed border-b border-[hsl(210_40%_25%)]"
          rows={2}
        />
      ) : (
        <p
          className="flex-1 text-xs text-foreground/70 leading-relaxed cursor-text"
          onDoubleClick={() => setEditing(true)}
        >
          {c.content || <span className="opacity-30 italic">Double-click to write conclusion…</span>}
        </p>
      )}

      <button
        onClick={() => onDelete(c.id)}
        className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-muted-foreground hover:text-rose-400 transition-all shrink-0 mt-0.5"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

// ── Article card ───────────────────────────────────────────────────────────
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
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="rounded-xl border border-[hsl(220_15%_12%)] overflow-hidden"
      style={{ background: "hsl(220 15% 7%)" }}
    >
      {/* Header */}
      <div
        className="flex items-start gap-2.5 px-4 py-3 cursor-pointer hover:bg-[hsl(220_15%_9%)] transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        {open
          ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
          : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
        }
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate" style={{ fontFamily: "Cinzel, serif", color: "hsl(220 25% 82%)" }}>
            {article.title}
          </p>
          {(article.authors || article.year) && (
            <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">
              {[article.authors, article.year].filter(Boolean).join(" · ")}
            </p>
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
        {/* Conclusion count badge */}
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

      {/* Expanded */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-4 border-t border-[hsl(220_15%_11%)] pt-3">
              {/* Tags */}
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map(t => (
                    <span key={t} className="px-2 py-0.5 rounded text-[9px] font-mono" style={{ color: ACCENT_SCIENCE + "cc", background: "hsl(210 40% 9%)", border: `1px solid hsl(210 40% 18%)` }}>{t}</span>
                  ))}
                </div>
              )}

              {/* Abstract */}
              {article.abstract && (
                <div>
                  <p className={labelCls}>Abstract / Summary</p>
                  <p className="text-xs text-foreground/60 leading-relaxed whitespace-pre-wrap">{article.abstract}</p>
                </div>
              )}

              {/* Conclusions */}
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
                    : myConclusions.map(c => (
                      <ConclusionRow
                        key={c.id}
                        c={c}
                        onDelete={onDeleteConclusion}
                        onPatch={onPatchConclusion}
                      />
                    ))
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

// ── Science Board View ─────────────────────────────────────────────────────
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

  const createArt = useMutation({
    mutationFn: (body: object) => apiRequest("POST", `/api/boards/${board.id}/articles`, body).then(r => r.json()),
    onSuccess: invArt,
  });
  const updateArt = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: object }) => apiRequest("PATCH", `/api/articles/${id}`, patch),
    onSuccess: invArt,
  });
  const deleteArt = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/articles/${id}`),
    onMutate: async id => {
      await qc.cancelQueries({ queryKey: artQK });
      const prev = qc.getQueryData<Article[]>(artQK);
      qc.setQueryData<Article[]>(artQK, old => (old ?? []).filter(a => a.id !== id));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(artQK, ctx.prev); },
    onSettled: invArt,
  });

  const createConc = useMutation({
    mutationFn: (body: object) => apiRequest("POST", `/api/boards/${board.id}/conclusions`, body).then(r => r.json()),
    onSuccess: invConc,
  });
  const updateConc = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: object }) => apiRequest("PATCH", `/api/conclusions/${id}`, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: concQK });
      const prev = qc.getQueryData<Conclusion[]>(concQK);
      qc.setQueryData<Conclusion[]>(concQK, old => (old ?? []).map(c => c.id === id ? { ...c, ...patch as Conclusion } : c));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(concQK, ctx.prev); },
    onSettled: invConc,
  });
  const deleteConc = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/conclusions/${id}`),
    onMutate: async id => {
      await qc.cancelQueries({ queryKey: concQK });
      const prev = qc.getQueryData<Conclusion[]>(concQK);
      qc.setQueryData<Conclusion[]>(concQK, old => (old ?? []).filter(c => c.id !== id));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(concQK, ctx.prev); },
    onSettled: invConc,
  });

  const [showForm, setShowForm]     = useState(false);
  const [editTarget, setEditTarget] = useState<Article | null>(null);

  const handleSave = (data: Omit<Article, "id" | "board_id">) => {
    if (editTarget) {
      updateArt.mutate({ id: editTarget.id, patch: data }, { onSuccess: () => setEditTarget(null) });
    } else {
      createArt.mutate(data, { onSuccess: () => setShowForm(false) });
    }
  };

  if (artLoading) return (
    <div className="flex items-center justify-center h-48">
      <Loader2 className="w-5 h-5 animate-spin opacity-30" style={{ color: ACCENT_SCIENCE }} />
    </div>
  );

  return (
    <div className="p-5 space-y-4 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold tracking-widest uppercase" style={{ fontFamily: "Cinzel, serif", color: ACCENT_SCIENCE }}>
            {board.title}
          </h2>
          <p className="text-[10px] font-mono text-muted-foreground mt-0.5">Science Board · {articles.length} article{articles.length !== 1 ? "s" : ""}</p>
        </div>
        {!showForm && !editTarget && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono transition-all"
            style={{ border: `1px solid ${ACCENT_SCIENCE}40`, color: ACCENT_SCIENCE, background: `${ACCENT_SCIENCE}10` }}
          >
            <Plus className="w-3.5 h-3.5" />
            Add Article
          </button>
        )}
      </div>

      {/* Form */}
      <AnimatePresence>
        {(showForm || editTarget) && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
            <ArticleForm
              initial={editTarget ?? undefined}
              onSave={handleSave}
              onCancel={() => { setShowForm(false); setEditTarget(null); }}
              saving={createArt.isPending || updateArt.isPending}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Empty */}
      {articles.length === 0 && !showForm && (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
          <BookOpen className="w-10 h-10 opacity-10" />
          <p className="text-sm opacity-40">Add your first research article</p>
        </div>
      )}

      {/* Articles */}
      <AnimatePresence>
        <div className="space-y-2">
          {articles.map(a => (
            editTarget?.id === a.id ? null : (
              <ArticleCard
                key={a.id}
                article={a}
                conclusions={conclusions}
                onEdit={() => { setEditTarget(a); setShowForm(false); }}
                onDelete={() => deleteArt.mutate(a.id)}
                onAddConclusion={aid => createConc.mutate({ article_id: aid, content: "", strength: "moderate" })}
                onDeleteConclusion={id => deleteConc.mutate(id)}
                onPatchConclusion={(id, patch) => updateConc.mutate({ id, patch })}
              />
            )
          ))}
        </div>
      </AnimatePresence>
    </div>
  );
}

// ── Experiment Board View ──────────────────────────────────────────────────
function ExperimentBoardView({ board }: { board: Board }) {
  const qc = useQueryClient();
  const secQK = ["/boards", board.id, "experiment-sections"];

  const { data: remoteSections = [], isLoading } = useQuery<ExpSection[]>({
    queryKey: secQK,
    queryFn: () => apiRequest("GET", `/api/boards/${board.id}/experiment-sections`).then(r => r.json()),
  });

  const createSec = useMutation({
    mutationFn: (body: object) => apiRequest("POST", `/api/boards/${board.id}/experiment-sections`, body).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: secQK }),
  });
  const updateSec = useMutation({
    mutationFn: ({ id, content }: { id: number; content: string }) => apiRequest("PATCH", `/api/experiment-sections/${id}`, { content }),
    onMutate: async ({ id, content }) => {
      await qc.cancelQueries({ queryKey: secQK });
      const prev = qc.getQueryData<ExpSection[]>(secQK);
      qc.setQueryData<ExpSection[]>(secQK, old => (old ?? []).map(s => s.id === id ? { ...s, content } : s));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(secQK, ctx.prev); },
    onSettled: () => qc.invalidateQueries({ queryKey: secQK }),
  });

  // Initialise missing sections on first load
  useEffect(() => {
    if (isLoading || remoteSections.length > 0) return;
    // Seed all sections with empty content on first open
    const seed = async () => {
      for (const s of EXPERIMENT_SECTIONS) {
        await apiRequest("POST", `/api/boards/${board.id}/experiment-sections`, { section_key: s.key, content: "" });
      }
      qc.invalidateQueries({ queryKey: secQK });
    };
    seed();
  }, [isLoading, remoteSections.length, board.id]);

  // Build a map key → section
  const secMap: Record<string, ExpSection> = {};
  remoteSections.forEach(s => { secMap[s.section_key] = s; });

  // Debounced save
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const handleChange = (key: string, val: string) => {
    const sec = secMap[key];
    if (!sec) return;
    // Optimistic
    qc.setQueryData<ExpSection[]>(secQK, old => (old ?? []).map(s => s.section_key === key ? { ...s, content: val } : s));
    // Debounce
    clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(() => {
      updateSec.mutate({ id: sec.id, content: val });
    }, 800);
  };

  if (isLoading) return (
    <div className="flex items-center justify-center h-48">
      <Loader2 className="w-5 h-5 animate-spin opacity-30" style={{ color: ACCENT_EXPERIMENT }} />
    </div>
  );

  return (
    <div className="p-5 space-y-5 max-w-3xl">
      {/* Header */}
      <div>
        <h2 className="text-base font-bold tracking-widest uppercase" style={{ fontFamily: "Cinzel, serif", color: ACCENT_EXPERIMENT }}>
          {board.title}
        </h2>
        <p className="text-[10px] font-mono text-muted-foreground mt-0.5">Experiment Board</p>
      </div>

      {/* Sections */}
      <div className="space-y-4">
        {EXPERIMENT_SECTIONS.map((def, i) => {
          const sec = secMap[def.key];
          const isVar = ["iv", "dv", "cv"].includes(def.key);

          return (
            <div
              key={def.key}
              className="rounded-xl border border-[hsl(220_15%_12%)] overflow-hidden"
              style={{ background: "hsl(220 15% 6%)" }}
            >
              <div
                className="flex items-center gap-2.5 px-4 py-2.5 border-b border-[hsl(220_15%_10%)]"
                style={{ background: "hsl(220 15% 7%)" }}
              >
                <span
                  className="text-[9px] font-mono tracking-widest uppercase shrink-0 px-2 py-0.5 rounded"
                  style={{
                    color: isVar ? "hsl(270 55% 62%)" : ACCENT_EXPERIMENT + "cc",
                    background: isVar ? "hsl(270 25% 8%)" : "hsl(145 25% 7%)",
                    border: `1px solid ${isVar ? "hsl(270 25% 18%)" : "hsl(145 25% 16%)"}`,
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-xs font-semibold" style={{ fontFamily: "Cinzel, serif", color: "hsl(220 20% 78%)" }}>
                  {def.label}
                </span>
              </div>
              <div className="px-4 py-3">
                <textarea
                  value={sec?.content ?? ""}
                  onChange={e => handleChange(def.key, e.target.value)}
                  placeholder={def.placeholder}
                  rows={def.key === "method" || def.key === "results" || def.key === "analysis" ? 5 : 3}
                  className="w-full bg-transparent resize-none outline-none text-sm text-foreground/80 leading-relaxed placeholder:text-muted-foreground/30"
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function ResearchLab() {
  const qc = useQueryClient();
  const QK = ["/research-boards"];

  const { data: boards = [], isLoading } = useQuery<Board[]>({
    queryKey: QK,
    queryFn: () => apiRequest("GET", "/api/boards?type=science_board").then(async r => {
      const sci = await r.json();
      const expR = await apiRequest("GET", "/api/boards?type=experiment_board");
      const exp = await expR.json();
      return [...sci, ...exp].sort((a: Board, b: Board) => b.updated_at - a.updated_at);
    }),
  });

  const [activeBoardId, setActiveBoardId] = useState<number | null>(null);
  const activeBoard = boards.find(b => b.id === activeBoardId) ?? null;

  const createBoard = useMutation({
    mutationFn: (type: BoardType) => {
      const title = type === "science_board" ? "New Science Board" : "New Experiment Board";
      return apiRequest("POST", "/api/boards", { type, title }).then(r => r.json());
    },
    onSuccess: (board: Board) => {
      qc.invalidateQueries({ queryKey: QK });
      setActiveBoardId(board.id);
    },
  });

  return (
    <div className="flex h-full min-h-[calc(100vh-120px)]">
      <Sidebar
        boards={boards}
        isLoading={isLoading}
        activeBoardId={activeBoardId}
        onSelect={setActiveBoardId}
        onNew={type => createBoard.mutate(type)}
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
              <span className="text-2xl text-muted-foreground">+</span>
              <FlaskConical className="w-10 h-10" />
            </div>
            <p className="text-sm opacity-50">Select a board, or create a new one</p>
            <div className="flex gap-3">
              <button
                onClick={() => createBoard.mutate("science_board")}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-mono transition-all"
                style={{ border: `1px solid ${ACCENT_SCIENCE}40`, color: ACCENT_SCIENCE, background: `${ACCENT_SCIENCE}10` }}
              >
                <BookOpen className="w-4 h-4" />
                Science Board
              </button>
              <button
                onClick={() => createBoard.mutate("experiment_board")}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-mono transition-all"
                style={{ border: `1px solid ${ACCENT_EXPERIMENT}40`, color: ACCENT_EXPERIMENT, background: `${ACCENT_EXPERIMENT}10` }}
              >
                <FlaskConical className="w-4 h-4" />
                Experiment Board
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
