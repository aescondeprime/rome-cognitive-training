/**
 * Tests for the comparison between what you recalled and what the document says.
 *
 * The judgement itself is the model's and cannot be tested. What can be pinned
 * is everything that decides whether the judgement is trustworthy:
 *
 * - claims come from the read, in document order, without duplicates;
 * - a claim the model skipped stays undecided rather than being guessed at;
 * - one failed batch costs eight claims, not the comparison;
 * - a gap is only a gap once confirmed, since the derived note is built from it.
 *
 * Run with `npm run test:recall`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SourceDigest } from "../academiaStore";
import { LLM_DEFAULTS } from "../localLLM";
import { compareArchive, composeGapNote, gatherClaims } from "../recallCompare";

const CFG = { ...LLM_DEFAULTS, model: "test-model" };

function digest(id: string, passages: Array<{ index: number; points: string[] }>): SourceDigest {
  return {
    id, profileId: 1, model: "test-model", chunkingVersion: 1, targetChars: 900,
    passages: passages.map(p => ({ index: p.index, hash: `h${p.index}`, summary: `s${p.index}`, points: p.points, terms: [] })),
    chunkCount: passages.length, complete: true, createdAt: 0, updatedAt: 0,
  };
}

const DIGESTS = [
  digest("src:1", [
    { index: 1, points: ["Rehearsal refreshes the trace", "Interference during the delay is costly"] },
    { index: 0, points: ["Working memory is capacity limited", "rehearsal refreshes the trace"] },
  ]),
  digest("src:2", [{ index: 0, points: ["Long-term memory has no comparable limit"] }]),
];

function stubModel(replies: unknown[]) {
  const bodies: any[] = [];
  const original = globalThis.fetch;
  let call = 0;
  globalThis.fetch = (async (_input: any, init: any) => {
    bodies.push(JSON.parse(init.body));
    const reply = replies[Math.min(call++, replies.length - 1)];
    if (reply === "error") return new Response("boom", { status: 500 });
    return new Response(JSON.stringify({ message: { content: JSON.stringify(reply) } }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { bodies, get calls() { return call; }, restore: () => { globalThis.fetch = original; } };
}

/* ── Claims ──────────────────────────────────────────────────────────── */

test("claims come from the read, in document order, deduplicated", () => {
  // The expensive half of the map-reduce was paid while reading; Compare is
  // only the reduce. A point restated in two passages is one thing to have
  // recalled, and counting it twice would make coverage read low for the wrong
  // reason.
  const claims = gatherClaims(DIGESTS, ["src:1", "src:2"]);
  assert.deepEqual(claims.map(c => c.claim), [
    "Working memory is capacity limited",
    "rehearsal refreshes the trace",
    "Interference during the delay is costly",
    "Long-term memory has no comparable limit",
  ]);
  assert.equal(claims[0].chunkIndex, 0, "document order, not digest order");
  assert.equal(claims[3].sourceId, "src:2");
});

test("a corpus that was never read yields no claims to compare against", () => {
  // Not a limitation worth engineering around: reading is what makes every
  // other part of this feature good, and this is where its absence has to be
  // said out loud rather than papered over.
  assert.deepEqual(gatherClaims(DIGESTS, ["note:99"]), []);
});

test("only the corpus in play contributes claims", () => {
  assert.equal(gatherClaims(DIGESTS, ["src:2"]).length, 1);
});

/* ── Alignment ───────────────────────────────────────────────────────── */

const CLAIMS = gatherClaims(DIGESTS, ["src:1", "src:2"]);

test("each claim gets a verdict, and misses are proposed as gaps", async () => {
  const stub = stubModel([{
    results: [
      { index: 0, verdict: "covered", note: "" },
      { index: 1, verdict: "partial", note: "thin on why" },
      { index: 2, verdict: "missed", note: "you never reached interference" },
      { index: 3, verdict: "missed", note: "nor long-term memory" },
    ],
  }]);
  const aligned = await compareArchive({ cfg: CFG, claims: CLAIMS, archive: "capacity is limited" });
  stub.restore();

  assert.equal(aligned.length, 4);
  assert.equal(aligned.filter(item => item.verdict === "missed").length, 2);
  // Proposed, not decided: confirmation is what turns a miss into a gap.
  assert.ok(aligned.filter(item => item.verdict === "missed").every(item => item.confirmed));
  assert.ok(aligned.filter(item => item.verdict !== "missed").every(item => !item.confirmed));
  assert.ok(aligned.every(item => typeof item.chunkIndex === "number"), "every claim keeps its passage reference");
});

test("a claim the model skipped is left undecided rather than guessed at", async () => {
  const stub = stubModel([{ results: [{ index: 0, verdict: "covered", note: "" }] }]);
  const aligned = await compareArchive({ cfg: CFG, claims: CLAIMS, archive: "something" });
  stub.restore();
  assert.equal(aligned.length, 1, "three claims went unjudged and none was invented");
});

test("one failed batch costs its claims, not the comparison", async () => {
  const many = Array.from({ length: 16 }, (_, i) => ({ claim: `claim ${i}`, sourceId: "src:1", chunkIndex: i, chunkHash: `h${i}` }));
  // First batch fails outright; the second answers.
  const stub = stubModel(["error", { results: Array.from({ length: 8 }, (_, i) => ({ index: i, verdict: "covered", note: "" })) }]);
  const aligned = await compareArchive({ cfg: CFG, claims: many, archive: "text" });
  stub.restore();

  assert.equal(aligned.length, 8, "the surviving batch is still worth reading");
});

test("an interrupted comparison resumes rather than repeating", async () => {
  const already = [{ claim: CLAIMS[0].claim, sourceId: "src:1", chunkIndex: 0, chunkHash: "h0", verdict: "covered" as const }];
  const stub = stubModel([{ results: [{ index: 0, verdict: "missed", note: "" }] }]);
  await compareArchive({ cfg: CFG, claims: CLAIMS, archive: "text", existing: already });
  const prompt = stub.bodies[0].messages.map((m: any) => m.content).join("\n");
  stub.restore();

  assert.ok(!prompt.includes(CLAIMS[0].claim), "a claim already decided is not asked about again");
  assert.ok(prompt.includes(CLAIMS[1].claim));
});

test("partial results are handed over as they are decided", async () => {
  const seen: number[] = [];
  const stub = stubModel([{ results: [{ index: 0, verdict: "covered", note: "" }] }]);
  await compareArchive({ cfg: CFG, claims: CLAIMS, archive: "text", onPartial: items => { seen.push(items.length); } });
  stub.restore();
  assert.ok(seen.length >= 1, "leaving mid-comparison must not lose what was decided");
});

/* ── The derived note ────────────────────────────────────────────────── */

test("the gap note is built only from confirmed gaps", async () => {
  const stub = stubModel([{
    title: "Gaps · Memory",
    overview: "Both gaps are about what happens during the delay.",
    sections: [{ heading: "Interference", body: "Rehearsal is prevented.", claims: ["Interference during the delay is costly"] }],
  }]);
  const note = await composeGapNote(CFG, "Memory", [
    { claim: "Interference during the delay is costly", sourceId: "src:1", chunkIndex: 1, chunkHash: "h1", verdict: "missed", confirmed: true },
  ]);
  const prompt = stub.bodies[0].messages.map((m: any) => m.content).join("\n");
  stub.restore();

  assert.match(note.title, /Gaps/);
  assert.ok(note.content.includes("INTERFERENCE"), "sections are headed in the note's own format");
  assert.ok(prompt.includes("Interference during the delay is costly"));
});

test("a note cannot be written from nothing", async () => {
  await assert.rejects(() => composeGapNote(CFG, "Memory", []), /Nothing was marked as missed/);
});
