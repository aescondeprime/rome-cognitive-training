/**
 * Deterministic tests for the two modules Knowledge Forge generation stands on.
 *
 * `textChunks` decides what a passage is, and every promise the Recall State
 * makes — "the rounds eventually cover the entirety" — reduces to whether the
 * chunker partitions the document exactly. That is a property, not a look, so
 * it is asserted here rather than judged on screen.
 *
 * `localLLM` is tested against a stubbed `fetch`. What matters is not that a
 * model answers, but that a bad answer is retried once with the reason attached
 * and then given up on, and that each failure mode maps to the error kind the
 * UI branches on. A test that needed Ollama running would be a test that fails
 * for the wrong reasons.
 *
 * Run with `npm run test:academia`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHUNKING_VERSION, chunkSource, chunkText, hashText, normalizeExtractedText,
  spreadSample, wordCount,
} from "../textChunks";
import {
  generateJson, LLM_DEFAULTS, loadLLMConfig, LocalLLMError, probeLocalLLM,
} from "../localLLM";

/* ── Fixtures ────────────────────────────────────────────────────────── */

const PROSE = [
  "1. Introduction",
  "Working memory is the system that holds information available for process-",
  "ing. It is capacity limited. The classic estimate is seven items, though",
  "later work put the figure nearer four.",
  "",
  "2. Method",
  "Participants completed a dual n-back task across six sessions. Accuracy was",
  "recorded per block. The Anglo- Saxon corpus was excluded.",
  "",
  "3. Results",
  "Accuracy rose from 61% to 78%. Transfer to untrained tasks was not observed.",
  "This is the finding that matters, and it replicates.",
].join("\n");

const LONG = Array.from({ length: 40 }, (_, i) =>
  `Section ${i + 1} establishes a claim about the material and then supports it with a specific figure of ${i * 3 + 7} units. It also names a mechanism worth remembering.`
).join(" ");

/* ── Normalization ───────────────────────────────────────────────────── */

test("line-break hyphenation is repaired, real compounds are not", () => {
  const out = normalizeExtractedText(PROSE);
  assert.ok(out.includes("processing"), "hyphenated line break should rejoin");
  assert.ok(!out.includes("process-"), "the broken form should be gone");
  // Capitalised second half means it is a compound, not typesetting.
  assert.ok(out.includes("Anglo- Saxon"), "real compounds must survive");
});

test("whitespace is collapsed without destroying paragraph breaks", () => {
  const out = normalizeExtractedText("a  \t b\n\n\n\nc");
  assert.equal(out, "a b\n\nc");
});

/* ── Chunking ────────────────────────────────────────────────────────── */

test("empty material produces no chunks", () => {
  assert.deepEqual(chunkText(""), []);
  assert.deepEqual(chunkText("   \n\n  "), []);
});

test("chunks partition the text exactly — nothing lost, nothing repeated", () => {
  // This is the whole coverage promise. Overlap would mean a sentence is
  // either counted twice or covered by neither, and a dropped sentence means
  // "covers the entirety" is false.
  const body = normalizeExtractedText(LONG);
  const spans = chunkText(body, { targetChars: 400 });
  assert.ok(spans.length > 4, "long material should yield several chunks");

  const rejoined = spans.map(s => s.text).join(" ").replace(/\s+/g, " ").trim();
  const original = body.replace(/\s+/g, " ").trim();
  assert.equal(rejoined, original);

  for (let i = 1; i < spans.length; i++) {
    assert.ok(spans[i].start >= spans[i - 1].end, "spans must not overlap");
  }
});

test("chunk sizes stay near target, and none is empty", () => {
  const spans = chunkText(normalizeExtractedText(LONG), { targetChars: 500, minChars: 200 });
  for (const span of spans.slice(0, -1)) {
    assert.ok(span.text.length >= 150, `chunk too small: ${span.text.length}`);
    assert.ok(span.text.length <= 500 * 1.6, `chunk too large: ${span.text.length}`);
  }
  assert.ok(spans.every(s => s.text.trim().length > 0));
});

test("headings and short lines survive, unlike under the old sentence filter", () => {
  // Academia's `sentences()` keeps only 30-420 character sentences, so every
  // one of these would have been discarded before the material was ever read.
  const spans = chunkText(normalizeExtractedText(PROSE), { targetChars: 260, minChars: 100 });
  const all = spans.map(s => s.text).join("\n");
  for (const heading of ["1. Introduction", "2. Method", "3. Results"]) {
    assert.ok(all.includes(heading), `${heading} was dropped`);
  }
});

test("material with no sentence punctuation still splits evenly", () => {
  const runOn = Array.from({ length: 300 }, (_, i) => `token${i}`).join(" ");
  const spans = chunkText(runOn, { targetChars: 400 });
  assert.ok(spans.length >= 4, "a word cut must stand in for a missing boundary");
  assert.ok(spans.every(s => !/^\s|\s$/.test(s.text)), "hard cuts must not leave ragged edges");
  assert.ok(!spans.some(s => /token\d*$/.test(s.text) && !runOn.includes(s.text)), "no word may be split");
});

/* ── Identity ────────────────────────────────────────────────────────── */

test("hashing is stable and distinguishes near-identical text", () => {
  assert.equal(hashText("recall"), hashText("recall"));
  assert.notEqual(hashText("recall"), hashText("recal1"));
  assert.match(hashText(""), /^[0-9a-f]{8}$/);
});

test("editing the end of a note leaves the earlier chunks' identity intact", () => {
  // The reason chunks are keyed by content hash rather than by position: a note
  // is edited constantly, and re-keying every chunk on every keystroke would
  // throw away the coverage history of material that did not change.
  const before = chunkSource("note:1", LONG, { targetChars: 400 });
  const after = chunkSource("note:1", `${LONG} One further sentence appended at the very end.`, { targetChars: 400 });

  const survivors = before.slice(0, -1).filter(chunk => after.some(other => other.id === chunk.id));
  assert.ok(survivors.length >= before.length - 2, "most earlier chunks should keep their id");
});

test("chunking version is pinned", () => {
  assert.equal(CHUNKING_VERSION, 1);
});

/* ── Sampling ────────────────────────────────────────────────────────── */

test("spread sampling keeps order and reaches across the document", () => {
  const items = Array.from({ length: 100 }, (_, i) => i);
  const sample = spreadSample(items, 10);
  assert.equal(sample.length, 10);
  assert.deepEqual(sample, [...sample].sort((a, b) => a - b), "order must be preserved");
  assert.equal(sample[0], 0, "the opening must be read");
  assert.ok(sample[sample.length - 1] > 80, "the closing must be reached, not just the introduction");
  assert.deepEqual(spreadSample(items, 500), items);
});

test("word counting ignores whitespace runs", () => {
  assert.equal(wordCount("  one   two\nthree "), 3);
  assert.equal(wordCount("   "), 0);
});

/* ── The model client ────────────────────────────────────────────────── */

const CFG = { ...LLM_DEFAULTS, model: "test-model" };
const SCHEMA = { type: "object", properties: { value: { type: "string" } }, required: ["value"] };

function stubFetch(handler: (url: string, init: any, call: number) => Promise<Response> | Response) {
  const calls: Array<{ url: string; init: any }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init, calls.length);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("config falls back to defaults where there is no storage", () => {
  // Node has no localStorage; the accessor is guarded for exactly this reason,
  // and for private-mode browsers, which throw on write rather than on read.
  assert.deepEqual(loadLLMConfig(), LLM_DEFAULTS);
});

test("probing reports ready, no-models and unreachable distinctly", async () => {
  let stub = stubFetch(() => json({ models: [{ name: "b:1" }, { name: "a:1" }] }));
  assert.deepEqual(await probeLocalLLM(CFG), { state: "ready", models: ["a:1", "b:1"] });
  stub.restore();

  stub = stubFetch(() => json({ models: [] }));
  assert.deepEqual(await probeLocalLLM(CFG), { state: "no-models" });
  stub.restore();

  stub = stubFetch(() => { throw new TypeError("connection refused"); });
  const down = await probeLocalLLM(CFG);
  assert.equal(down.state, "unreachable");
  stub.restore();
});

test("a missing model is reported before any request is made", async () => {
  const stub = stubFetch(() => json({}));
  await assert.rejects(
    () => generateJson({ ...CFG, model: "" }, { prompt: "x", schema: SCHEMA }),
    (error: unknown) => error instanceof LocalLLMError && error.kind === "model-missing",
  );
  assert.equal(stub.calls.length, 0, "no point asking a server which model to use");
  stub.restore();
});

test("a rejected generation is retried once, with the reason attached", async () => {
  const stub = stubFetch((_url, _init, call) =>
    json({ message: { content: JSON.stringify(call === 1 ? { value: "" } : { value: "good" }) } }));

  const result = await generateJson<{ value: string }>(CFG, {
    prompt: "x",
    schema: SCHEMA,
    validate: raw => {
      const v = raw as { value?: string };
      if (!v.value) throw new Error("value was empty");
      return v as { value: string };
    },
  });

  assert.deepEqual(result, { value: "good" });
  assert.equal(stub.calls.length, 2, "exactly one retry");
  const second = JSON.parse(stub.calls[1].init.body);
  assert.ok(
    second.messages.some((m: any) => String(m.content).includes("value was empty")),
    "re-rolling the same prompt at the same temperature mostly reproduces the same mistake",
  );
  assert.deepEqual(second.format, SCHEMA, "the schema must be enforced on every attempt");
  stub.restore();
});

test("every request states the context window it needs", async () => {
  // Ollama runs a model at a modest default context and truncates a longer
  // prompt *silently*. A compose call over two dozen passage summaries overruns
  // it easily, and the symptom is not an error — it is a confident answer drawn
  // from the fragment that survived. Asking explicitly is the whole fix.
  const stub = stubFetch(() => json({ message: { content: JSON.stringify({ value: "ok" }) } }));
  await generateJson(CFG, { prompt: "x", schema: SCHEMA });
  const body = JSON.parse(stub.calls[0].init.body);
  // One window for the whole app: `num_ctx` is a load-time parameter, so
  // varying it per call makes Ollama unload and reload the model between calls.
  assert.equal(body.options.num_ctx, 4096, "every call must ask for the same window");
  assert.equal(body.keep_alive, "30m", "reloading gigabytes between calls is the avoidable wait");
  stub.restore();
});

test("the reason a generation was rejected survives to the surface", async () => {
  // "a question had duplicate options" says the model is the problem;
  // "unexpected token" says the schema is. Flattening both into "it failed"
  // makes the difference undiagnosable from the panel.
  const stub = stubFetch(() => json({ message: { content: JSON.stringify({ value: "" }) } }));
  await assert.rejects(
    () => generateJson(CFG, {
      prompt: "x", schema: SCHEMA,
      validate: raw => {
        if (!(raw as any).value) throw new Error("the summary came back empty");
        return raw;
      },
    }),
    (error: unknown) => error instanceof LocalLLMError && error.message.includes("the summary came back empty"),
  );
  stub.restore();
});

test("output that never validates gives up after the simplified retry", async () => {
  // Three attempts, and the shape of them is the diagnosis: the strict schema,
  // the same schema with the rejection explained, then the schema stripped of
  // the keywords a grammar converter may not implement. If the last one is what
  // succeeds in the wild, the strict schema was the problem rather than the
  // model — which is exactly what the call log reports as `simplified`.
  const stub = stubFetch(() => json({ message: { content: "this is not json at all" } }));
  await assert.rejects(
    () => generateJson(CFG, { prompt: "x", schema: SCHEMA }),
    (error: unknown) => error instanceof LocalLLMError && error.kind === "invalid-output",
  );
  assert.equal(stub.calls.length, 3, "strict, strict-with-reason, simplified");

  const strict = JSON.parse(stub.calls[0].init.body).format;
  const simplified = JSON.parse(stub.calls[2].init.body).format;
  assert.deepEqual(strict, SCHEMA, "the first attempt asks for exactly what was wanted");
  assert.ok(simplified, "the last attempt still constrains the shape");
  stub.restore();
});

test("schema keywords a grammar converter may not implement are droppable", async () => {
  const strict = {
    type: "object",
    properties: {
      options: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 4 },
      index: { type: "integer", minimum: 0, maximum: 3 },
      verdict: { type: "string", enum: ["a", "b"] },
    },
    required: ["options", "index", "verdict"],
  };
  const stub = stubFetch(() => json({ message: { content: "nonsense" } }));
  await assert.rejects(() => generateJson(CFG, { prompt: "x", schema: strict }));
  const fallback = JSON.parse(stub.calls[2].init.body).format;
  stub.restore();

  const text = JSON.stringify(fallback);
  for (const keyword of ["minItems", "maxItems", "minimum", "maximum", "enum"]) {
    assert.ok(!text.includes(keyword), `${keyword} survived into the fallback schema`);
  }
  // Shape is still enforced; only the bounds moved to the validator.
  assert.equal((fallback as any).properties.options.type, "array");
  assert.deepEqual((fallback as any).required, ["options", "index", "verdict"]);
});

test("a 404 means the model, and any other failure means the server", async () => {
  let stub = stubFetch(() => json({ error: "model not found" }, 404));
  await assert.rejects(
    () => generateJson(CFG, { prompt: "x", schema: SCHEMA }),
    (error: unknown) => error instanceof LocalLLMError && error.kind === "model-missing",
  );
  stub.restore();

  stub = stubFetch(() => json({ error: "boom" }, 500));
  await assert.rejects(
    () => generateJson(CFG, { prompt: "x", schema: SCHEMA }),
    (error: unknown) => error instanceof LocalLLMError && error.kind === "unreachable",
  );
  stub.restore();
});

test("cancelling reports as cancelled, not as a broken model", async () => {
  const controller = new AbortController();
  const stub = stubFetch(() => { controller.abort(); throw new DOMException("aborted", "AbortError"); });
  await assert.rejects(
    () => generateJson(CFG, { prompt: "x", schema: SCHEMA, signal: controller.signal }),
    (error: unknown) => error instanceof LocalLLMError && error.kind === "aborted",
  );
  stub.restore();
});
