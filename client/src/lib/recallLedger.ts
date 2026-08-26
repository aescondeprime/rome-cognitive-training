/**
 * What has been covered, what is shaky, and what to show next.
 *
 * Quantum Recall promises that consecutive rounds eventually cover the whole
 * document while still repeating what has not stuck. Those are two demands on
 * one scheduler, and this file is where they are reconciled.
 *
 * The definitions, decided before any of it was built:
 *
 * - **Coverage means presented once.** Not answered correctly, not consolidated
 *   — presented. Mastery is a second, separate meter, because conflating them
 *   makes a forty-page PDF into a session with no visible end.
 * - **The scheduler serves unseen passages in document order**, so a first pass
 *   reads like a read-through rather than a shuffle, and mixes weak ones back
 *   in at a ratio you set. That ratio is the single dial behind "continuous
 *   coverage *and* repetition" — at 0 it is a pure first pass, at 1 it never
 *   advances.
 * - **Tallies are split by question type.** Recognising a passage in a multiple
 *   choice while being unable to produce it from a blank is the most useful
 *   thing this ledger can tell you, and a pooled accuracy number cannot show it.
 *
 * Everything here is pure and deterministic — the scheduler takes its own `rng`
 * — so the behaviour is asserted in tests rather than judged by playing. It
 * imports nothing at runtime for the same reason: the node test runner does not
 * resolve the `@/` alias, and a type-only import is erased before it tries.
 */

import type {
  LedgerEntry, LedgerTally, RecallQuestionType, SourceLedger,
} from "@/lib/academiaStore";
import type { Chunk } from "@/lib/textChunks";

export type ChunkState = "unseen" | "weak" | "consolidated";

/** Answers about one passage before it can be called consolidated rather than lucky. */
const CONSOLIDATION_ASKED = 3;
const CONSOLIDATION_ACCURACY = 0.8;
const CONSOLIDATION_ROUNDS = 2;

const QUESTION_TYPES: RecallQuestionType[] = ["choice", "blank", "open"];

function emptyTallies(): Record<RecallQuestionType, LedgerTally> {
  return { choice: { asked: 0, correct: 0 }, blank: { asked: 0, correct: 0 }, open: { asked: 0, correct: 0 } };
}

export function emptyLedger(sourceId: string, profileId: number, targetChars: number, chunkingVersion: number): SourceLedger {
  return { id: sourceId, profileId, chunkingVersion, targetChars, entries: {}, updatedAt: Date.now() };
}

/** The chunk's content hash. `chunkSource` builds ids as `${sourceId}:${hash}`. */
export function hashOf(chunk: Chunk): string {
  return chunk.id.slice(chunk.id.lastIndexOf(":") + 1);
}

export function entryFor(ledger: SourceLedger | undefined, chunk: Chunk): LedgerEntry {
  const hash = hashOf(chunk);
  const existing = ledger?.entries[hash];
  if (existing) return existing;
  return { hash, index: chunk.index, presentations: 0, lastSeenAt: 0, tallies: emptyTallies(), cleanRounds: 0 };
}

export function totals(entry: LedgerEntry): LedgerTally {
  return QUESTION_TYPES.reduce(
    (acc, type) => ({ asked: acc.asked + entry.tallies[type].asked, correct: acc.correct + entry.tallies[type].correct }),
    { asked: 0, correct: 0 },
  );
}

export function accuracy(entry: LedgerEntry): number {
  const { asked, correct } = totals(entry);
  return asked > 0 ? correct / asked : 0;
}

/**
 * Where a passage stands.
 *
 * Consolidated deliberately needs both accuracy *and* separate sittings: three
 * right answers in one round is one good minute, not knowledge that survived a
 * night's sleep.
 */
export function chunkState(entry: LedgerEntry): ChunkState {
  if (entry.presentations === 0) return "unseen";
  const { asked } = totals(entry);
  if (
    entry.cleanRounds >= CONSOLIDATION_ROUNDS &&
    asked >= CONSOLIDATION_ASKED &&
    accuracy(entry) >= CONSOLIDATION_ACCURACY
  ) return "consolidated";
  return "weak";
}

export interface Coverage {
  total: number;
  seen: number;
  consolidated: number;
  /** Coverage as decided: presented at least once. */
  fraction: number;
  masteryFraction: number;
}

export function coverageOf(chunks: Chunk[], ledger: SourceLedger | undefined): Coverage {
  let seen = 0;
  let consolidated = 0;
  for (const chunk of chunks) {
    const state = chunkState(entryFor(ledger, chunk));
    if (state !== "unseen") seen++;
    if (state === "consolidated") consolidated++;
  }
  const total = chunks.length;
  return {
    total, seen, consolidated,
    fraction: total ? seen / total : 0,
    masteryFraction: total ? consolidated / total : 0,
  };
}

/* ── Scheduling ──────────────────────────────────────────────────────── */

export interface PickOptions {
  /** How often a round revisits instead of advancing. 0 = pure first pass. */
  reviewRatio: number;
  /** Injected so the sequence is reproducible in tests. */
  rng?: () => number;
  /** Avoid handing back the passage just answered, if there is any alternative. */
  lastHash?: string;
}

/**
 * Choose the next passage.
 *
 * Unseen material is taken in document order; review is taken oldest-seen
 * first, weak before consolidated, which is as much spacing as is worth having
 * before there is real data to fit an interval to.
 *
 * When one side is empty the other takes over silently — a first pass with
 * nothing yet learned reviews nothing, and a document fully covered becomes
 * pure review rather than ending.
 */
export function pickNextChunk(chunks: Chunk[], ledger: SourceLedger | undefined, options: PickOptions): Chunk | null {
  if (!chunks.length) return null;
  const rng = options.rng ?? Math.random;

  const unseen: Chunk[] = [];
  const seen: Array<{ chunk: Chunk; entry: LedgerEntry; state: ChunkState }> = [];
  for (const chunk of chunks) {
    const entry = entryFor(ledger, chunk);
    const state = chunkState(entry);
    if (state === "unseen") unseen.push(chunk);
    else seen.push({ chunk, entry, state });
  }

  // Weak before consolidated, then least-recently-seen first.
  seen.sort((a, b) => {
    if (a.state !== b.state) return a.state === "weak" ? -1 : 1;
    return a.entry.lastSeenAt - b.entry.lastSeenAt;
  });

  const wantsReview = rng() < options.reviewRatio;
  const order: Chunk[][] = wantsReview || !unseen.length
    ? [seen.map(item => item.chunk), unseen]
    : [unseen, seen.map(item => item.chunk)];

  for (const candidates of order) {
    const fresh = candidates.find(chunk => hashOf(chunk) !== options.lastHash);
    if (fresh) return fresh;
  }
  // One chunk in the whole document, and it is the one just answered.
  return chunks[0];
}

/* ── Recording ───────────────────────────────────────────────────────── */

export interface RoundOutcome {
  type: RecallQuestionType;
  correct: boolean;
}

/**
 * Fold a finished round into the ledger.
 *
 * Returns a new ledger rather than mutating: the caller writes it to IndexedDB
 * and sets it into React state, and a mutated object would do neither reliably.
 */
export function recordRound(
  ledger: SourceLedger,
  chunk: Chunk,
  outcomes: RoundOutcome[],
  now = Date.now(),
): SourceLedger {
  const previous = entryFor(ledger, chunk);
  const tallies = emptyTallies();
  for (const type of QUESTION_TYPES) tallies[type] = { ...previous.tallies[type] };

  let missed = 0;
  for (const outcome of outcomes) {
    tallies[outcome.type].asked++;
    if (outcome.correct) tallies[outcome.type].correct++;
    else missed++;
  }

  const entry: LedgerEntry = {
    hash: previous.hash,
    index: chunk.index,
    presentations: previous.presentations + 1,
    lastSeenAt: now,
    tallies,
    // A clean round is one where nothing was missed. A single miss does not
    // undo earlier clean rounds — it just stops adding to them, which is what
    // makes consolidation slow to reach and slow to lose.
    cleanRounds: outcomes.length > 0 && missed === 0 ? previous.cleanRounds + 1 : previous.cleanRounds,
  };

  return { ...ledger, entries: { ...ledger.entries, [entry.hash]: entry }, updatedAt: now };
}

/**
 * Drop entries whose passage no longer exists.
 *
 * Called after a source is re-chunked. Kept separate from `recordRound` so a
 * sitting never silently loses history that a later re-read would have matched.
 */
export function pruneLedger(ledger: SourceLedger, chunks: Chunk[]): SourceLedger {
  const live = new Set(chunks.map(hashOf));
  const entries: Record<string, LedgerEntry> = {};
  for (const [hash, entry] of Object.entries(ledger.entries)) if (live.has(hash)) entries[hash] = entry;
  return { ...ledger, entries, updatedAt: Date.now() };
}

/** Per-type accuracy across a whole source, for the session summary. */
export function typeBreakdown(ledger: SourceLedger | undefined): Record<RecallQuestionType, LedgerTally> {
  const out = emptyTallies();
  for (const entry of Object.values(ledger?.entries ?? {})) {
    for (const type of QUESTION_TYPES) {
      out[type].asked += entry.tallies[type].asked;
      out[type].correct += entry.tallies[type].correct;
    }
  }
  return out;
}

export const RECALL_QUESTION_TYPES = QUESTION_TYPES;
