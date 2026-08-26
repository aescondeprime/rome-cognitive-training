/**
 * Questions written once, played many times.
 *
 * The problem this solves: a model good enough to write a decent question is
 * large enough to make the machine unusable while it does, and a model small
 * enough to stay out of the way writes questions that are not worth answering.
 * On one machine those two facts cannot both be accommodated *while you study*.
 *
 * So generation moves out of study time entirely. A background job writes a
 * pool of questions for every passage of a source; a run then plays from that
 * pool and makes no model calls at all. The lag moves to a job you start and
 * walk away from, which is where lag is acceptable.
 *
 * **Why this is safe where banking whole rounds was not.** Questions belong to
 * the *passage*, not to the round order. A stored question is as valid on the
 * twentieth sitting as on the first, whatever the scheduler decides to show
 * next, and nothing about it goes stale when the ledger moves. Banking
 * scheduled rounds would have frozen the scheduler's decisions; banking
 * questions freezes nothing.
 *
 * A bank is invalidated only by the things that change what a passage *is* —
 * the model that wrote it, the chunking version, the excerpt size — and a
 * passage whose text changed simply has no entry, because pools are keyed by
 * content hash.
 */

import type { QuestionBank } from "@/lib/academiaStore";
import type { Chunk } from "@/lib/textChunks";
import {
  plannedMix, type GenerateRoundInput, type GradeOpenInput, type Question,
  type RecallConfig, type Round, type RoundGenerator, type Verdict,
} from "@/lib/recallRound";

/** Questions written per passage. More than a round needs, so repeats vary. */
export const POOL_SIZE = 6;

export function hashOfChunk(chunk: Chunk): string {
  return chunk.id.slice(chunk.id.lastIndexOf(":") + 1);
}

export function emptyBank(sourceId: string, profileId: number, model: string, chunkingVersion: number, targetChars: number, chunkCount: number): QuestionBank {
  return { id: sourceId, profileId, model, chunkingVersion, targetChars, pools: {}, chunkCount, complete: false, updatedAt: Date.now() };
}

/** A bank written by another model, or at another excerpt size, describes other passages. */
export function bankUsable(bank: QuestionBank | undefined, model: string, chunkingVersion: number, targetChars: number): boolean {
  return !!bank && bank.model === model && bank.chunkingVersion === chunkingVersion && bank.targetChars === targetChars;
}

export function pooledQuestions(bank: QuestionBank | undefined, hash: string): Question[] {
  const pool = bank?.pools[hash];
  return Array.isArray(pool) ? (pool as Question[]) : [];
}

/** Passages with enough banked questions to run a round without the model. */
export function bankedCoverage(bank: QuestionBank | undefined, chunks: Chunk[], perRound: number): number {
  if (!bank) return 0;
  return chunks.filter(chunk => pooledQuestions(bank, hashOfChunk(chunk)).length >= perRound).length;
}

export interface BankedGeneratorOptions {
  /** Banks by source id, as loaded from the store. */
  banks: Map<string, QuestionBank>;
  model: string;
  chunkingVersion: number;
  /** Used when a passage has no pool — and to grade open answers, which cannot be banked. */
  fallback: RoundGenerator;
  /** Called with questions generated on a miss, so the bank fills as you play. */
  onGenerated?: (chunk: Chunk, questions: Question[]) => void;
}

/**
 * Play from the bank, falling back to the model on a miss.
 *
 * The rotation is what stops a passage asking the same three questions every
 * time it comes round. It is per-generator rather than persisted: a sitting
 * that revisits a passage sees different questions, and the choice does not
 * need to survive the sitting.
 */
export function createBankedGenerator(options: BankedGeneratorOptions): RoundGenerator {
  const rotation = new Map<string, number>();

  return {
    async generate(input: GenerateRoundInput): Promise<Round> {
      const { chunk, config } = input;
      const hash = hashOfChunk(chunk);
      const bank = options.banks.get(chunk.sourceId);
      const usable = bankUsable(bank, options.model, options.chunkingVersion, config.chunkTargetChars);
      const pool = usable ? pooledQuestions(bank, hash) : [];
      const wanted = Math.max(1, Math.round(config.questionsPerRound));

      if (pool.length >= wanted) {
        const offset = rotation.get(hash) ?? 0;
        rotation.set(hash, offset + wanted);
        const questions = Array.from({ length: wanted }, (_, i) => pool[(offset + i) % pool.length]);
        return {
          sourceId: chunk.sourceId,
          chunkId: chunk.id,
          chunkHash: hash,
          chunkIndex: chunk.index,
          excerpt: chunk.text,
          // Ids must be unique within a round, or React keys collide when the
          // rotation wraps and hands back the same question twice.
          questions: questions.map((question, i) => ({ ...question, id: `${question.id}@${offset + i}` })),
        };
      }

      const round = await options.fallback.generate(input);
      options.onGenerated?.(chunk, round.questions);
      return round;
    },

    // Grading is a judgement about *your* answer, so it can never be banked.
    gradeOpen: (input: GradeOpenInput) => options.fallback.gradeOpen(input),
  };
}

/** The config a preparation job runs at: one pool's worth of questions per passage. */
export function poolConfig(config: RecallConfig): RecallConfig {
  return { ...config, questionsPerRound: POOL_SIZE };
}

/** What a pool should contain, for the job's own reporting. */
export function poolMix(config: RecallConfig): Record<string, number> {
  return plannedMix(poolConfig(config)) as unknown as Record<string, number>;
}

export type { Verdict };
