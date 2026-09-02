/**
 * The Flashcard Archive — every card, in folders, as cards.
 *
 * It has its own route because it outlives runs. Cards written from one
 * Quantum Recall sitting are drilled in another, shown on the constellation
 * widget, surfaced by the due-card overlay wherever you happen to be, and will
 * feed the memorization drills in Athena Trials. A panel inside a run was the
 * wrong shape for something with that many consumers.
 *
 * The rows are ROME's existing `recall_items`, so the Memory Vault sees the
 * same cards and the scheduling Athena will want is already on them. Folders
 * are the `category` column — a string that already exists and is already
 * displayed; a folders table for what a string does would be two
 * representations of one idea.
 *
 * **A card looks like a card and turns over.** The flip is a CSS rotation of
 * two faces rather than a swap of text, because knowing which side you are on
 * without reading is the entire ergonomics of a flashcard.
 *
 * **The interval belongs to the card, not to an algorithm.** SM-2 still runs
 * behind the widget's KNEW IT / MISSED, but a card you set to weekly stays
 * weekly: you are saying how often you want to see it, and the due-card overlay
 * is what honours that.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ArrowLeft, Check, Clock, FolderClosed, Layers, Loader2, Pencil, Plus, RotateCw, Search, Trash2, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  createFlashcard, DEFAULT_FOLDER, deleteFlashcard, describeInterval, fetchFlashcards,
  FLASHCARDS_DUE_KEY, FLASHCARDS_KEY, foldersOf, INTERVAL_PRESETS, isDue, scheduleFlashcard,
  updateFlashcard, type Flashcard,
} from "@/lib/flashcards";

const AMBER = "hsl(35 80% 62%)";

export default function FlashcardArchive() {
  const client = useQueryClient();
  const { data: cards = [], isLoading } = useQuery<Flashcard[]>({ queryKey: FLASHCARDS_KEY, queryFn: fetchFlashcards });
  const [folder, setFolder] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);

  const folders = useMemo(() => foldersOf(cards), [cards]);
  const shown = cards
    .filter(card => !folder || (card.category || DEFAULT_FOLDER) === folder)
    .filter(card => !search.trim() || `${card.front} ${card.back}`.toLowerCase().includes(search.toLowerCase()));
  const due = cards.filter(card => isDue(card)).length;

  const invalidate = () => {
    client.invalidateQueries({ queryKey: FLASHCARDS_KEY });
    client.invalidateQueries({ queryKey: FLASHCARDS_DUE_KEY });
  };

  const remove = useMutation({ mutationFn: (id: number) => deleteFlashcard(id), onSuccess: invalidate });
  const schedule = useMutation({
    mutationFn: (input: { id: number; days: number | null }) => scheduleFlashcard(input.id, input.days),
    onSuccess: invalidate,
  });
  const save = useMutation({
    mutationFn: (input: { id: number; patch: Partial<Flashcard> }) => updateFlashcard(input.id, input.patch),
    onSuccess: () => { invalidate(); setEditing(null); },
  });

  return (
    <div className="relative flex h-[calc(100vh-132px)] min-h-[650px] flex-col overflow-hidden rounded-sm border border-[hsl(220_18%_13%)] bg-[hsl(222_20%_5%)]">
      <div className="pointer-events-none absolute inset-0 opacity-40" style={{ backgroundImage: "linear-gradient(hsl(35 45% 18% / .1) 1px, transparent 1px), linear-gradient(90deg, hsl(35 45% 18% / .1) 1px, transparent 1px)", backgroundSize: "32px 32px" }} />

      <div className="relative z-10 flex h-12 shrink-0 items-center gap-3 border-b border-[hsl(220_18%_13%)] px-4">
        <Link href="/academia"><button title="Back to the Forge" className="text-muted-foreground/40 hover:text-foreground"><ArrowLeft size={15} /></button></Link>
        <div className="flex h-7 w-7 items-center justify-center rounded-full border border-[hsl(35_52%_28%)] bg-[hsl(35_35%_10%)]"><Layers size={14} color={AMBER} /></div>
        <div>
          <h2 className="font-display text-xs tracking-[.16em] text-[hsl(35_78%_70%)]">FLASHCARD ARCHIVE</h2>
          <p className="text-[7px] font-mono tracking-[.18em] text-muted-foreground/35">
            {cards.length} CARD{cards.length === 1 ? "" : "S"} · {folders.length} FOLDER{folders.length === 1 ? "" : "S"}{due > 0 ? ` · ${due} DUE` : ""}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1.5 text-muted-foreground/40" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search cards"
              className="w-44 rounded-sm border border-[hsl(220_18%_14%)] bg-[hsl(222_20%_4%)] py-1 pl-7 pr-2 text-[9px] text-foreground outline-none focus:border-[hsl(35_45%_32%)]" />
          </div>
          <button onClick={() => setComposing(true)}
            className="flex items-center gap-1.5 rounded-sm border border-[hsl(35_50%_36%)] bg-[hsl(35_35%_11%)] px-3 py-1.5 text-[8px] font-mono tracking-[.16em] text-[hsl(35_85%_70%)] hover:border-[hsl(35_65%_50%)]">
            <Plus size={11} /> NEW CARD
          </button>
        </div>
      </div>

      <div className="relative z-10 flex flex-wrap gap-1.5 border-b border-[hsl(220_18%_12%)] px-4 py-2.5">
        <FolderChip label="ALL" count={cards.length} active={folder === null} onClick={() => setFolder(null)} />
        {folders.map(item => <FolderChip key={item.name} label={item.name.toUpperCase()} count={item.count}
          active={folder === item.name} onClick={() => setFolder(item.name)} />)}
      </div>

      <div className="relative z-10 min-h-0 flex-1 overflow-y-auto p-5">
        {isLoading && <div className="flex h-full items-center justify-center"><Loader2 size={16} className="animate-spin text-[hsl(35_70%_62%)]/60" /></div>}

        {!isLoading && shown.length === 0 && <div className="flex h-full flex-col items-center justify-center text-center">
          <Layers size={22} className="mb-3 text-muted-foreground/20" />
          <p className="text-[10px] text-muted-foreground/45">{cards.length ? "Nothing here" : "Nothing kept yet"}</p>
          <p className="mt-1 max-w-72 text-[8px] leading-4 text-muted-foreground/25">
            {cards.length
              ? "No card in this folder matches."
              : "Write one with NEW CARD, or keep a question after a Quantum Recall round."}
          </p>
        </div>}

        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
          {shown.map(card => editing === card.id
            ? <CardEditor
                key={card.id}
                card={card}
                folders={folders.map(item => item.name)}
                busy={save.isPending}
                onCancel={() => setEditing(null)}
                onSave={patch => save.mutate({ id: card.id, patch })}
              />
            : <FlashcardTile
                key={card.id}
                card={card}
                onEdit={() => setEditing(card.id)}
                onDelete={() => remove.mutate(card.id)}
                onInterval={days => schedule.mutate({ id: card.id, days })}
              />)}
        </div>
      </div>

      {composing && <Composer
        folders={folders.map(item => item.name)}
        initialFolder={folder ?? DEFAULT_FOLDER}
        onClose={() => setComposing(false)}
        onDone={invalidate}
      />}
    </div>
  );
}

/* ── One card ────────────────────────────────────────────────────────── */

/**
 * A card that turns over.
 *
 * Both faces are always in the DOM and the container rotates; swapping the
 * text on click would be cheaper and would not read as a card at all. The back
 * face is pre-rotated so it lands the right way up.
 */
function FlashcardTile({ card, onEdit, onDelete, onInterval }: {
  card: Flashcard;
  onEdit: () => void;
  onDelete: () => void;
  onInterval: (days: number | null) => void;
}) {
  const [turned, setTurned] = useState(false);
  const [picking, setPicking] = useState(false);
  const due = isDue(card);

  return (
    <div className="group relative" style={{ perspective: 1200 }}>
      <div
        onClick={() => setTurned(value => !value)}
        className="relative cursor-pointer"
        style={{
          height: 190,
          transformStyle: "preserve-3d",
          transition: "transform .5s cubic-bezier(.2,.8,.2,1)",
          transform: turned ? "rotateY(180deg)" : "rotateY(0deg)",
        }}
      >
        <Face
          side="FRONT"
          text={card.front}
          accent={due ? AMBER : "hsl(220 18% 18%)"}
          background="hsl(222 18% 7%)"
          color="hsl(214 20% 78%)"
        />
        <Face
          side="BACK"
          text={card.back}
          accent="hsl(35 45% 30%)"
          background="hsl(35 22% 8%)"
          color="hsl(35 35% 80%)"
          flipped
        />
      </div>

      {/* Footer sits outside the rotating element so it stays readable on both
          faces and does not become a mirror image of itself. */}
      <div className="mt-1.5 flex items-center gap-2">
        <span className="flex items-center gap-1 truncate text-[7.5px] font-mono tracking-[.14em] text-muted-foreground/35">
          <FolderClosed size={9} /> {(card.category || DEFAULT_FOLDER).toUpperCase()}
        </span>
        <button
          onClick={event => { event.stopPropagation(); setPicking(value => !value); }}
          title="How often this card comes back"
          className={cn("flex items-center gap-1 text-[7.5px] font-mono tracking-[.14em] transition-colors",
            card.intervalDays == null ? "text-muted-foreground/30 hover:text-foreground/70" : "text-[hsl(35_65%_62%)]")}>
          <Clock size={9} /> {describeInterval(card.intervalDays).toUpperCase()}
        </button>
        <div className="ml-auto flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
          <button onClick={onEdit} title="Edit" className="text-muted-foreground/40 hover:text-foreground"><Pencil size={11} /></button>
          <button onClick={onDelete} title="Delete" className="text-rose-400/40 hover:text-rose-400"><Trash2 size={11} /></button>
        </div>
      </div>

      {picking && <div className="absolute left-0 right-0 z-30 mt-1 rounded-sm border border-[hsl(35_45%_30%)] bg-[hsl(222_20%_6%)] p-1.5 shadow-2xl">
        {INTERVAL_PRESETS.map(preset => {
          const active = preset.days === null ? card.intervalDays == null : card.intervalDays === preset.days;
          return <button key={preset.label}
            onClick={() => { onInterval(preset.days); setPicking(false); }}
            className={cn("flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-[9px] font-mono tracking-widest transition-colors",
              active ? "text-[hsl(35_85%_70%)]" : "text-muted-foreground/50 hover:text-foreground")}>
            {active ? <Check size={9} /> : <span style={{ width: 9 }} />} {preset.label.toUpperCase()}
          </button>;
        })}
      </div>}
    </div>
  );
}

function Face({ side, text, accent, background, color, flipped }: {
  side: string; text: string; accent: string; background: string; color: string; flipped?: boolean;
}) {
  return (
    <div
      className="absolute inset-0 overflow-hidden rounded-md border p-3"
      style={{
        borderColor: accent, background, color,
        backfaceVisibility: "hidden",
        transform: flipped ? "rotateY(180deg)" : undefined,
        boxShadow: "0 2px 14px hsl(222 40% 2% / .55)",
      }}
    >
      <p className="mb-2 text-[7px] font-mono tracking-[.22em] text-muted-foreground/35">{side}</p>
      <p className="overflow-y-auto text-[11px] leading-5 whitespace-pre-wrap" style={{ maxHeight: 140 }}>{text}</p>
    </div>
  );
}

function FolderChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return <button onClick={onClick}
    className={cn("rounded-sm border px-2.5 py-1 text-[8px] font-mono tracking-[.14em] transition-colors",
      active ? "border-[hsl(35_50%_40%)] bg-[hsl(35_35%_10%)] text-[hsl(35_80%_70%)]" : "border-[hsl(220_18%_16%)] text-muted-foreground/45 hover:text-foreground")}>
    {label} <span className="text-muted-foreground/30">{count}</span>
  </button>;
}

/* ── Writing and editing ─────────────────────────────────────────────── */

function CardEditor({ card, folders, busy, onCancel, onSave }: {
  card: Flashcard;
  folders: string[];
  busy: boolean;
  onCancel: () => void;
  onSave: (patch: { front: string; back: string; category: string }) => void;
}) {
  const [draft, setDraft] = useState({ front: card.front, back: card.back, category: card.category || DEFAULT_FOLDER });
  return <div className="space-y-2 rounded-md border border-[hsl(35_45%_32%)] bg-[hsl(35_25%_7%)] p-3">
    <input value={draft.front} onChange={e => setDraft({ ...draft, front: e.target.value })} placeholder="Front"
      className={fieldClass} />
    <textarea value={draft.back} onChange={e => setDraft({ ...draft, back: e.target.value })} rows={4} placeholder="Back"
      className={cn(fieldClass, "resize-none leading-5")} />
    <div className="flex items-center gap-2">
      <input value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })} list="rome-folders" placeholder="Folder"
        className={cn(fieldClass, "min-w-0 flex-1")} />
      <datalist id="rome-folders">{folders.map(name => <option key={name} value={name} />)}</datalist>
      <button onClick={onCancel} className="text-[8px] font-mono tracking-widest text-muted-foreground/40 hover:text-foreground">CANCEL</button>
      <button onClick={() => onSave(draft)} disabled={!draft.front.trim() || !draft.back.trim() || busy}
        className="rounded-sm border border-[hsl(35_50%_36%)] bg-[hsl(35_35%_10%)] px-3 py-1 text-[8px] font-mono tracking-widest text-[hsl(35_80%_70%)] disabled:opacity-30">SAVE</button>
    </div>
  </div>;
}

/**
 * Writing a card by hand.
 *
 * Stays open after saving, because cards are written in batches: closing after
 * each one would make the second card cost as much as the first. The interval
 * is chosen here rather than afterwards for the same reason.
 */
function Composer({ folders, initialFolder, onClose, onDone }: {
  folders: string[];
  initialFolder: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [category, setCategory] = useState(initialFolder);
  const [days, setDays] = useState<number | null>(null);
  const [written, setWritten] = useState(0);

  const add = useMutation({
    mutationFn: () => createFlashcard({ front: front.trim(), back: back.trim(), category: category.trim() || DEFAULT_FOLDER, tags: JSON.stringify(["written"]), intervalDays: days }),
    onSuccess: () => { setFront(""); setBack(""); setWritten(value => value + 1); onDone(); },
  });

  return <div className="absolute inset-0 z-50 flex items-center justify-center bg-[hsl(222_30%_2%/.8)] p-6 backdrop-blur-sm"
    onMouseDown={event => { if (event.currentTarget === event.target) onClose(); }}>
    <div className="w-full max-w-lg space-y-3 rounded-sm border border-[hsl(35_45%_30%)] bg-[hsl(222_20%_6%)] p-4 shadow-2xl">
      <div className="flex items-center">
        <span className="text-[10px] font-mono tracking-[.14em] text-[hsl(35_80%_70%)]">NEW CARD</span>
        {written > 0 && <span className="ml-3 text-[8px] font-mono tracking-widest text-muted-foreground/35">{written} WRITTEN</span>}
        <button onClick={onClose} className="ml-auto text-muted-foreground/45 hover:text-foreground"><X size={14} /></button>
      </div>
      <input autoFocus value={front} onChange={e => setFront(e.target.value)} placeholder="Front — the prompt" className={fieldClass} />
      <textarea value={back} onChange={e => setBack(e.target.value)} rows={5} placeholder="Back — the answer" className={cn(fieldClass, "resize-none leading-5")} />
      <div className="flex items-center gap-2">
        <FolderClosed size={11} className="text-muted-foreground/40" />
        <input value={category} onChange={e => setCategory(e.target.value)} list="rome-new-folders" placeholder="Folder" className={cn(fieldClass, "min-w-0 flex-1")} />
        <datalist id="rome-new-folders">{folders.map(name => <option key={name} value={name} />)}</datalist>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Clock size={11} className="text-muted-foreground/40" />
        {INTERVAL_PRESETS.map(preset => <button key={preset.label} onClick={() => setDays(preset.days)}
          className={cn("rounded-sm border px-2 py-1 text-[8px] font-mono tracking-widest transition-colors",
            (preset.days === null ? days === null : days === preset.days)
              ? "border-[hsl(35_50%_40%)] bg-[hsl(35_35%_10%)] text-[hsl(35_80%_70%)]"
              : "border-[hsl(220_18%_16%)] text-muted-foreground/45 hover:text-foreground")}>
          {preset.label.toUpperCase()}
        </button>)}
      </div>
      <p className="text-[8px] leading-4 text-muted-foreground/30">
        With an interval, the card comes to you wherever you are when it is due. Without one it waits here.
      </p>
      <button onClick={() => add.mutate()} disabled={!front.trim() || !back.trim() || add.isPending}
        className="flex w-full items-center justify-center gap-2 rounded-sm border border-[hsl(35_50%_36%)] bg-[hsl(35_35%_11%)] py-2 text-[9px] font-mono tracking-widest text-[hsl(35_85%_70%)] disabled:opacity-30">
        {add.isPending ? <Loader2 size={11} className="animate-spin" /> : <RotateCw size={11} />} ADD CARD
      </button>
    </div>
  </div>;
}

const fieldClass = "w-full rounded-sm border border-[hsl(220_18%_16%)] bg-[hsl(222_20%_4%)] px-2.5 py-2 text-[10px] text-foreground/80 outline-none focus:border-[hsl(35_50%_38%)] placeholder:text-muted-foreground/25";
