/**
 * The Flashcard Archive — one store, several consumers.
 *
 * Cards are written from Quantum Recall's review screen, edited and foldered in
 * the Archive, shown on the constellation widget, and will drive the
 * memorization drills in Athena Trials. That is four consumers, which is why
 * this is a module of its own rather than something living inside Recall State.
 *
 * **It writes to the existing store, not a new one.** ROME already has
 * `recall_items`: per-profile, with SM-2 scheduling (`intervalDays`,
 * `easeFactor`, `repetitions`, `nextReviewAt`), a `/due` endpoint, and
 * export/import already wired. A second flashcard store would have left the
 * Athena drills choosing between two, and the one they want is the one that can
 * already tell them what is due. The Memory Vault page reads the same rows.
 *
 * This is deliberately unlike the earlier decision not to record Quantum Recall
 * into `/api/trials`. That one was about *measurement*: a drill score means
 * something specific, and a study game's accuracy would have changed what the
 * recall domain meant. A flashcard is *content*. Content has one home.
 *
 * **Folders are the `category` column.** It exists, it is a string, the Memory
 * Vault already shows it as a badge. Adding a folders table for what a string
 * already does would be two representations of one idea.
 */

import { apiRequest } from "@/lib/queryClient";
import type { Graded, Question, Round } from "@/lib/recallRound";

export interface Flashcard {
  id: number;
  front: string;
  back: string;
  /** The folder. Always a non-empty string; "general" is the default. */
  category: string;
  /** JSON array as stored. Use `cardTags` to read it. */
  tags: string | null;
  nextReviewAt: number | null;
  intervalDays: number | null;
  easeFactor: number | null;
  repetitions: number | null;
  lastReviewedAt: number | null;
  createdAt: number | null;
}

export const DEFAULT_FOLDER = "general";

export interface NewFlashcard {
  front: string;
  back: string;
  category: string;
  tags: string;
}

/* ── Reading ─────────────────────────────────────────────────────────── */

export const FLASHCARDS_KEY = ["/api/recall-items"] as const;
export const FLASHCARDS_DUE_KEY = ["/api/recall-items/due"] as const;

export async function fetchFlashcards(): Promise<Flashcard[]> {
  const response = await apiRequest("GET", "/api/recall-items");
  return response.json();
}

export async function fetchDueFlashcards(): Promise<Flashcard[]> {
  const response = await apiRequest("GET", "/api/recall-items/due");
  return response.json();
}

/* ── Writing ─────────────────────────────────────────────────────────── */

export async function createFlashcard(card: NewFlashcard): Promise<Flashcard> {
  const response = await apiRequest("POST", "/api/recall-items", card);
  return response.json();
}

/** Content and folder only — the schedule belongs to the review endpoint. */
export async function updateFlashcard(
  id: number,
  patch: Partial<Pick<Flashcard, "front" | "back" | "category" | "tags">>,
): Promise<Flashcard> {
  const response = await apiRequest("PATCH", `/api/recall-items/${id}`, patch);
  return response.json();
}

export async function deleteFlashcard(id: number): Promise<void> {
  await apiRequest("DELETE", `/api/recall-items/${id}`);
}

/* ── Shaping ─────────────────────────────────────────────────────────── */

export function cardTags(card: Flashcard): string[] {
  try {
    const parsed = JSON.parse(card.tags ?? "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** Folders present, with their counts, `general` first and the rest by name. */
export function foldersOf(cards: Flashcard[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const card of cards) {
    const name = (card.category || DEFAULT_FOLDER).trim() || DEFAULT_FOLDER;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => {
      if (a.name === DEFAULT_FOLDER) return -1;
      if (b.name === DEFAULT_FOLDER) return 1;
      return a.name.localeCompare(b.name);
    });
}

export function isDue(card: Flashcard, now = Date.now()): boolean {
  return (card.nextReviewAt ?? 0) <= now;
}

/* ── From a Quantum Recall question ──────────────────────────────────── */

/**
 * Turn a question you have just been marked on into a card.
 *
 * The front is the question as asked and the back is the answer plus, where the
 * proof was verified, the passage's own sentence. That last part is the reason
 * to make the card here rather than from the source: at this moment the answer
 * has evidence attached and you have just found out whether you knew it.
 *
 * A blank's stem already contains `______`, which reads correctly as a card
 * front with no rewriting.
 */
export function cardFromQuestion(question: Question, round: Round, folder = DEFAULT_FOLDER): NewFlashcard {
  const proof = question.proof?.verified ? question.proof.text.trim() : "";
  const back = [question.answer.trim(), proof && proof !== question.answer.trim() ? `\n\n“${proof}”` : ""]
    .filter(Boolean)
    .join("");

  return {
    front: question.stem.trim(),
    back: back || question.answer.trim(),
    category: folder.trim() || DEFAULT_FOLDER,
    // Where it came from, so a card can be traced back to its passage.
    tags: JSON.stringify(["quantum-recall", question.type, `passage-${round.chunkIndex + 1}`]),
  };
}

/**
 * Whether this question is already on a card.
 *
 * Compared on the front, loosely: the same question asked in two sittings is
 * one card, and an archive that quietly accumulated duplicates would make the
 * drills that read it worse rather than better.
 */
export function alreadyArchived(cards: Flashcard[], question: Question): boolean {
  const key = question.stem.trim().toLowerCase().replace(/\s+/g, " ");
  return cards.some(card => card.front.trim().toLowerCase().replace(/\s+/g, " ") === key);
}

/** The cards worth offering from a finished round: everything with an answer. */
export function archivableFrom(graded: Graded[]): Question[] {
  return graded.map(item => item.question).filter(question => question.answer.trim().length > 0);
}
