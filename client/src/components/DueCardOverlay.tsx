/**
 * A card that has come due, wherever you happen to be.
 *
 * The constellation widget shows what is due if you are looking at the map.
 * This is the other half of the same idea: a card with an interval is a promise
 * that it will come back to you, and a promise kept only on one screen is not
 * much of one. So it renders from `AppShell`, over whatever node is open.
 *
 * **Closing is the review.** Turn it over, decide for yourself whether you had
 * it, close it — and the interval starts again from now. There is no grading
 * here on purpose: SM-2 lives behind the widget's KNEW IT / MISSED, where a
 * judgement is being asked for. Interrupting someone mid-task and then asking
 * them to rate themselves would make the interruption cost more than the card
 * is worth.
 *
 * Two things it will not do: interrupt a timed Quantum Recall round, and come
 * back immediately after being closed. The first would break the one surface
 * where a clock is running; the second is what `snoozed` prevents when a card
 * has no interval to reschedule to.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useHashLocation } from "wouter/use-hash-location";
import { Clock, Layers, X } from "lucide-react";
import {
  fetchDueFlashcards, FLASHCARDS_DUE_KEY, FLASHCARDS_KEY, scheduleFlashcard, type Flashcard,
} from "@/lib/flashcards";

const AMBER = "hsl(35 80% 62%)";
/** Due cards are minutes-scale at their most urgent; a minute's poll is plenty. */
const POLL_MS = 60_000;

export default function DueCardOverlay() {
  const [location] = useHashLocation();
  const client = useQueryClient();
  const [turned, setTurned] = useState(false);
  const [snoozed, setSnoozed] = useState<Set<number>>(new Set());

  // The Recall State owns a clock and a passage you are being timed on. Nothing
  // else in ROME does, which is why this is the only exception.
  const suppressed = location.startsWith("/academia/recall");

  const { data: due = [] } = useQuery<Flashcard[]>({
    queryKey: FLASHCARDS_DUE_KEY,
    queryFn: fetchDueFlashcards,
    refetchInterval: POLL_MS,
    staleTime: POLL_MS,
    enabled: !suppressed,
  });

  const card = due.find(item => !snoozed.has(item.id)) ?? null;

  useEffect(() => { setTurned(false); }, [card?.id]);

  const close = useMutation({
    mutationFn: async (item: Flashcard) => {
      // Its own interval, applied again: the schedule is unchanged and the
      // clock restarts. A card with no interval cannot be rescheduled, so it is
      // held back for this session instead of returning on the next poll.
      if (item.intervalDays == null) return;
      await scheduleFlashcard(item.id, item.intervalDays);
    },
    onSettled: (_data, _error, item) => {
      setSnoozed(old => new Set(old).add(item.id));
      client.invalidateQueries({ queryKey: FLASHCARDS_DUE_KEY });
      client.invalidateQueries({ queryKey: FLASHCARDS_KEY });
    },
  });

  if (suppressed || !card) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-6"
      style={{ background: "hsl(222 30% 2% / .72)", backdropFilter: "blur(3px)" }}
      onMouseDown={event => { if (event.currentTarget === event.target) close.mutate(card); }}
    >
      <div className="w-full max-w-md">
        <div className="mb-2 flex items-center gap-2">
          <Layers size={12} color={AMBER} />
          <span className="text-[8px] font-mono tracking-[.2em]" style={{ color: AMBER }}>DUE NOW</span>
          <span className="text-[8px] font-mono tracking-[.16em] text-muted-foreground/35">
            {(card.category || "general").toUpperCase()}
            {due.length > 1 ? ` · ${due.length} DUE` : ""}
          </span>
          <button onClick={() => close.mutate(card)} title="Close — the interval starts again"
            className="ml-auto text-muted-foreground/45 hover:text-foreground"><X size={15} /></button>
        </div>

        <div style={{ perspective: 1400 }}>
          <div
            onClick={() => setTurned(value => !value)}
            className="relative cursor-pointer"
            style={{
              height: 260,
              transformStyle: "preserve-3d",
              transition: "transform .55s cubic-bezier(.2,.8,.2,1)",
              transform: turned ? "rotateY(180deg)" : "rotateY(0deg)",
            }}
          >
            <CardFace side="FRONT" text={card.front} border="hsl(35 50% 34%)" background="hsl(222 18% 7%)" color="hsl(214 22% 82%)" />
            <CardFace side="BACK" text={card.back} border="hsl(35 55% 40%)" background="hsl(35 24% 9%)" color="hsl(35 40% 84%)" flipped />
          </div>
        </div>

        <div className="mt-2 flex items-center gap-3">
          <span className="flex items-center gap-1 text-[8px] font-mono tracking-[.16em] text-muted-foreground/35">
            <Clock size={9} /> {turned ? "CLICK TO GO BACK" : "CLICK TO TURN OVER"}
          </span>
          <button onClick={() => close.mutate(card)} disabled={close.isPending}
            className="ml-auto rounded-sm border border-[hsl(35_50%_36%)] bg-[hsl(35_35%_11%)] px-4 py-1.5 text-[8px] font-mono tracking-[.18em] text-[hsl(35_85%_70%)] disabled:opacity-40">
            CLOSE
          </button>
        </div>
      </div>
    </div>
  );
}

function CardFace({ side, text, border, background, color, flipped }: {
  side: string; text: string; border: string; background: string; color: string; flipped?: boolean;
}) {
  return (
    <div
      className="absolute inset-0 overflow-hidden rounded-lg border p-5"
      style={{
        borderColor: border, background, color,
        backfaceVisibility: "hidden",
        transform: flipped ? "rotateY(180deg)" : undefined,
        boxShadow: "0 8px 40px hsl(222 40% 1% / .7)",
      }}
    >
      <p className="mb-3 text-[7px] font-mono tracking-[.24em] text-muted-foreground/35">{side}</p>
      <p className="overflow-y-auto whitespace-pre-wrap text-[13px] leading-6" style={{ maxHeight: 196 }}>{text}</p>
    </div>
  );
}
