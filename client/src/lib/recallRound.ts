/**
 * The Quantum Recall round: what a round is, how long each part of it lasts,
 * how an answer is judged, and how the next round is ready before you need it.
 *
 * This is a plain module with no React in it. The surface owns the clock — one
 * `requestAnimationFrame` loop that both draws the countdown and decides when
 * the step is over, which is the shape PASAT arrived at after the two-clock
 * version silently disagreed with itself. Everything else lives here, so the
 * machine can be driven by a test with a fake generator and, later, by Akira.
 *
 * The one structural decision worth understanding is the queue at the bottom.
 * Questions are generated *after* the excerpt timer ends, which is precisely
 * where the tension of the round is, so generating on demand would put a
 * loading state in the middle of every round. Instead round N+1 is generated
 * while round N is being answered. The cost is that N+1's passage is chosen
 * against the ledger as it stood before N was recorded — a pipelined scheduler
 * is always one round stale, and the alternative was worse.
 */

import type { RecallQuestionType } from "@/lib/academiaStore";
import type { Chunk } from "@/lib/textChunks";

/* ── Configuration — the optimizer ───────────────────────────────────── */

export interface RecallConfig {
  questionsPerRound: number;
  /** Reading time scales with length: a flat clock is generous on 60 words and cruel on 200. */
  readSecondsPer100Words: number;
  readSecondsMin: number;
  readSecondsMax: number;
  /** Base answering time; each type multiplies it. */
  answerSeconds: number;
  choiceMultiplier: number;
  blankMultiplier: number;
  openMultiplier: number;
  /** How often a round revisits instead of advancing. */
  reviewRatio: number;
  /** Target share of each question type. The generator may deviate when a passage cannot support one. */
  mixChoice: number;
  mixBlank: number;
  mixOpen: number;
  /** Excerpt size, which is also the difficulty dial. */
  chunkTargetChars: number;
  /** Rounds kept written and waiting. See `RoundQueue`. */
  bufferDepth: number;
  /** Whether finishing the excerpt early is allowed. */
  earlyRead: boolean;
}

export const RECALL_DEFAULTS: RecallConfig = {
  questionsPerRound: 3,
  readSecondsPer100Words: 22,
  readSecondsMin: 12,
  readSecondsMax: 90,
  answerSeconds: 30,
  choiceMultiplier: 1,
  blankMultiplier: 1.2,
  openMultiplier: 2.5,
  reviewRatio: 0.25,
  mixChoice: 1,
  mixBlank: 1,
  mixOpen: 1,
  chunkTargetChars: 900,
  bufferDepth: 2,
  earlyRead: true,
};

/** Not the Athena namespace: this is not an Athena drill and must not share its keys. */
export const RECALL_CFG_KEY = "rome.academia.recall.cfg";

export function loadRecallConfig(): RecallConfig {
  try {
    const raw = localStorage.getItem(RECALL_CFG_KEY);
    if (!raw) return { ...RECALL_DEFAULTS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...RECALL_DEFAULTS };
    // Defaults first, so a config saved before a field existed gains it rather
    // than rendering `undefined` into a slider.
    return { ...RECALL_DEFAULTS, ...(parsed as Partial<RecallConfig>) };
  } catch {
    return { ...RECALL_DEFAULTS };
  }
}

export function saveRecallConfig(config: RecallConfig): void {
  try { localStorage.setItem(RECALL_CFG_KEY, JSON.stringify(config)); } catch { /* private mode */ }
}

/* ── Questions ───────────────────────────────────────────────────────── */

export interface ProofSpan {
  start: number;
  end: number;
  text: string;
  /** False when the span could not be found in the passage — show the passage, claim nothing. */
  verified: boolean;
}

export interface Question {
  id: string;
  type: RecallQuestionType;
  stem: string;
  /** Multiple choice only. Exactly four, distinct. */
  options?: string[];
  answerIndex?: number;
  /** The canonical answer, for blanks and for the reveal. */
  answer: string;
  /** Open-ended only: the points a good answer contains. */
  rubric?: string[];
  explanation: string;
  proof: ProofSpan | null;
}

export interface Round {
  sourceId: string;
  chunkId: string;
  chunkHash: string;
  chunkIndex: number;
  excerpt: string;
  questions: Question[];
}

export type Verdict = "correct" | "partial" | "wrong" | "missed";

export interface Answer {
  /** Index for a choice, text for a blank or an open answer, null if nothing was given. */
  value: string | number | null;
  elapsedMs: number;
  expired: boolean;
}

export interface Graded {
  question: Question;
  answer: Answer;
  verdict: Verdict;
  /** The grader's sentence, for open answers. */
  note?: string;
  /** Set when you overruled the grader. Counted separately from the verdict. */
  overridden?: boolean;
}

export function isCorrect(verdict: Verdict): boolean {
  return verdict === "correct";
}

/* ── Timing ──────────────────────────────────────────────────────────── */

export function wordsIn(text: string): number {
  const matched = text.trim().match(/\S+/g);
  return matched ? matched.length : 0;
}

/**
 * How long the excerpt stays on screen.
 *
 * PASAT's interval is flat because every stimulus is one digit. An excerpt is
 * not, so the setting is seconds per hundred words and the surface displays the
 * seconds it works out to — a dial you can reason about, applied to material
 * that varies.
 */
export function secondsToRead(text: string, config: RecallConfig): number {
  const raw = (wordsIn(text) / 100) * config.readSecondsPer100Words;
  return Math.round(Math.min(config.readSecondsMax, Math.max(config.readSecondsMin, raw)));
}

export function secondsToAnswer(type: RecallQuestionType, config: RecallConfig): number {
  const multiplier = type === "choice" ? config.choiceMultiplier
    : type === "blank" ? config.blankMultiplier
    : config.openMultiplier;
  return Math.max(5, Math.round(config.answerSeconds * multiplier));
}

/** The mix as proportions, normalized, so the three sliders are relative weights. */
export function mixWeights(config: RecallConfig): Record<RecallQuestionType, number> {
  const raw = { choice: Math.max(0, config.mixChoice), blank: Math.max(0, config.mixBlank), open: Math.max(0, config.mixOpen) };
  const sum = raw.choice + raw.blank + raw.open;
  if (sum <= 0) return { choice: 1 / 3, blank: 1 / 3, open: 1 / 3 };
  return { choice: raw.choice / sum, blank: raw.blank / sum, open: raw.open / sum };
}

/**
 * How many of each type a round should aim for.
 *
 * Largest-remainder, so three questions at equal weights is one of each rather
 * than whatever rounding happens to produce.
 */
export function plannedMix(config: RecallConfig): Record<RecallQuestionType, number> {
  const weights = mixWeights(config);
  const total = Math.max(1, Math.round(config.questionsPerRound));
  const exact = { choice: weights.choice * total, blank: weights.blank * total, open: weights.open * total };
  const counts = { choice: Math.floor(exact.choice), blank: Math.floor(exact.blank), open: Math.floor(exact.open) };
  let left = total - (counts.choice + counts.blank + counts.open);
  const order = (Object.keys(exact) as RecallQuestionType[])
    .sort((a, b) => (exact[b] - counts[b]) - (exact[a] - counts[a]));
  for (let i = 0; left > 0; i++, left--) counts[order[i % order.length]]++;
  return counts;
}

/* ── Grading the objective types ─────────────────────────────────────── */

/**
 * Loosen a typed answer to what it actually claims.
 *
 * A blank is testing whether you can produce the term, not whether you can
 * punctuate it. Articles go, case goes, punctuation goes, whitespace collapses.
 * Anything cleverer than this belongs to the model.
 */
export function normalizeBlank(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9'\s-]/g, " ")
    .replace(/\b(a|an|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function gradeObjective(question: Question, answer: Answer): Verdict {
  if (answer.expired || answer.value === null || answer.value === "") return "missed";
  if (question.type === "choice") {
    return Number(answer.value) === question.answerIndex ? "correct" : "wrong";
  }
  if (question.type === "blank") {
    const given = normalizeBlank(String(answer.value));
    const wanted = normalizeBlank(question.answer);
    if (!given) return "missed";
    if (given === wanted) return "correct";
    // A blank whose answer is a phrase is met by the phrase, not by one word of
    // it — but a trailing qualifier should not fail an otherwise right answer.
    return wanted.length > 0 && (given.includes(wanted) || wanted.includes(given)) && given.length >= wanted.length * 0.6
      ? "partial"
      : "wrong";
  }
  // Open answers are the model's job.
  return "partial";
}

/* ── The generator contract ──────────────────────────────────────────── */

/**
 * What the passage actually teaches.
 *
 * Reading a source already produced this — a summary, the points worth keeping,
 * and the terms the passage introduces — so a question generator that ignores
 * it is paying twice and asking worse questions. Matched to a passage by
 * content hash, and absent when the source was never read, in which case the
 * generator works it out for itself.
 */
export interface PassageAnchor {
  summary: string;
  points: string[];
  terms: string[];
}

export interface GenerateRoundInput {
  chunk: Chunk;
  /** Neighbouring passages, so distractors can be drawn from real statements about the same material. */
  siblings: Chunk[];
  config: RecallConfig;
  anchor?: PassageAnchor;
  signal?: AbortSignal;
}

export interface GradeOpenInput {
  question: Question;
  answer: string;
  signal?: AbortSignal;
}

export interface RoundGenerator {
  generate(input: GenerateRoundInput): Promise<Round>;
  gradeOpen(input: GradeOpenInput): Promise<{ verdict: Verdict; note: string }>;
}

/* ── The pipeline ────────────────────────────────────────────────────── */

export interface RoundQueueOptions {
  generator: RoundGenerator;
  /** Choose the next passage. Given the hash just used, so it can avoid repeating it. */
  pick: (lastHash: string | undefined) => Chunk | null;
  siblings: (chunk: Chunk) => Chunk[];
  /** What the passage teaches, if it has already been read into a digest. */
  anchor?: (chunk: Chunk) => PassageAnchor | undefined;
  config: RecallConfig;
  /** Attempts on different passages before a round is declared impossible. */
  attempts?: number;
  /**
   * Rounds to keep written and waiting.
   *
   * One is enough to cover a round's own answering time. More is worth having
   * when a round costs several model calls, or when the first round should be
   * ready before the session starts. The cost is staleness: every buffered
   * round was drawn against the ledger as it stood when it was written, so a
   * deep buffer schedules further into the past.
   */
  depth?: number;
  /** Told how many rounds are written and waiting, for a "ready" indicator. */
  onBuffered?: (count: number) => void;
}

/**
 * One round ready, one round being written.
 *
 * `next()` hands back the round that was prepared while you were answering the
 * last one, and starts preparing the one after it before it returns. On a local
 * model that is the difference between a round that flows and a round with
 * several seconds of dead air in the middle of it.
 *
 * A passage whose generation fails is skipped rather than retried forever —
 * `generateJson` already retries once inside itself, and a passage that cannot
 * produce questions twice is a passage to come back to, not to sit on.
 */
/**
 * A round whose passage is known before its questions are.
 *
 * The passage costs nothing — the scheduler picks it from the ledger — while
 * the questions cost the model. Handing them over together meant staring at a
 * loading screen for the slow half while the fast half sat ready, so `next()`
 * returns **synchronously** with the chunk, and the questions arrive on the
 * promise. The reader starts reading immediately; generation runs against the
 * reading clock instead of in front of it.
 */
export interface PendingRound {
  chunk: Chunk;
  /** Resolves when the questions are written. Already resolved for a buffered round. */
  round: Promise<Round>;
  /** True the moment the questions are in hand, for a "ready" indicator. */
  settled: () => boolean;
}

export class RoundQueue {
  private slots: PendingRound[] = [];
  /** Chains production so a deep buffer never runs two model calls at once. */
  private tail: Promise<void> = Promise.resolve();
  private lastHash: string | undefined;
  private cancelled = false;
  private settled = 0;
  // Assigned rather than declared as a constructor parameter property: node's
  // own type stripping runs these tests and does not implement those.
  private options: RoundQueueOptions;

  constructor(options: RoundQueueOptions) {
    this.options = options;
  }

  private get depth(): number {
    return Math.max(1, Math.round(this.options.depth ?? 1));
  }

  /** True when at least one round is written or being written. */
  get isPrimed(): boolean {
    return this.slots.length > 0;
  }

  /** Rounds whose questions are finished and waiting. */
  get buffered(): number {
    return this.settled;
  }

  /** Rounds picked and generating, whether finished or not. */
  get inFlight(): number {
    return this.slots.length;
  }

  /**
   * Pick a passage now and start writing its questions.
   *
   * The pick is synchronous on purpose: it is the half that costs nothing, and
   * everything downstream is built on being able to show it at once.
   */
  private startOne(): PendingRound | null {
    if (this.cancelled) return null;
    const chunk = this.options.pick(this.lastHash);
    if (!chunk) return null;
    // Claimed before generating, so a buffered round never repeats the one
    // queued ahead of it, and a failure moves on rather than retrying the same
    // passage.
    this.lastHash = chunk.id.slice(chunk.id.lastIndexOf(":") + 1);

    let done = false;
    const round = this.tail.then(() => {
      if (this.cancelled) throw new DOMException("cancelled", "AbortError");
      return this.options.generator.generate({
        chunk,
        siblings: this.options.siblings(chunk),
        anchor: this.options.anchor?.(chunk),
        config: this.options.config,
      });
    });
    // The chain must survive a failed generation, or one bad passage would
    // stall every round behind it.
    this.tail = round.then(() => undefined, () => undefined);
    round.then(
      () => { done = true; this.settled++; this.options.onBuffered?.(this.settled); },
      () => { done = true; },
    );

    return { chunk, round, settled: () => done };
  }

  /**
   * Fill the buffer up to `depth`, one generation at a time.
   *
   * Calling this before the session starts is what makes the first round
   * instant: the wait moves to wherever you are while it happens.
   */
  prime(): void {
    if (this.cancelled) return;
    while (this.slots.length < this.depth) {
      const pending = this.startOne();
      if (!pending) return;
      this.slots.push(pending);
    }
  }

  /**
   * Hand over the next round's passage immediately.
   *
   * Returns null only when there is genuinely nothing left to draw from.
   */
  next(): PendingRound | null {
    if (this.cancelled) return null;
    if (!this.slots.length) this.prime();
    const pending = this.slots.shift() ?? this.startOne();
    if (pending) {
      // One less finished round in hand, if this was one of them.
      pending.round.then(() => {
        this.settled = Math.max(0, this.settled - 1);
        this.options.onBuffered?.(this.settled);
      }, () => {});
    }
    this.prime();
    return pending;
  }

  cancel(): void {
    this.cancelled = true;
    this.slots = [];
    this.settled = 0;
    this.tail = Promise.resolve();
  }
}
