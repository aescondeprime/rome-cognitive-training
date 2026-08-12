import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  BookOpenText, BrainCircuit, Check, Database, FileAudio, FileChartColumn, FileQuestion,
  FileText, Film, GraduationCap, Loader2, MessageSquareText, Mic2, Network,
  NotebookPen, PanelLeftClose, PanelRightClose, Play, Plus, Presentation, Search,
  Sparkles, Square, Table2, Trash2, Upload, WandSparkles, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { academiaStore, type AcademiaNote, type AcademiaSource, type StudioArtifact, type StudioKind } from "@/lib/academiaStore";

const CYAN = "hsl(190 72% 60%)";
const VIOLET = "hsl(270 62% 70%)";
const GOLD = "hsl(43 88% 62%)";

const STUDIO: Array<{ kind: StudioKind; label: string; icon: typeof Mic2; color: string; description: string }> = [
  { kind: "audio", label: "Audio Overview", icon: Mic2, color: "hsl(235 54% 70%)", description: "Spoken two-voice briefing" },
  { kind: "slides", label: "Slide Deck", icon: Presentation, color: "hsl(58 50% 68%)", description: "Structured presentation outline" },
  { kind: "video", label: "Video Overview", icon: Film, color: "hsl(142 38% 65%)", description: "Narrated visual storyboard" },
  { kind: "mindmap", label: "Mind Map", icon: Network, color: "hsl(304 38% 70%)", description: "Concept hierarchy and links" },
  { kind: "report", label: "Report", icon: FileChartColumn, color: "hsl(49 45% 67%)", description: "Source-grounded synthesis" },
  { kind: "flashcards", label: "Flashcards", icon: BookOpenText, color: "hsl(6 42% 72%)", description: "Recall prompts and answers" },
  { kind: "quiz", label: "Quiz", icon: FileQuestion, color: "hsl(187 42% 70%)", description: "Knowledge check with key" },
  { kind: "infographic", label: "Infographic", icon: BrainCircuit, color: "hsl(309 36% 68%)", description: "Visual information brief" },
  { kind: "table", label: "Data Table", icon: Table2, color: "hsl(245 36% 70%)", description: "Extracted evidence matrix" },
];

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

function sourceCorpus(sources: AcademiaSource[], note?: AcademiaNote) {
  return [...sources.map(s => `SOURCE: ${s.name}\n${s.text}`), note?.content ? `NOTE: ${note.title}\n${note.content}` : ""].filter(Boolean).join("\n\n").slice(0, 120_000);
}

function buildArtifact(kind: StudioKind, corpus: string, sources: AcademiaSource[], note?: AcademiaNote) {
  const facts = sentences(corpus).slice(0, 18);
  const terms = keywords(corpus);
  const fallback = "Add richer notes or PDF sources to generate a more detailed artifact.";
  const take = (index: number) => facts[index % Math.max(1, facts.length)] ?? fallback;
  const subject = note?.title || sources[0]?.name?.replace(/\.pdf$/i, "") || "Academia Brief";

  if (kind === "audio") return `AUDIO OVERVIEW · ${subject}\n\nHOST: Today we are mapping the central ideas in ${subject}.\nANALYST: ${take(0)}\nHOST: What should we connect that to?\nANALYST: ${take(1)}\nHOST: Give us the practical meaning.\nANALYST: ${take(2)}\nHOST: And the point worth remembering?\nANALYST: ${take(3)}\n\nKEY TERMS: ${terms.slice(0, 6).join(" · ")}`;
  if (kind === "slides") return [`SLIDE DECK · ${subject}`, "", "01 · ORIENTATION", take(0), "", "02 · CORE MECHANISM", take(1), "", "03 · EVIDENCE", take(2), "", "04 · CONNECTIONS", take(3), "", "05 · APPLICATION", take(4), "", "06 · FINAL SYNTHESIS", take(5)].join("\n");
  if (kind === "video") return [`VIDEO STORYBOARD · ${subject}`, "", "SCENE 01 · OPENING SIGNAL", `Visual: Geometric title field\nNarration: ${take(0)}`, "", "SCENE 02 · CONCEPT MODEL", `Visual: Connected concept nodes\nNarration: ${take(1)}`, "", "SCENE 03 · EVIDENCE LAYER", `Visual: Source fragments converge\nNarration: ${take(2)}`, "", "SCENE 04 · APPLICATION", `Visual: Decision pathway\nNarration: ${take(3)}`, "", "SCENE 05 · RECAP", `Visual: Key terms orbit the core\nNarration: ${take(4)}`].join("\n");
  if (kind === "mindmap") return [`MIND MAP · ${subject}`, "", `◆ ${subject}`, ...terms.slice(0, 6).flatMap((term, i) => [`  ├─ ${term.toUpperCase()}`, `  │  └─ ${take(i)}`])].join("\n");
  if (kind === "report") return [`SYNTHESIS REPORT · ${subject}`, "", "EXECUTIVE SIGNAL", take(0), "", "CORE FINDINGS", ...facts.slice(1, 6).map((v, i) => `${i + 1}. ${v}`), "", "CONCEPTUAL CONNECTIONS", terms.slice(0, 8).join(" · "), "", "CONCLUSION", take(6)].join("\n");
  if (kind === "flashcards") return [`FLASHCARD SET · ${subject}`, "", ...facts.slice(0, 10).flatMap((fact, i) => [`CARD ${String(i + 1).padStart(2, "0")}`, `Q: What key claim should you recall about ${terms[i % Math.max(1, terms.length)] ?? "this topic"}?`, `A: ${fact}`, ""])].join("\n");
  if (kind === "quiz") return [`QUIZ · ${subject}`, "", ...facts.slice(0, 7).flatMap((fact, i) => [`${i + 1}. Which statement is supported by the selected material?`, `A. ${take(i + 2)}`, `B. ${fact}`, `C. The material does not address the topic.`, `D. The opposite relationship is established.`, `KEY: B`, ""])].join("\n");
  if (kind === "infographic") return [`INFOGRAPHIC BRIEF · ${subject}`, "", `SIGNAL 01  ${terms[0]?.toUpperCase() ?? "CORE"}\n${take(0)}`, "", `SIGNAL 02  ${terms[1]?.toUpperCase() ?? "EVIDENCE"}\n${take(1)}`, "", `SIGNAL 03  ${terms[2]?.toUpperCase() ?? "ACTION"}\n${take(2)}`, "", `AT A GLANCE\n${sources.length} source${sources.length === 1 ? "" : "s"} · ${facts.length} evidence statements · ${terms.length} key concepts`].join("\n");
  return [`DATA TABLE · ${subject}`, "", "SOURCE | TYPE | SIZE | EXTRACTED SIGNAL", "--- | --- | --- | ---", ...sources.map((source, i) => `${source.name} | ${source.kind.toUpperCase()} | ${source.size ? `${Math.max(1, Math.round(source.size / 1024))} KB` : "TEXT"} | ${take(i).replace(/\|/g, "/")}`)].join("\n");
}

async function extractPdf(file: File) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map(item => "str" in item ? item.str : "").join(" "));
  }
  return pages.join("\n\n");
}

export default function Academia() {
  const { data: profile } = useQuery<{ id: number }>({ queryKey: ["/api/active-profile"] });
  const profileId = profile?.id;
  const [sources, setSources] = useState<AcademiaSource[]>([]);
  const [notes, setNotes] = useState<AcademiaNote[]>([]);
  const [artifacts, setArtifacts] = useState<StudioArtifact[]>([]);
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set());
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [sourceSearch, setSourceSearch] = useState("");
  const [loadingFile, setLoadingFile] = useState(false);
  const [generating, setGenerating] = useState<StudioKind | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [artifactOpen, setArtifactOpen] = useState<StudioArtifact | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<number | null>(null);
  const loadedProfileId = useRef<number | null>(null);

  const reload = async () => {
    if (!profileId) return;
    const profileChanged = loadedProfileId.current !== profileId;
    loadedProfileId.current = profileId;
    const [nextSources, nextNotes, nextArtifacts] = await Promise.all([academiaStore.sources(profileId), academiaStore.notes(profileId), academiaStore.artifacts(profileId)]);
    setSources(nextSources);
    setNotes(nextNotes);
    setArtifacts(nextArtifacts);
    setSelectedSources(old => profileChanged
      ? new Set(nextSources.map(source => source.id))
      : new Set(Array.from(old).filter(id => nextSources.some(source => source.id === id))));
    setActiveNoteId(old => old && nextNotes.some(note => note.id === old) ? old : nextNotes[0]?.id ?? null);
  };

  useEffect(() => { void reload(); }, [profileId]);
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); window.speechSynthesis?.cancel(); }, []);

  const activeNote = notes.find(note => note.id === activeNoteId);
  const filteredSources = sources.filter(source => `${source.name} ${source.text}`.toLowerCase().includes(sourceSearch.toLowerCase()));
  const chosenSources = sources.filter(source => selectedSources.has(source.id));

  const addFiles = async (files: FileList | File[]) => {
    if (!profileId) return;
    setLoadingFile(true);
    try {
      for (const file of Array.from(files)) {
        const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
        if (!isPdf && !file.type.startsWith("text/") && !/\.(md|txt)$/i.test(file.name)) continue;
        const text = isPdf ? await extractPdf(file) : await file.text();
        const source: AcademiaSource = { id: uid(), profileId, name: file.name, kind: isPdf ? "pdf" : "text", mimeType: file.type || "text/plain", size: file.size, text, file, createdAt: Date.now() };
        await academiaStore.saveSource(source);
        setSelectedSources(old => new Set(old).add(source.id));
      }
      await reload();
    } finally { setLoadingFile(false); }
  };

  const addPastedSource = async () => {
    if (!profileId || !pasteText.trim()) return;
    const source: AcademiaSource = { id: uid(), profileId, name: pasteTitle.trim() || "Copied text", kind: "text", mimeType: "text/plain", size: new Blob([pasteText]).size, text: pasteText.trim(), createdAt: Date.now() };
    await academiaStore.saveSource(source);
    setSelectedSources(old => new Set(old).add(source.id));
    setPasteOpen(false); setPasteTitle(""); setPasteText(""); await reload();
  };

  const createNote = async () => {
    if (!profileId) return;
    const now = Date.now();
    const note: AcademiaNote = { id: uid(), profileId, title: "Untitled Note", content: "", createdAt: now, updatedAt: now };
    await academiaStore.saveNote(note); setNotes(old => [note, ...old]); setActiveNoteId(note.id);
  };

  const updateNote = (patch: Partial<Pick<AcademiaNote, "title" | "content">>) => {
    if (!activeNote) return;
    const next = { ...activeNote, ...patch, updatedAt: Date.now() };
    setNotes(old => old.map(note => note.id === next.id ? next : note));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void academiaStore.saveNote(next), 350);
  };

  const createArtifact = async (kind: StudioKind) => {
    if (!profileId || (!chosenSources.length && !activeNote?.content.trim())) return;
    setGenerating(kind);
    await new Promise(resolve => setTimeout(resolve, 380));
    const meta = STUDIO.find(item => item.kind === kind)!;
    const artifact: StudioArtifact = {
      id: uid(), profileId, kind, title: `${meta.label} · ${activeNote?.title || chosenSources[0]?.name || "Academia"}`,
      content: buildArtifact(kind, sourceCorpus(chosenSources, activeNote), chosenSources, activeNote),
      sourceIds: chosenSources.map(source => source.id), createdAt: Date.now(),
    };
    await academiaStore.saveArtifact(artifact); setArtifacts(old => [artifact, ...old]); setArtifactOpen(artifact); setGenerating(null);
  };

  const askSources = () => {
    const queryWords = new Set(keywords(question));
    const candidates = chosenSources.flatMap(source => sentences(source.text).map(sentence => ({ source: source.name, sentence, score: keywords(sentence).filter(word => queryWords.has(word)).length })));
    const matches = candidates.filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 4);
    setAnswer(matches.length ? matches.map(item => `${item.sentence}  [${item.source}]`).join("\n\n") : "I could not locate a strong match in the selected sources. Try using a more specific term from the material.");
  };

  const openSource = (source: AcademiaSource) => {
    if (!source.file) return;
    const url = URL.createObjectURL(source.file);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const speakArtifact = (artifact: StudioArtifact) => {
    if (!("speechSynthesis" in window)) return;
    if (speaking) { speechSynthesis.cancel(); setSpeaking(false); return; }
    const utterance = new SpeechSynthesisUtterance(artifact.content.replace(/^[A-Z ]+:/gm, ""));
    utterance.rate = .96; utterance.pitch = .95; utterance.onend = () => setSpeaking(false); utterance.onerror = () => setSpeaking(false);
    speechSynthesis.speak(utterance); setSpeaking(true);
  };

  return (
    <div className="relative flex h-[calc(100vh-132px)] min-h-[650px] overflow-hidden rounded-sm border border-[hsl(220_18%_13%)] bg-[hsl(222_20%_5%)]" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void addFiles(e.dataTransfer.files); }}>
      <div className="pointer-events-none absolute inset-0 opacity-40" style={{ backgroundImage: "linear-gradient(hsl(190 45% 18% / .12) 1px, transparent 1px), linear-gradient(90deg, hsl(190 45% 18% / .12) 1px, transparent 1px)", backgroundSize: "32px 32px" }} />

      {leftOpen && <aside className="relative z-10 flex w-[270px] shrink-0 flex-col border-r border-[hsl(220_18%_13%)] bg-[hsl(222_18%_6%/.92)]">
        <PanelHeader icon={Database} label="Sources" action={<button onClick={() => setLeftOpen(false)} className="text-muted-foreground/40 hover:text-foreground"><PanelLeftClose size={14} /></button>} />
        <div className="space-y-2 p-3">
          <button onClick={() => fileRef.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-sm border border-[hsl(190_42%_23%)] bg-[hsl(190_32%_9%)] py-2 text-[10px] font-mono tracking-widest text-[hsl(190_65%_65%)] hover:border-[hsl(190_55%_38%)]"><Plus size={13} /> ADD SOURCES</button>
          <input ref={fileRef} type="file" accept="application/pdf,text/plain,text/markdown,.pdf,.txt,.md" multiple className="hidden" onChange={e => { if (e.target.files) void addFiles(e.target.files); e.currentTarget.value = ""; }} />
          <button onClick={() => setPasteOpen(true)} className="flex w-full items-center justify-center gap-2 rounded-sm border border-[hsl(220_17%_16%)] py-1.5 text-[9px] font-mono text-muted-foreground hover:text-foreground"><NotebookPen size={11} /> PASTE TEXT</button>
          <div className="relative"><Search size={12} className="absolute left-2 top-2 text-muted-foreground/40" /><input value={sourceSearch} onChange={e => setSourceSearch(e.target.value)} placeholder="Search source matrix" className="w-full rounded-sm border border-[hsl(220_18%_14%)] bg-[hsl(222_20%_4%)] py-1.5 pl-7 pr-2 text-[9px] text-foreground outline-none focus:border-[hsl(190_45%_30%)]" /></div>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto px-3 pb-3">
          {loadingFile && <div className="flex items-center justify-center gap-2 py-6 text-[9px] font-mono text-[hsl(190_55%_55%)]"><Loader2 size={13} className="animate-spin" /> EXTRACTING SOURCE</div>}
          {!loadingFile && filteredSources.length === 0 && <Empty icon={Upload} title="No source material" text="Drop PDFs or text files anywhere in Academia." />}
          {filteredSources.map(source => <div key={source.id} className="group flex items-start gap-2 rounded-sm border border-transparent p-2 hover:border-[hsl(220_18%_15%)] hover:bg-[hsl(220_16%_8%)]">
            <button onClick={() => setSelectedSources(old => { const next = new Set(old); next.has(source.id) ? next.delete(source.id) : next.add(source.id); return next; })} className={cn("mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border", selectedSources.has(source.id) ? "border-cyan-500/60 bg-cyan-500/15 text-cyan-300" : "border-white/15 text-transparent")}><Check size={9} /></button>
            <button onClick={() => openSource(source)} className="min-w-0 flex-1 text-left"><div className="flex items-center gap-1.5"><FileText size={12} style={{ color: source.kind === "pdf" ? "hsl(5 60% 62%)" : CYAN }} /><span className="truncate text-[10px] text-foreground/75">{source.name}</span></div><p className="mt-1 text-[8px] font-mono text-muted-foreground/35">{source.kind.toUpperCase()} · {Math.max(1, Math.round(source.size / 1024))} KB</p></button>
            <button onClick={async () => { await academiaStore.deleteSource(source.id); setSelectedSources(old => { const n = new Set(old); n.delete(source.id); return n; }); await reload(); }} className="opacity-0 text-rose-400/50 group-hover:opacity-100"><Trash2 size={11} /></button>
          </div>)}
        </div>
        <div className="border-t border-[hsl(220_18%_12%)] px-3 py-2 text-[8px] font-mono tracking-widest text-muted-foreground/30">{selectedSources.size} / {sources.length} SOURCES ARMED</div>
      </aside>}

      <main className="relative z-10 flex min-w-0 flex-1 flex-col bg-[radial-gradient(circle_at_50%_15%,hsl(190_35%_11%/.38),transparent_36%)]">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[hsl(220_18%_13%)] px-4">
          {!leftOpen && <button onClick={() => setLeftOpen(true)} className="text-muted-foreground/40 hover:text-foreground"><PanelLeftClose size={14} className="rotate-180" /></button>}
          <div className="flex h-7 w-7 items-center justify-center rounded-full border border-[hsl(190_52%_25%)] bg-[hsl(190_35%_9%)]"><GraduationCap size={15} color={CYAN} /></div>
          <div><h2 className="font-display text-xs tracking-[.16em] text-[hsl(190_62%_68%)]">ACADEMIA</h2><p className="text-[7px] font-mono tracking-[.18em] text-muted-foreground/35">SOURCE-GROUNDED KNOWLEDGE FORGE</p></div>
          <div className="ml-auto flex items-center gap-2"><select value={activeNoteId ?? ""} onChange={e => setActiveNoteId(e.target.value || null)} className="max-w-48 rounded-sm border border-[hsl(220_18%_16%)] bg-[hsl(222_18%_6%)] px-2 py-1 text-[9px] text-muted-foreground outline-none">{notes.length === 0 && <option value="">No notes</option>}{notes.map(note => <option key={note.id} value={note.id}>{note.title}</option>)}</select><button onClick={() => void createNote()} className="flex items-center gap-1 rounded-sm border border-[hsl(190_40%_22%)] px-2 py-1 text-[8px] font-mono text-[hsl(190_60%_62%)]"><Plus size={10} /> NOTE</button>{!rightOpen && <button onClick={() => setRightOpen(true)} className="text-muted-foreground/40 hover:text-foreground"><PanelRightClose size={14} className="rotate-180" /></button>}</div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col p-5">
          {activeNote ? <div className="flex min-h-0 flex-1 flex-col rounded-sm border border-[hsl(220_18%_14%)] bg-[hsl(222_18%_6%/.72)] shadow-[inset_0_1px_0_hsl(190_50%_50%/.04)]">
            <div className="flex items-center gap-2 border-b border-[hsl(220_18%_13%)] px-4 py-2"><NotebookPen size={13} color={VIOLET} /><input value={activeNote.title} onChange={e => updateNote({ title: e.target.value })} className="flex-1 bg-transparent font-display text-sm tracking-wide text-foreground/85 outline-none" /><span className="text-[7px] font-mono tracking-widest text-muted-foreground/25">AUTO-SAVED</span><button onClick={async () => { await academiaStore.deleteNote(activeNote.id); await reload(); }} className="text-rose-400/35 hover:text-rose-400"><Trash2 size={12} /></button></div>
            <textarea value={activeNote.content} onChange={e => updateNote({ content: e.target.value })} placeholder="Build the note. Distill sources, connect ideas, and shape what you know…" className="min-h-0 flex-1 resize-none bg-transparent p-5 text-[13px] leading-7 text-foreground/75 outline-none placeholder:text-muted-foreground/18" />
          </div> : <button onClick={() => void createNote()} className="flex min-h-0 flex-1 items-center justify-center rounded-sm border border-dashed border-[hsl(190_30%_18%)]"><Empty icon={NotebookPen} title="Initialize a notebook" text="Create a note to synthesize your sources." /></button>}

          <div className="mt-3 shrink-0 rounded-sm border border-[hsl(190_28%_17%)] bg-[hsl(222_20%_4%/.8)] p-2.5">
            <div className="flex gap-2"><MessageSquareText size={14} className="mt-1 text-cyan-400/60" /><textarea value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); askSources(); } }} rows={2} placeholder="Ask the selected sources…" className="flex-1 resize-none bg-transparent text-[11px] leading-5 text-foreground/70 outline-none placeholder:text-muted-foreground/25" /><button onClick={askSources} disabled={!question.trim() || !chosenSources.length} className="self-end rounded-sm border border-[hsl(190_42%_26%)] bg-[hsl(190_34%_10%)] px-3 py-1.5 text-[8px] font-mono tracking-widest text-cyan-300 disabled:opacity-25">TRACE</button></div>
            {answer && <div className="mt-2 border-t border-[hsl(220_18%_12%)] px-6 pt-2 text-[10px] leading-5 text-foreground/58 whitespace-pre-wrap">{answer}</div>}
          </div>
        </div>
      </main>

      {rightOpen && <aside className="relative z-10 flex w-[310px] shrink-0 flex-col border-l border-[hsl(220_18%_13%)] bg-[hsl(222_18%_6%/.92)]">
        <PanelHeader icon={WandSparkles} label="Studio" action={<button onClick={() => setRightOpen(false)} className="text-muted-foreground/40 hover:text-foreground"><PanelRightClose size={14} /></button>} />
        <div className="grid grid-cols-2 gap-2 p-3">{STUDIO.map(item => <StudioButton key={item.kind} item={item} loading={generating === item.kind} disabled={!chosenSources.length && !activeNote?.content.trim()} onClick={() => void createArtifact(item.kind)} />)}</div>
        <div className="mx-3 h-px bg-[hsl(220_18%_13%)]" />
        <div className="flex-1 space-y-1 overflow-y-auto p-3">
          {artifacts.length === 0 && <Empty icon={Sparkles} title="Studio output awaits" text="Select sources, then forge an artifact above." />}
          {artifacts.map(artifact => { const meta = STUDIO.find(item => item.kind === artifact.kind)!; const Icon = meta.icon; return <div key={artifact.id} className="group flex items-center gap-2 rounded-sm border border-[hsl(220_18%_14%)] bg-[hsl(220_16%_7%)] p-2 hover:border-[hsl(220_20%_22%)]"><button onClick={() => setArtifactOpen(artifact)} className="flex min-w-0 flex-1 items-center gap-2 text-left"><div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm" style={{ background: meta.color.replace(")", " / .1)") }}><Icon size={13} color={meta.color} /></div><div className="min-w-0"><p className="truncate text-[9px] text-foreground/70">{artifact.title}</p><p className="text-[7px] font-mono text-muted-foreground/30">{new Date(artifact.createdAt).toLocaleDateString()}</p></div></button><button onClick={async () => { await academiaStore.deleteArtifact(artifact.id); await reload(); }} className="opacity-0 text-rose-400/45 group-hover:opacity-100"><Trash2 size={11} /></button></div>; })}
        </div>
      </aside>}

      {pasteOpen && <Modal onClose={() => setPasteOpen(false)} title="Add copied text"><input value={pasteTitle} onChange={e => setPasteTitle(e.target.value)} placeholder="Source title" className={fieldClass} /><textarea value={pasteText} onChange={e => setPasteText(e.target.value)} rows={12} placeholder="Paste source material…" className={cn(fieldClass, "resize-none leading-5")} /><button onClick={() => void addPastedSource()} disabled={!pasteText.trim()} className={primaryButton}>ADD TO SOURCE MATRIX</button></Modal>}
      {artifactOpen && <Modal onClose={() => { speechSynthesis?.cancel(); setSpeaking(false); setArtifactOpen(null); }} title={artifactOpen.title} wide><div className="max-h-[62vh] overflow-y-auto rounded-sm border border-[hsl(220_18%_14%)] bg-[hsl(222_20%_4%)] p-5 font-mono text-[11px] leading-6 text-foreground/70 whitespace-pre-wrap">{artifactOpen.content}</div><div className="flex justify-between text-[8px] font-mono text-muted-foreground/35"><span>{artifactOpen.sourceIds.length} SOURCES · {new Date(artifactOpen.createdAt).toLocaleString()}</span>{artifactOpen.kind === "audio" && <button onClick={() => speakArtifact(artifactOpen)} className="flex items-center gap-1.5 text-[hsl(235_60%_72%)]">{speaking ? <Square size={11} /> : <Play size={11} />}{speaking ? "STOP AUDIO" : "PLAY OVERVIEW"}</button>}</div></Modal>}
    </div>
  );
}

function PanelHeader({ icon: Icon, label, action }: { icon: typeof Database; label: string; action: React.ReactNode }) { return <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[hsl(220_18%_13%)] px-4"><Icon size={13} className="text-muted-foreground/50" /><span className="text-[10px] font-mono tracking-[.18em] text-foreground/60 uppercase">{label}</span><div className="ml-auto">{action}</div></div>; }
function Empty({ icon: Icon, title, text }: { icon: typeof Upload; title: string; text: string }) { return <div className="flex flex-col items-center justify-center px-4 py-10 text-center"><Icon size={24} className="mb-3 text-muted-foreground/18" /><p className="text-[10px] text-muted-foreground/45">{title}</p><p className="mt-1 max-w-44 text-[8px] leading-4 text-muted-foreground/25">{text}</p></div>; }
function StudioButton({ item, loading, disabled, onClick }: { item: typeof STUDIO[number]; loading: boolean; disabled: boolean; onClick: () => void }) { const Icon = item.icon; return <button onClick={onClick} disabled={disabled || loading} title={item.description} className="group flex min-h-16 flex-col items-start justify-between rounded-sm border p-2.5 text-left transition-all hover:-translate-y-px disabled:opacity-30" style={{ borderColor: item.color.replace(")", " / .14)"), background: `linear-gradient(135deg, ${item.color.replace(")", " / .1)")}, hsl(222 18% 7%))` }}>{loading ? <Loader2 size={13} className="animate-spin" color={item.color} /> : <Icon size={13} color={item.color} />}<span className="text-[9px] text-foreground/58 group-hover:text-foreground/80">{item.label}</span></button>; }
function Modal({ onClose, title, wide, children }: { onClose: () => void; title: string; wide?: boolean; children: React.ReactNode }) { return <div className="absolute inset-0 z-50 flex items-center justify-center bg-[hsl(222_30%_2%/.78)] p-6 backdrop-blur-sm" onMouseDown={e => { if (e.currentTarget === e.target) onClose(); }}><div className={cn("w-full space-y-3 rounded-sm border border-[hsl(190_38%_24%)] bg-[hsl(222_20%_6%)] p-4 shadow-2xl", wide ? "max-w-3xl" : "max-w-lg")}><div className="flex items-center"><span className="text-[10px] font-mono tracking-[.14em] text-cyan-200/70 uppercase">{title}</span><button onClick={onClose} className="ml-auto text-muted-foreground/45 hover:text-foreground"><X size={14} /></button></div>{children}</div></div>; }
const fieldClass = "w-full rounded-sm border border-[hsl(220_18%_16%)] bg-[hsl(222_20%_4%)] px-3 py-2 text-[10px] text-foreground/75 outline-none focus:border-[hsl(190_45%_30%)]";
const primaryButton = "w-full rounded-sm border border-[hsl(190_48%_30%)] bg-[hsl(190_38%_10%)] py-2 text-[9px] font-mono tracking-widest text-cyan-200 disabled:opacity-30";
