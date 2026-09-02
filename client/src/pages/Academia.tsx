/**
 * Academia — the Knowledge Forge.
 *
 * Two things live here now: **documents you look at** and **a note you write**.
 * The model is no longer between them. Sources used to be read passage by
 * passage into a digest so a Studio could compose slide decks and quizzes from
 * them; that whole apparatus is gone, along with the minutes of model time
 * every source cost before it was useful for anything.
 *
 * What replaced it is more direct. A source opens in the **Analysis State** — a
 * document viewer — and regions of it can be cut out and sent to a caseboard as
 * annotated evidence. The note is still a note, and it is the one thing a model
 * still touches: Recall State drills it, and only it.
 *
 * The active note is written to a shared pointer rather than kept here alone,
 * because Recall State follows the note the Forge has open and used to be told
 * once, on the way in. That is why THIS NOTE named a note you had since left.
 */

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity, Cpu, Database, Dices, FileText, GraduationCap, Loader2,
  MessageSquareText, NotebookPen, PanelLeftClose, PanelRightClose, Plus, RefreshCw, ScanEye,
  Search, Trash2, Upload, X,
} from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { academiaStore, type AcademiaNote, type AcademiaSource } from "@/lib/academiaStore";
import { setActiveNoteId } from "@/lib/activeNote";
import { noteCorpusId, useRecallSessionOptional } from "@/lib/recallSession";
import AnalysisState from "@/components/AnalysisState";
import FlashcardRail from "@/components/FlashcardRail";
import LlmDiagnostics from "@/components/LlmDiagnostics";
import {
  ACCEPTED_EXTENSIONS, converterAvailable, describeFailure as describeImportFailure,
  importDocument, isFailure, type ImportFailure,
} from "@/lib/documentImport";
import {
  loadLLMConfig, probeLocalLLM, saveLLMConfig, SUGGESTED_MODELS,
  type LLMStatus, type LocalLLMConfig,
} from "@/lib/localLLM";

const CYAN = "hsl(190 72% 60%)";
const VIOLET = "hsl(270 62% 70%)";

function uid() { return crypto.randomUUID(); }

function sentences(text: string): string[] {
  return text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).map(v => v.trim()).filter(v => v.length >= 30 && v.length <= 420);
}

function keywords(text: string) {
  const stop = new Set(["about", "after", "again", "also", "because", "being", "between", "could", "from", "have", "into", "more", "most", "other", "over", "should", "that", "their", "there", "these", "they", "this", "through", "under", "using", "very", "what", "when", "where", "which", "while", "with", "would"]);
  const counts = new Map<string, number>();
  for (const word of text.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []) if (!stop.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([word]) => word);
}

export default function Academia() {
  const { data: profile } = useQuery<{ id: number }>({ queryKey: ["/api/active-profile"] });
  const profileId = profile?.id;
  const [sources, setSources] = useState<AcademiaSource[]>([]);
  const [notes, setNotes] = useState<AcademiaNote[]>([]);
  const [activeNoteId, setActiveNote] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [analysingId, setAnalysingId] = useState<string | null>(null);
  const [sourceSearch, setSourceSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const [importErrors, setImportErrors] = useState<ImportFailure[]>([]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [llm, setLlm] = useState<LLMStatus>({ state: "checking" });
  const [llmCfg, setLlmCfg] = useState<LocalLLMConfig>(() => loadLLMConfig());
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [converter, setConverter] = useState(false);
  const recall = useRecallSessionOptional();
  const fileRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<number | null>(null);
  const loadedProfileId = useRef<number | null>(null);

  const reload = async () => {
    if (!profileId) return;
    const profileChanged = loadedProfileId.current !== profileId;
    loadedProfileId.current = profileId;
    const [nextSources, nextNotes] = await Promise.all([academiaStore.sources(profileId), academiaStore.notes(profileId)]);
    setSources(nextSources);
    setNotes(nextNotes);
    setAnalysingId(old => (profileChanged ? null : old && nextSources.some(source => source.id === old) ? old : null));
    setActiveNote(old => (old && nextNotes.some(note => note.id === old) ? old : nextNotes[0]?.id ?? null));
    setHydrated(true);
  };

  useEffect(() => { void reload(); }, [profileId]);
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  // The pointer Recall State reads. Written on every change rather than on the
  // way into a run, which is the whole fix for THIS NOTE going stale. Held
  // back until the notes are in: the null this starts on would otherwise clear
  // a perfectly good pointer for the moment before the store answers.
  useEffect(() => { if (hydrated) setActiveNoteId(activeNoteId); }, [activeNoteId, hydrated]);

  /**
   * Ask Ollama what it has, once per mount.
   *
   * "Not installed" is an ordinary state here, not an error — documents, notes
   * and annotations all work without a model, and only Recall State needs one.
   * `saveLLMConfig` runs on the same pass so a first-run default model survives
   * a reload.
   */
  const refreshLlm = async (cfg: LocalLLMConfig) => {
    setLlm({ state: "checking" });
    const status = await probeLocalLLM(cfg);
    setLlm(status);
    if (status.state === "ready" && !status.models.includes(cfg.model)) {
      const preferred = SUGGESTED_MODELS.find(name => status.models.includes(name)) ?? status.models[0];
      const next = { ...cfg, model: preferred };
      setLlmCfg(next);
      saveLLMConfig(next);
    }
  };
  useEffect(() => { void refreshLlm(loadLLMConfig()); }, []);
  useEffect(() => { void converterAvailable().then(setConverter); }, []);

  const activeNote = notes.find(note => note.id === activeNoteId);
  const analysing = sources.find(source => source.id === analysingId) ?? null;
  const filteredSources = sources.filter(source => `${source.name} ${source.text}`.toLowerCase().includes(sourceSearch.toLowerCase()));

  const addFiles = async (files: FileList | File[]) => {
    if (!profileId) return;
    setImporting(true);
    setImportErrors([]);
    try {
      const failures: ImportFailure[] = [];
      let opened: string | null = null;
      for (const file of Array.from(files)) {
        const outcome = await importDocument(file, profileId);
        if (isFailure(outcome)) { failures.push(outcome); continue; }
        await academiaStore.saveSource(outcome);
        opened = opened ?? outcome.id;
      }
      setImportErrors(failures);
      await reload();
      // Importing a document is almost always the first half of looking at it.
      if (opened) setAnalysingId(opened);
    } finally { setImporting(false); }
  };

  const addPastedSource = async () => {
    if (!profileId || !pasteText.trim()) return;
    const source: AcademiaSource = {
      id: uid(), profileId, name: pasteTitle.trim() || "Copied text", kind: "text",
      mimeType: "text/plain", size: new Blob([pasteText]).size, text: pasteText.trim(),
      format: "text", createdAt: Date.now(),
    };
    await academiaStore.saveSource(source);
    setPasteOpen(false); setPasteTitle(""); setPasteText(""); await reload();
  };

  const createNote = async () => {
    if (!profileId) return;
    const now = Date.now();
    const note: AcademiaNote = { id: uid(), profileId, title: "Untitled Note", content: "", createdAt: now, updatedAt: now };
    await academiaStore.saveNote(note);
    setNotes(old => [note, ...old]);
    setActiveNote(note.id);
    setAnalysingId(null);
  };

  const updateNote = (patch: Partial<Pick<AcademiaNote, "title" | "content">>) => {
    if (!activeNote) return;
    const next = { ...activeNote, ...patch, updatedAt: Date.now() };
    setNotes(old => old.map(note => note.id === next.id ? next : note));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void academiaStore.saveNote(next), 350);
  };

  const askSources = () => {
    const queryWords = new Set(keywords(question));
    const candidates = sources.flatMap(source => sentences(source.text).map(sentence => ({ source: source.name, sentence, score: keywords(sentence).filter(word => queryWords.has(word)).length })));
    const matches = candidates.filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 4);
    setAnswer(matches.length ? matches.map(item => `${item.sentence}  [${item.source}]`).join("\n\n") : "I could not locate a strong match in the sources. Try using a more specific term from the material.");
  };

  return (
    <div className="relative flex h-[calc(100vh-132px)] min-h-[650px] overflow-hidden rounded-sm border border-[hsl(220_18%_13%)] bg-[hsl(222_20%_5%)]" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void addFiles(e.dataTransfer.files); }}>
      <div className="pointer-events-none absolute inset-0 opacity-40" style={{ backgroundImage: "linear-gradient(hsl(190 45% 18% / .12) 1px, transparent 1px), linear-gradient(90deg, hsl(190 45% 18% / .12) 1px, transparent 1px)", backgroundSize: "32px 32px" }} />

      {leftOpen && <aside className="relative z-10 flex w-[270px] shrink-0 flex-col border-r border-[hsl(220_18%_13%)] bg-[hsl(222_18%_6%/.92)]">
        <PanelHeader icon={Database} label="Sources" action={<button onClick={() => setLeftOpen(false)} className="text-muted-foreground/40 hover:text-foreground"><PanelLeftClose size={14} /></button>} />
        <div className="space-y-2 p-3">
          <button onClick={() => fileRef.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-sm border border-[hsl(190_42%_23%)] bg-[hsl(190_32%_9%)] py-2 text-[10px] font-mono tracking-widest text-[hsl(190_65%_65%)] hover:border-[hsl(190_55%_38%)]"><Plus size={13} /> ADD SOURCES</button>
          <input ref={fileRef} type="file" accept={ACCEPTED_EXTENSIONS} multiple className="hidden" onChange={e => { if (e.target.files) void addFiles(e.target.files); e.currentTarget.value = ""; }} />
          <button onClick={() => setPasteOpen(true)} className="flex w-full items-center justify-center gap-2 rounded-sm border border-[hsl(220_17%_16%)] py-1.5 text-[9px] font-mono text-muted-foreground hover:text-foreground"><NotebookPen size={11} /> PASTE TEXT</button>
          <div className="relative"><Search size={12} className="absolute left-2 top-2 text-muted-foreground/40" /><input value={sourceSearch} onChange={e => setSourceSearch(e.target.value)} placeholder="Search source matrix" className="w-full rounded-sm border border-[hsl(220_18%_14%)] bg-[hsl(222_20%_4%)] py-1.5 pl-7 pr-2 text-[9px] text-foreground outline-none focus:border-[hsl(190_45%_30%)]" /></div>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto px-3 pb-3">
          {importing && <div className="flex items-center justify-center gap-2 py-6 text-[9px] font-mono text-[hsl(190_55%_55%)]"><Loader2 size={13} className="animate-spin" /> PREPARING DOCUMENT</div>}
          {!importing && filteredSources.length === 0 && <Empty icon={Upload} title="No source material" text="Drop PDFs, Word or PowerPoint files anywhere in the Forge." />}
          {filteredSources.map(source => <div key={source.id} className={cn("group flex items-start gap-2 rounded-sm border p-2", analysingId === source.id ? "border-[hsl(190_45%_28%)] bg-[hsl(190_30%_9%/.6)]" : "border-transparent hover:border-[hsl(220_18%_15%)] hover:bg-[hsl(220_16%_8%)]")}>
            <button onClick={() => setAnalysingId(source.id)} className="min-w-0 flex-1 text-left">
              <div className="flex items-center gap-1.5">
                <FileText size={12} style={{ color: source.kind === "pdf" ? "hsl(5 60% 62%)" : CYAN }} />
                <span className="truncate text-[10px] text-foreground/75">{source.name}</span>
              </div>
              <p className="mt-1 text-[8px] font-mono text-muted-foreground/35">
                {(source.format ?? source.kind).toUpperCase()} · {Math.max(1, Math.round(source.size / 1024))} KB
                {source.format && source.format !== "pdf" && source.format !== "text" ? " · CONVERTED" : ""}
              </p>
            </button>
            <button onClick={async () => {
              await academiaStore.deleteSource(source.id);
              setAnalysingId(old => (old === source.id ? null : old));
              await reload();
            }} className="opacity-0 text-rose-400/50 group-hover:opacity-100"><Trash2 size={11} /></button>
          </div>)}
        </div>
        <div className="space-y-1.5 border-t border-[hsl(220_18%_12%)] px-3 py-2">
          <p className="text-[8px] font-mono tracking-widest text-muted-foreground/30">{sources.length} DOCUMENT{sources.length === 1 ? "" : "S"}</p>
          {!converter && <p className="text-[8px] leading-4 text-muted-foreground/30">
            Word and PowerPoint files need LibreOffice on this machine; PDFs never do.
          </p>}
          {importErrors.map(failure => <p key={failure.name} className="rounded-sm border border-[hsl(43_40%_26%)] bg-[hsl(43_30%_8%/.5)] p-2 text-[8px] leading-4 text-[hsl(43_75%_66%)]">
            {describeImportFailure(failure)}
          </p>)}
        </div>
      </aside>}

      <main className="relative z-10 flex min-w-0 flex-1 flex-col bg-[radial-gradient(circle_at_50%_15%,hsl(190_35%_11%/.38),transparent_36%)]">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[hsl(220_18%_13%)] px-4">
          {!leftOpen && <button onClick={() => setLeftOpen(true)} className="text-muted-foreground/40 hover:text-foreground"><PanelLeftClose size={14} className="rotate-180" /></button>}
          <div className="flex h-7 w-7 items-center justify-center rounded-full border border-[hsl(190_52%_25%)] bg-[hsl(190_35%_9%)]"><GraduationCap size={15} color={CYAN} /></div>
          <div>
            <h2 className="font-display text-xs tracking-[.16em] text-[hsl(190_62%_68%)]">ACADEMIA</h2>
            <p className="text-[7px] font-mono tracking-[.18em] text-muted-foreground/35">{analysing ? "ANALYSIS STATE" : "KNOWLEDGE FORGE"}</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {analysing && <button onClick={() => setAnalysingId(null)} title="Back to the notebook"
              className="flex items-center gap-1 rounded-sm border border-[hsl(220_18%_20%)] px-2 py-1 text-[8px] font-mono tracking-widest text-muted-foreground/60 hover:text-foreground"><NotebookPen size={10} /> NOTEBOOK</button>}
            <select value={activeNoteId ?? ""} onChange={e => { setActiveNote(e.target.value || null); setAnalysingId(null); }} className="max-w-48 rounded-sm border border-[hsl(220_18%_16%)] bg-[hsl(222_18%_6%)] px-2 py-1 text-[9px] text-muted-foreground outline-none">
              {notes.length === 0 && <option value="">No notes</option>}
              {notes.map(note => <option key={note.id} value={note.id}>{note.title}</option>)}
            </select>
            <button onClick={() => void createNote()} className="flex items-center gap-1 rounded-sm border border-[hsl(190_40%_22%)] px-2 py-1 text-[8px] font-mono text-[hsl(190_60%_62%)]"><Plus size={10} /> NOTE</button>
            {!rightOpen && <button onClick={() => setRightOpen(true)} className="text-muted-foreground/40 hover:text-foreground"><PanelRightClose size={14} className="rotate-180" /></button>}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col p-5">
          {analysing
            ? <AnalysisState source={analysing} onClose={() => setAnalysingId(null)} />
            : <>
                {activeNote ? <div className="flex min-h-0 flex-1 flex-col rounded-sm border border-[hsl(220_18%_14%)] bg-[hsl(222_18%_6%/.72)] shadow-[inset_0_1px_0_hsl(190_50%_50%/.04)]">
                  <div className="flex items-center gap-2 border-b border-[hsl(220_18%_13%)] px-4 py-2">
                    <NotebookPen size={13} color={VIOLET} />
                    <input value={activeNote.title} onChange={e => updateNote({ title: e.target.value })} className="flex-1 bg-transparent font-display text-sm tracking-wide text-foreground/85 outline-none" />
                    <span className="text-[7px] font-mono tracking-widest text-muted-foreground/25">AUTO-SAVED</span>
                    <button onClick={async () => { await academiaStore.deleteNote(activeNote.id); await academiaStore.deleteLedger(noteCorpusId(activeNote.id)); await academiaStore.deleteBank(noteCorpusId(activeNote.id)); await reload(); }} className="text-rose-400/35 hover:text-rose-400"><Trash2 size={12} /></button>
                  </div>
                  <textarea value={activeNote.content} onChange={e => updateNote({ content: e.target.value })} placeholder="Build the note. Distill sources, connect ideas, and shape what you know…" className="min-h-0 flex-1 resize-none bg-transparent p-5 text-[13px] leading-7 text-foreground/75 outline-none placeholder:text-muted-foreground/18" />
                </div> : <button onClick={() => void createNote()} className="flex min-h-0 flex-1 items-center justify-center rounded-sm border border-dashed border-[hsl(190_30%_18%)]"><Empty icon={NotebookPen} title="Initialize a notebook" text="Create a note to synthesize your sources." /></button>}

                <div className="mt-3 shrink-0 rounded-sm border border-[hsl(190_28%_17%)] bg-[hsl(222_20%_4%/.8)] p-2.5">
                  <div className="flex gap-2">
                    <MessageSquareText size={14} className="mt-1 text-cyan-400/60" />
                    <textarea value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); askSources(); } }} rows={2} placeholder="Ask the sources…" className="flex-1 resize-none bg-transparent text-[11px] leading-5 text-foreground/70 outline-none placeholder:text-muted-foreground/25" />
                    <button onClick={askSources} disabled={!question.trim() || !sources.length} className="self-end rounded-sm border border-[hsl(190_42%_26%)] bg-[hsl(190_34%_10%)] px-3 py-1.5 text-[8px] font-mono tracking-widest text-cyan-300 disabled:opacity-25">TRACE</button>
                  </div>
                  {answer && <div className="mt-2 border-t border-[hsl(220_18%_12%)] px-6 pt-2 text-[10px] leading-5 text-foreground/58 whitespace-pre-wrap">{answer}</div>}
                </div>
              </>}
        </div>
      </main>

      {rightOpen && <aside className="relative z-10 flex w-[290px] shrink-0 flex-col border-l border-[hsl(220_18%_13%)] bg-[hsl(222_18%_6%/.92)]">
        <PanelHeader icon={ScanEye} label="Study" action={<button onClick={() => setRightOpen(false)} className="text-muted-foreground/40 hover:text-foreground"><PanelRightClose size={14} /></button>} />
        <div className="space-y-2 p-3">
          <Link href="/academia/recall">
            <button
              onClick={() => { if (!recall?.active) recall?.reset(); }}
              disabled={!recall?.active && !activeNote?.content.trim()}
              title={recall?.active ? "Back to the run in progress" : activeNote?.content.trim() ? "Drill the note that is open" : "Write something in a note first"}
              className="flex w-full items-center justify-center gap-2 rounded-sm border border-[hsl(270_45%_32%)] bg-[hsl(270_38%_10%)] py-2 text-[9px] font-mono tracking-[.18em] text-[hsl(270_65%_78%)] hover:border-[hsl(270_58%_50%)] disabled:opacity-25"
            >
              <Dices size={12} /> {recall?.active ? "RESUME RECALL" : "RECALL STATE"}
            </button>
          </Link>
          <p className="text-[8px] leading-4 text-muted-foreground/30">
            Recall State drills the note that is open. Documents are for reading and annotating.
          </p>
          <div className="h-px bg-[hsl(220_18%_13%)]" />
          {llm.state === "ready"
            ? <ModelRow models={llm.models} cfg={llmCfg} onChange={next => { setLlmCfg(next); saveLLMConfig(next); }} onRefresh={() => void refreshLlm(llmCfg)} onDiagnose={() => setShowDiagnostics(value => !value)} />
            : <SetupCard status={llm} endpoint={llmCfg.endpoint} onRetry={() => void refreshLlm(llmCfg)} />}
          {showDiagnostics && <LlmDiagnostics cfg={llmCfg} onClose={() => setShowDiagnostics(false)} />}
        </div>
        <div className="mx-3 h-px bg-[hsl(220_18%_13%)]" />
        {/* The rail's lower half is the Archive: the thing most worth a glance
            while writing a note. Editing stays on the page behind the expand. */}
        <FlashcardRail />
      </aside>}

      {pasteOpen && <Modal onClose={() => setPasteOpen(false)} title="Add copied text"><input value={pasteTitle} onChange={e => setPasteTitle(e.target.value)} placeholder="Source title" className={fieldClass} /><textarea value={pasteText} onChange={e => setPasteText(e.target.value)} rows={12} placeholder="Paste source material…" className={cn(fieldClass, "resize-none leading-5")} /><button onClick={() => void addPastedSource()} disabled={!pasteText.trim()} className={primaryButton}>ADD TO SOURCE MATRIX</button></Modal>}
    </div>
  );
}

function PanelHeader({ icon: Icon, label, action }: { icon: typeof Database; label: string; action: React.ReactNode }) { return <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[hsl(220_18%_13%)] px-4"><Icon size={13} className="text-muted-foreground/50" /><span className="text-[10px] font-mono tracking-[.18em] text-foreground/60 uppercase">{label}</span><div className="ml-auto">{action}</div></div>; }
function Empty({ icon: Icon, title, text }: { icon: typeof Upload; title: string; text: string }) { return <div className="flex flex-col items-center justify-center px-4 py-10 text-center"><Icon size={24} className="mb-3 text-muted-foreground/18" /><p className="text-[10px] text-muted-foreground/45">{title}</p><p className="mt-1 max-w-44 text-[8px] leading-4 text-muted-foreground/25">{text}</p></div>; }

/**
 * Which model Recall State talks to.
 *
 * Shown rather than hidden in a settings page because it is the single thing
 * that decides whether the questions are worth answering, and swapping models
 * to compare is the normal way to find that out.
 */
function ModelRow({ models, cfg, onChange, onRefresh, onDiagnose }: { models: string[]; cfg: LocalLLMConfig; onChange: (cfg: LocalLLMConfig) => void; onRefresh: () => void; onDiagnose: () => void }) {
  return <div className="flex items-center gap-1.5">
    <Cpu size={11} className="shrink-0 text-cyan-400/55" />
    <select value={cfg.model} onChange={e => onChange({ ...cfg, model: e.target.value })} className="min-w-0 flex-1 rounded-sm border border-[hsl(220_18%_16%)] bg-[hsl(222_20%_4%)] px-1.5 py-1 text-[8px] font-mono text-muted-foreground outline-none focus:border-[hsl(190_45%_30%)]">
      {models.map(name => <option key={name} value={name}>{name}</option>)}
    </select>
    <button onClick={onRefresh} title="Re-check Ollama" className="shrink-0 text-muted-foreground/40 hover:text-foreground"><RefreshCw size={11} /></button>
    <button onClick={onDiagnose} title="What the model is doing, and what this runtime supports" className="shrink-0 text-muted-foreground/40 hover:text-foreground"><Activity size={11} /></button>
  </div>;
}

/**
 * What the Forge says when there is no model to talk to.
 *
 * Everything here except Recall State's question writing works without one, so
 * this is information rather than an error.
 */
function SetupCard({ status, endpoint, onRetry }: { status: LLMStatus; endpoint: string; onRetry: () => void }) {
  if (status.state === "checking") return <div className="flex items-center justify-center gap-2 py-6 text-[9px] font-mono tracking-widest text-[hsl(190_55%_55%)]"><Loader2 size={13} className="animate-spin" /> LOCATING MODEL</div>;
  const noModels = status.state === "no-models";
  return <div className="space-y-2 rounded-sm border border-[hsl(43_45%_26%)] bg-[hsl(43_30%_8%/.5)] p-3">
    <p className="text-[9px] font-mono tracking-[.16em] text-[hsl(43_80%_66%)]">{noModels ? "NO MODEL PULLED" : "NO LOCAL MODEL"}</p>
    <p className="text-[9px] leading-4 text-muted-foreground/60">
      {noModels
        ? "Ollama is running but has nothing to run. Pull a model and re-check."
        : `${status.state === "unreachable" ? status.message : "No model"}. Recall State writes its questions on this machine and costs nothing — it needs Ollama listening on ${endpoint}.`}
    </p>
    <code className="block rounded-sm border border-[hsl(220_18%_16%)] bg-[hsl(222_20%_4%)] px-2 py-1.5 text-[8.5px] text-[hsl(190_60%_66%)]">ollama pull {SUGGESTED_MODELS[0]}</code>
    <button onClick={onRetry} className="flex w-full items-center justify-center gap-1.5 rounded-sm border border-[hsl(220_18%_18%)] py-1.5 text-[8px] font-mono tracking-widest text-muted-foreground hover:text-foreground"><RefreshCw size={10} /> RE-CHECK</button>
  </div>;
}

function Modal({ onClose, title, wide, children }: { onClose: () => void; title: string; wide?: boolean; children: React.ReactNode }) { return <div className="absolute inset-0 z-50 flex items-center justify-center bg-[hsl(222_30%_2%/.78)] p-6 backdrop-blur-sm" onMouseDown={e => { if (e.currentTarget === e.target) onClose(); }}><div className={cn("w-full space-y-3 rounded-sm border border-[hsl(190_38%_24%)] bg-[hsl(222_20%_6%)] p-4 shadow-2xl", wide ? "max-w-3xl" : "max-w-lg")}><div className="flex items-center"><span className="text-[10px] font-mono tracking-[.14em] text-cyan-200/70 uppercase">{title}</span><button onClick={onClose} className="ml-auto text-muted-foreground/45 hover:text-foreground"><X size={14} /></button></div>{children}</div></div>; }
const fieldClass = "w-full rounded-sm border border-[hsl(220_18%_16%)] bg-[hsl(222_20%_4%)] px-3 py-2 text-[10px] text-foreground/75 outline-none focus:border-[hsl(190_45%_30%)]";
const primaryButton = "w-full rounded-sm border border-[hsl(190_48%_30%)] bg-[hsl(190_38%_10%)] py-2 text-[9px] font-mono tracking-widest text-cyan-200 disabled:opacity-30";
