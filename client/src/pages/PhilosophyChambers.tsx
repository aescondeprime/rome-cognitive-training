import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  Feather, Plus, Trash2, Pin, PinOff, X,
  Bold, Italic, List, ListOrdered, Quote, Code, Heading1, Heading2,
  Hash, Clock, Loader2, Zap, ChevronLeft,
} from "lucide-react";
import { ConstellationSidebar, type ConstellationNavNode } from "@/components/ConstellationNavigator";

interface Note {
  id: number;
  title: string;
  content: string;
  tags: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

function parseTags(raw: string): string[] {
  try { return JSON.parse(raw) ?? []; } catch { return []; }
}

function formatDate(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return "Today · " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7)  return d.toLocaleDateString("en-US", { weekday: "long" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function renderMarkdown(md: string): string {
  return md
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/^\> (.+)$/gm, "<blockquote>$1</blockquote>")
    .replace(/^\* (.+)$/gm, "<li>$1</li>")
    .replace(/^\d+\. (.+)$/gm, "<li>$1</li>")
    .replace(/^---$/gm, "<hr/>")
    .replace(/==(.+?)==/g, '<span class="galvanized">$1</span>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .split("\n\n").map(para => {
      if (/^<(h[1-3]|blockquote|li|hr|ul|ol)/.test(para.trim())) return para;
      return `<p>${para}</p>`;
    }).join("\n");
}

const PLACEHOLDER_CONTENT = `# Welcome to Philosophy Chambers

Write freely. Think deeply. This is your private space for reflection, synthesis, and intellectual exploration.

## Suggested uses
* Daily cognitive reflections after training
* Lecture notes and synthesis
* Research summaries and connections
* Personal philosophy and mental models

> "The unexamined life is not worth living." — Socrates

---

Start writing below. Markdown is supported.
`;

export default function PhilosophyChambers() {
  const [selectedId, setSelectedId]     = useState<number | null>(null);
  const [tagFilter, setTagFilter]       = useState<string | null>(null);
  const [previewMode, setPreviewMode]   = useState(false);
  const [newTagInput, setNewTagInput]   = useState("");
  const [showTagInput, setShowTagInput] = useState(false);
  // Mobile: "list" | "editor"
  const [mobileView, setMobileView]     = useState<"list" | "editor">("list");
  const [graphCollapsed, setGraphCollapsed] = useState(false);

  const [draftTitle,   setDraftTitle]   = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [draftTags,    setDraftTags]    = useState<string[]>([]);
  const saveTimer    = useRef<ReturnType<typeof setTimeout>>();
  const textareaRef  = useRef<HTMLTextAreaElement>(null);

  const { data: notes = [] } = useQuery<Note[]>({ queryKey: ["/api/notes"] });
  const { toast } = useToast();

  const createNote = useMutation({
    mutationFn: () => apiRequest("POST", "/api/notes", {
      title: "Untitled", content: PLACEHOLDER_CONTENT, tags: [],
    }).then(r => r.json()),
    onSuccess: (note: Note) => {
      queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
      setSelectedId(note.id);
      setMobileView("editor");   // jump to editor on mobile after create
    },
    onError: (error: Error) => {
      toast({
        title: "Could not create note",
        description: error.message || "The note could not be saved.",
        variant: "destructive",
      });
    },
  });

  const updateNote = useMutation({
    mutationFn: ({ id, ...data }: { id: number; title?: string; content?: string; tags?: string[]; pinned?: boolean }) =>
      apiRequest("PATCH", `/api/notes/${id}`, data).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/notes"] }),
  });

  const deleteNote = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/notes/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
      setSelectedId(null);
      setMobileView("list");
    },
  });

  const selectedNote = notes.find(n => n.id === selectedId);

  useEffect(() => {
    if (selectedNote) {
      setDraftTitle(selectedNote.title);
      setDraftContent(selectedNote.content);
      setDraftTags(parseTags(selectedNote.tags));
    }
  }, [selectedId]);

  const scheduleSave = useCallback(() => {
    if (!selectedId) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      updateNote.mutate({ id: selectedId, title: draftTitle, content: draftContent, tags: draftTags });
    }, 800);
  }, [selectedId, draftTitle, draftContent, draftTags]);

  useEffect(() => { scheduleSave(); }, [draftTitle, draftContent, draftTags]);

  const allTags  = Array.from(new Set(notes.flatMap(n => parseTags(n.tags))));
  const philosophyHubId = "philosophy:root";
  const graphNotes = useMemo(
    () => tagFilter ? notes.filter(note => parseTags(note.tags).includes(tagFilter)) : notes,
    [notes, tagFilter],
  );
  const graphTagIds = useMemo(
    () => new Set(graphNotes.flatMap(note => parseTags(note.tags))),
    [graphNotes],
  );
  const graphNodes: ConstellationNavNode[] = useMemo(() => [
      {
        id: philosophyHubId,
        label: "Philosophy Core",
        group: "archive",
        color: "hsl(43 78% 58%)",
        kind: "hub",
        weight: 9,
        subtitle: "Reflection archive",
      },
      ...Array.from(graphTagIds).map(tag => ({
        id: `tag:${tag}`,
        label: `#${tag}`,
        group: "tags",
        color: "hsl(274 58% 66%)",
        kind: "tag" as const,
        weight: Math.max(2, graphNotes.filter(note => parseTags(note.tags).includes(tag)).length),
        subtitle: "Concept cluster",
      })),
      ...graphNotes.map(note => ({
        id: `note:${note.id}`,
        label: note.title || "Untitled",
        group: note.pinned ? "pinned" : "archive",
        color: note.pinned ? "hsl(43 82% 62%)" : "hsl(194 72% 63%)",
        kind: "item" as const,
        weight: Math.min(8, 1 + Math.sqrt(Math.max(1, note.content.trim().split(/\s+/).length)) / 3 + (note.pinned ? 2 : 0)),
        subtitle: `${note.pinned ? "Pinned · " : ""}${formatDate(note.updatedAt)}`,
      })),
    ], [graphNotes, graphTagIds]);
  const graphLinks = useMemo(() => [
      ...Array.from(graphTagIds).map(tag => ({ source: philosophyHubId, target: `tag:${tag}` })),
      ...graphNotes.flatMap(note => {
        const tags = parseTags(note.tags).filter(tag => graphTagIds.has(tag));
        return tags.length > 0
          ? tags.map(tag => ({ source: `tag:${tag}`, target: `note:${note.id}` }))
          : [{ source: philosophyHubId, target: `note:${note.id}` }];
      }),
      ...graphNotes.flatMap(note => graphNotes
        .filter(target => target.id !== note.id && target.title.trim() && note.content.toLowerCase().includes(`[[${target.title.toLowerCase()}]]`))
        .map(target => ({ source: `note:${note.id}`, target: `note:${target.id}` }))),
    ], [graphNotes, graphTagIds]);

  function insertMd(wrap: string, block = false) {
    const ta = textareaRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e } = ta;
    const sel = draftContent.slice(s, e);
    const replacement = block ? `\n${wrap}${sel || "text"}\n` : `${wrap}${sel || "text"}${wrap}`;
    const next = draftContent.slice(0, s) + replacement + draftContent.slice(e);
    setDraftContent(next);
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(s + wrap.length, s + wrap.length + (sel || "text").length);
    }, 10);
  }

  function insertGalvanize() {
    const ta = textareaRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e } = ta;
    const sel = draftContent.slice(s, e) || "galvanized";
    const next = draftContent.slice(0, s) + `==${sel}==` + draftContent.slice(e);
    setDraftContent(next);
    setTimeout(() => { ta.focus(); ta.setSelectionRange(s + 2, s + 2 + sel.length); }, 10);
  }

  function addTag() {
    const t = newTagInput.trim().toLowerCase().replace(/\s+/g, "-");
    if (t && !draftTags.includes(t)) setDraftTags([...draftTags, t]);
    setNewTagInput("");
    setShowTagInput(false);
  }

  function openNote(id: number) {
    setSelectedId(id);
    setMobileView("editor");
  }

  function backToList() {
    setMobileView("list");
  }

  const wordCount = draftContent.trim().split(/\s+/).filter(Boolean).length;

  // ── Toolbar buttons config ──────────────────────────────────────────────
  const toolbarButtons = [
    { icon: Bold,        action: () => insertMd("**"),      title: "Bold"    },
    { icon: Italic,      action: () => insertMd("*"),       title: "Italic"  },
    { icon: Heading1,    action: () => insertMd("# ", true), title: "H1"     },
    { icon: Heading2,    action: () => insertMd("## ", true), title: "H2"    },
    { icon: Quote,       action: () => insertMd("> ", true), title: "Quote"  },
    { icon: List,        action: () => insertMd("* ", true), title: "List"   },
    { icon: ListOrdered, action: () => insertMd("1. ", true), title: "Ordered" },
    { icon: Code,        action: () => insertMd("`"),       title: "Code"    },
  ];

  // ══════════════════════════════════════════════════════════════════════
  // CONSTELLATION NAVIGATION PANEL
  // ══════════════════════════════════════════════════════════════════════
  const NoteListPanel = (
    <div
      className={cn(
        "h-full shrink-0",
        mobileView === "list" ? "flex w-full md:w-auto" : "hidden md:flex",
      )}
    >
      <ConstellationSidebar
        title="Philosophy"
        accent="hsl(43 78% 58%)"
        collapsed={graphCollapsed}
        onCollapsedChange={setGraphCollapsed}
        sidebarClassName={graphCollapsed
          ? "!h-full !w-10 !min-w-10"
          : "!h-full !w-full !min-w-0 md:!w-[300px] md:!min-w-[300px]"}
        nodes={graphNodes}
        links={graphLinks}
        groups={[
          { id: "archive", label: "Notes", color: "hsl(194 72% 63%)" },
          { id: "pinned", label: "Pinned", color: "hsl(43 82% 62%)" },
          { id: "tags", label: "Tags", color: "hsl(274 58% 66%)" },
        ]}
        activeId={selectedId ? `note:${selectedId}` : philosophyHubId}
        onSelect={id => {
          if (id.startsWith("note:")) openNote(Number(id.slice(5)));
          if (id.startsWith("tag:")) setTagFilter(id.slice(4));
          if (id === philosophyHubId) setTagFilter(null);
        }}
        emptyLabel="No philosophy notes yet"
        headerActions={(
          <button
            onClick={() => createNote.mutate()}
            disabled={createNote.isPending}
            className="rounded p-1 text-muted-foreground transition-colors hover:text-gold-400 disabled:opacity-50"
            title="New note node"
          >
            {createNote.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          </button>
        )}
        collapsedAction={(
          <button
            onClick={() => createNote.mutate()}
            disabled={createNote.isPending}
            className="flex w-full justify-center rounded p-2 text-gold-500 hover:bg-gold-500/10 hover:text-gold-300 disabled:opacity-50"
            title="New note"
          >
            {createNote.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          </button>
        )}
        footer={(
          <div className="space-y-1.5">
            {allTags.length > 0 && (
              <select
                value={tagFilter ?? ""}
                onChange={e => setTagFilter(e.target.value || null)}
                className="h-7 w-full rounded-sm border border-[hsl(220_15%_15%)] bg-[hsl(220_15%_7%)] px-2 font-mono text-[8px] text-muted-foreground outline-none"
                aria-label="Filter philosophy graph by tag"
              >
                <option value="">All concepts</option>
                {allTags.map(tag => <option key={tag} value={tag}>#{tag}</option>)}
              </select>
            )}
            <button
              onClick={() => createNote.mutate()}
              disabled={createNote.isPending}
              className="flex w-full items-center justify-center gap-1.5 rounded-sm border border-dashed border-gold-500/30 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.12em] text-gold-500 transition-all hover:bg-gold-500/8 hover:text-gold-300 disabled:opacity-50"
            >
              {createNote.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              New Note
            </button>
            <p className="px-1 text-center font-mono text-[7px] leading-relaxed text-muted-foreground/30">
              Link notes with [[Exact Note Title]]
            </p>
          </div>
        )}
      />
    </div>
  );

  // ══════════════════════════════════════════════════════════════════════
  // EDITOR PANEL
  // ══════════════════════════════════════════════════════════════════════
  const EditorPanel = selectedNote ? (
    <div
      className={cn(
        "flex-1 flex flex-col overflow-hidden",
        mobileView === "editor" ? "flex w-full" : "hidden md:flex",
      )}
    >
      {/* Toolbar */}
      <div
        className="flex items-center gap-0.5 px-3 md:px-6 py-2 border-b shrink-0 overflow-x-auto"
        style={{ borderColor: "hsl(var(--accent-h) 20% 14% / 0.6)", background: "hsl(220 18% 5%)" }}
      >
        {/* Mobile: back button */}
        <button
          onClick={backToList}
          className="md:hidden w-8 h-8 rounded flex items-center justify-center text-muted-foreground hover:text-gold-400 mr-1 shrink-0"
          title="Back to notes"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {/* Formatting buttons */}
        {toolbarButtons.map(({ icon: Icon, action, title }) => (
          <button
            key={title}
            onClick={action}
            title={title}
            className="w-8 h-8 rounded flex items-center justify-center text-muted-foreground hover:text-gold-400 hover:bg-gold-500/10 transition-all shrink-0"
          >
            <Icon className="w-3.5 h-3.5" />
          </button>
        ))}

        {/* Galvanize */}
        <div className="w-px h-4 bg-border mx-0.5 shrink-0" />
        <button
          onClick={insertGalvanize}
          title="Galvanize (==text==)"
          className="w-8 h-8 rounded flex items-center justify-center transition-all shrink-0"
          style={{ color: "hsl(200 100% 70%)" }}
        >
          <Zap
            className="w-3.5 h-3.5"
            style={{ filter: "drop-shadow(0 0 4px hsl(210 100% 60%)) drop-shadow(0 0 10px hsl(210 100% 50%))" }}
          />
        </button>

        <div className="w-px h-4 bg-border mx-0.5 shrink-0" />

        {/* Read/Edit toggle */}
        <button
          onClick={() => setPreviewMode(p => !p)}
          className={cn(
            "px-2.5 py-1 rounded text-[10px] font-roman uppercase tracking-wider transition-all shrink-0",
            previewMode
              ? "bg-gold-500/15 text-gold-400 border border-gold-400/30"
              : "text-muted-foreground hover:text-gold-400 hover:bg-gold-500/10"
          )}
        >
          {previewMode ? "Edit" : "Read"}
        </button>

        <div className="flex-1" />

        {/* Word count — hide on very small screens */}
        <span className="hidden sm:block text-[10px] text-muted-foreground font-mono mr-1 shrink-0">{wordCount}w</span>

        {/* Pin */}
        <button
          onClick={() => updateNote.mutate({ id: selectedNote.id, pinned: !selectedNote.pinned })}
          title={selectedNote.pinned ? "Unpin" : "Pin"}
          className="w-8 h-8 rounded flex items-center justify-center text-muted-foreground hover:text-gold-400 hover:bg-gold-500/10 transition-all shrink-0"
        >
          {selectedNote.pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
        </button>

        {/* Delete */}
        <button
          onClick={() => { if (confirm("Delete this note?")) deleteNote.mutate(selectedNote.id); }}
          className="w-8 h-8 rounded flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all shrink-0"
          title="Delete"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Title + meta */}
      <div
        className="px-5 md:px-8 pt-6 md:pt-8 pb-3 shrink-0"
        style={{ background: "hsl(220 18% 4%)" }}
      >
        <input
          value={draftTitle}
          onChange={e => setDraftTitle(e.target.value)}
          placeholder="Untitled"
          className="w-full bg-transparent border-none outline-none text-xl md:text-2xl font-roman font-bold text-gold-300 placeholder:text-muted-foreground/40 tracking-wide"
          style={{ fontFamily: "'Cinzel', serif" }}
        />

        {/* Tags row */}
        <div className="flex flex-wrap items-center gap-1.5 mt-3">
          <Clock className="w-3 h-3 text-muted-foreground/40 shrink-0" />
          <span className="text-[11px] text-muted-foreground/40">{formatDate(selectedNote.updatedAt)}</span>
          <span className="mx-1 text-muted-foreground/20">·</span>
          {draftTags.map(tag => (
            <span
              key={tag}
              className="rome-tag group cursor-pointer text-xs py-0.5 px-2"
              onClick={() => setDraftTags(draftTags.filter(t => t !== tag))}
            >
              # {tag}
              <X className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity ml-0.5 inline" />
            </span>
          ))}
          {showTagInput ? (
            <input
              autoFocus
              value={newTagInput}
              onChange={e => setNewTagInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") addTag(); if (e.key === "Escape") setShowTagInput(false); }}
              onBlur={addTag}
              placeholder="tag-name"
              className="text-xs bg-cave-800 border border-cave-700 rounded px-2 py-1 outline-none focus:border-gold-500/40 text-gold-400 w-24"
            />
          ) : (
            <button
              onClick={() => setShowTagInput(true)}
              className="text-xs text-muted-foreground/40 hover:text-gold-400/70 transition-colors flex items-center gap-1 py-0.5"
            >
              <Hash className="w-3 h-3" /> Add tag
            </button>
          )}
        </div>
      </div>

      {/* Editor / Preview */}
      <div
        className="flex-1 overflow-y-auto px-5 md:px-8 pb-12"
        style={{ background: "hsl(220 18% 4%)" }}
      >
        {previewMode ? (
          <div
            className="note-content max-w-2xl"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(draftContent) }}
          />
        ) : (
          <textarea
            ref={textareaRef}
            value={draftContent}
            onChange={e => setDraftContent(e.target.value)}
            placeholder="Start writing… (Markdown supported)"
            className="note-editor w-full h-full min-h-[60vh] bg-transparent resize-none text-base md:text-sm leading-loose text-foreground/85 placeholder:text-muted-foreground/30"
            spellCheck
          />
        )}
      </div>
    </div>
  ) : (
    /* Empty state — only shown on desktop when nothing selected */
    <div
      className={cn(
        "flex-1 flex-col items-center justify-center gap-6 text-center px-8",
        mobileView === "editor" ? "flex" : "hidden md:flex",
      )}
    >
      <div className="w-20 h-20 rounded-2xl bg-gold-500/8 border border-gold-500/15 flex items-center justify-center">
        <Feather className="w-9 h-9 text-gold-400/60" />
      </div>
      <div>
        <h2 className="text-xl font-roman font-bold text-gold-300 tracking-wide mb-2">Philosophy Chambers</h2>
        <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
          A private space for cognitive reflection, note-taking, and intellectual synthesis.
          Write in Markdown — your thoughts are saved automatically.
        </p>
      </div>
      <button
        onClick={() => createNote.mutate()}
        disabled={createNote.isPending}
        className="btn-rome px-5 py-2.5 rounded-lg flex items-center gap-2 text-sm disabled:opacity-60"
      >
        {createNote.isPending
          ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</>
          : <><Plus className="w-4 h-4" /> New Note</>}
      </button>
      <div className="text-[11px] text-muted-foreground/40 font-roman tracking-widest uppercase">
        {notes.length} {notes.length === 1 ? "scroll" : "scrolls"} in the archive
      </div>
    </div>
  );

  return (
    <div className="flex -m-8 overflow-hidden" style={{ height: "calc(100vh - 0px)", maxHeight: "100vh" }}>
      {NoteListPanel}
      {EditorPanel}
    </div>
  );
}
