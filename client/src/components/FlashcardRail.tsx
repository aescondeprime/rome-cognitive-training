/**
 * The Flashcard Archive, in the Forge's rail.
 *
 * The Archive is a page because it outlives runs, and it is also the thing you
 * most often want a glance at while writing a note — which is exactly the space
 * the Studio used to occupy. So the page stays and this is the same store seen
 * through a narrow column: folders, what is due, the cards themselves, and a
 * two-field way to write one without leaving what you were doing.
 *
 * What it deliberately does *not* do is edit. Renaming, moving between folders,
 * setting intervals and deleting all live on the page, one click away through
 * the expand control — a 290px column is the wrong place to be careful in, and
 * duplicating those controls would mean maintaining them twice.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Check, Clock, Layers, Loader2, Maximize2, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  createFlashcard, DEFAULT_FOLDER, describeInterval, fetchFlashcards, FLASHCARDS_DUE_KEY,
  FLASHCARDS_KEY, foldersOf, INTERVAL_PRESETS, isDue, type Flashcard,
} from "@/lib/flashcards";

const AMBER = "hsl(35 80% 62%)";

export default function FlashcardRail() {
  const client = useQueryClient();
  const { data: cards = [], isLoading } = useQuery<Flashcard[]>({ queryKey: FLASHCARDS_KEY, queryFn: fetchFlashcards });
  const [folder, setFolder] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [turned, setTurned] = useState<number | null>(null);

  const folders = useMemo(() => foldersOf(cards), [cards]);
  const shown = folder ? cards.filter(card => (card.category || DEFAULT_FOLDER) === folder) : cards;
  const due = cards.filter(card => isDue(card)).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1.5 px-3 pb-2">
        <Layers size={11} color={AMBER} />
        <span className="font-mono text-[9px] uppercase tracking-[.18em]" style={{ color: AMBER }}>Archive</span>
        {due > 0 && <span className="border px-1 py-px font-mono text-[7.5px] tracking-widest"
          style={{ color: AMBER, borderColor: "hsl(35 40% 24%)", background: "hsl(35 40% 10% / .7)" }}>{due} DUE</span>}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setWriting(value => !value)} title="Write a card"
            className={cn("transition-colors", writing ? "text-[hsl(35_85%_70%)]" : "text-muted-foreground/40 hover:text-foreground")}>
            {writing ? <X size={12} /> : <Plus size={12} />}
          </button>
          <Link href="/academia/flashcards">
            <button title="Open the full Archive" className="text-muted-foreground/40 hover:text-foreground"><Maximize2 size={11} /></button>
          </Link>
        </div>
      </div>

      {writing && <Composer folders={folders.map(item => item.name)} initialFolder={folder ?? DEFAULT_FOLDER}
        onDone={() => {
          client.invalidateQueries({ queryKey: FLASHCARDS_KEY });
          client.invalidateQueries({ queryKey: FLASHCARDS_DUE_KEY });
        }} />}

      {folders.length > 1 && <div className="flex flex-wrap gap-1 px-3 pb-2">
        <Chip label="ALL" count={cards.length} active={folder === null} onClick={() => setFolder(null)} />
        {folders.map(item => <Chip key={item.name} label={item.name.toUpperCase()} count={item.count}
          active={folder === item.name} onClick={() => setFolder(item.name)} />)}
      </div>}

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-3">
        {isLoading && <div className="flex justify-center py-6"><Loader2 size={13} className="animate-spin text-[hsl(35_70%_62%)]/60" /></div>}

        {!isLoading && shown.length === 0 && <div className="px-1 py-6 text-center">
          <p className="text-[10px] text-muted-foreground/45">{cards.length ? "Nothing in this folder" : "No cards yet"}</p>
          <p className="mt-1 text-[8px] leading-4 text-muted-foreground/25">
            {cards.length ? "Pick another folder." : "Write one here, or keep a question after a Quantum Recall round."}
          </p>
        </div>}

        {shown.map(card => {
          const open = turned === card.id;
          return (
            <button
              key={card.id}
              onClick={() => setTurned(open ? null : card.id)}
              title={open ? "Show the front" : "Turn it over"}
              className="block w-full border p-2 text-left transition-colors"
              style={{
                borderColor: open ? "hsl(35 45% 30%)" : isDue(card) ? "hsl(35 40% 26%)" : "hsl(220 18% 14%)",
                background: open ? "hsl(35 24% 8% / .8)" : "hsl(222 18% 6% / .8)",
              }}
            >
              <p className="font-mono text-[7px] tracking-[.2em] text-muted-foreground/35">{open ? "BACK" : "FRONT"}</p>
              <p className="mt-1 whitespace-pre-wrap text-[10px] leading-4"
                style={{ color: open ? "hsl(35 35% 80%)" : "hsl(214 20% 76%)" }}>
                {open ? card.back : card.front}
              </p>
              <p className="mt-1.5 flex items-center gap-1.5 font-mono text-[7px] tracking-[.14em] text-muted-foreground/30">
                {(card.category || DEFAULT_FOLDER).toUpperCase()}
                <span className="ml-auto flex items-center gap-1" style={{ color: card.intervalDays == null ? undefined : AMBER, opacity: card.intervalDays == null ? 1 : 0.75 }}>
                  <Clock size={8} /> {describeInterval(card.intervalDays).toUpperCase()}
                </span>
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Chip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return <button onClick={onClick}
    className={cn("border px-1.5 py-0.5 font-mono text-[7.5px] tracking-[.14em] transition-colors",
      active ? "border-[hsl(35_50%_40%)] bg-[hsl(35_35%_10%)] text-[hsl(35_80%_70%)]" : "border-[hsl(220_18%_16%)] text-muted-foreground/45 hover:text-foreground")}>
    {label} <span className="text-muted-foreground/30">{count}</span>
  </button>;
}

/**
 * Two fields and an interval, in the rail.
 *
 * It stays open after saving, because cards are written in batches and closing
 * after each one would make the second cost as much as the first.
 */
function Composer({ folders, initialFolder, onDone }: { folders: string[]; initialFolder: string; onDone: () => void }) {
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [category, setCategory] = useState(initialFolder);
  const [days, setDays] = useState<number | null>(null);
  const [saved, setSaved] = useState(0);

  const add = useMutation({
    mutationFn: () => createFlashcard({
      front: front.trim(), back: back.trim(),
      category: category.trim() || DEFAULT_FOLDER,
      tags: JSON.stringify(["written"]), intervalDays: days,
    }),
    onSuccess: () => { setFront(""); setBack(""); setSaved(value => value + 1); onDone(); },
  });

  return <div className="mx-3 mb-2 space-y-1.5 border p-2" style={{ borderColor: "hsl(35 45% 28%)", background: "hsl(35 22% 7% / .6)" }}>
    <input value={front} onChange={e => setFront(e.target.value)} placeholder="Front" className={field} />
    <textarea value={back} onChange={e => setBack(e.target.value)} rows={3} placeholder="Back" className={cn(field, "resize-none leading-4")} />
    <input value={category} onChange={e => setCategory(e.target.value)} list="rome-rail-folders" placeholder="Folder" className={field} />
    <datalist id="rome-rail-folders">{folders.map(name => <option key={name} value={name} />)}</datalist>
    <div className="flex flex-wrap gap-1">
      {INTERVAL_PRESETS.map(preset => <button key={preset.label} onClick={() => setDays(preset.days)}
        className={cn("border px-1.5 py-0.5 font-mono text-[7.5px] tracking-widest transition-colors",
          (preset.days === null ? days === null : days === preset.days)
            ? "border-[hsl(35_50%_40%)] bg-[hsl(35_35%_10%)] text-[hsl(35_80%_70%)]"
            : "border-[hsl(220_18%_16%)] text-muted-foreground/45 hover:text-foreground")}>
        {preset.label.toUpperCase()}
      </button>)}
    </div>
    <button onClick={() => add.mutate()} disabled={!front.trim() || !back.trim() || add.isPending}
      className="flex w-full items-center justify-center gap-1.5 border py-1.5 font-mono text-[8px] tracking-widest disabled:opacity-30"
      style={{ borderColor: "hsl(35 50% 36%)", background: "hsl(35 35% 11%)", color: "hsl(35 85% 70%)" }}>
      {add.isPending ? <Loader2 size={10} className="animate-spin" /> : saved > 0 ? <Check size={10} /> : <Plus size={10} />}
      {saved > 0 ? `ADD ANOTHER · ${saved} WRITTEN` : "ADD CARD"}
    </button>
  </div>;
}

const field = "w-full border border-[hsl(220_18%_16%)] bg-[hsl(222_20%_4%)] px-2 py-1 text-[9px] text-foreground/80 outline-none focus:border-[hsl(35_50%_38%)] placeholder:text-muted-foreground/25";
