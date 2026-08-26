/**
 * Ask the installed runtime what it can actually do.
 *
 * Everything about constrained decoding has been guesswork from outside: which
 * JSON Schema keywords Ollama's grammar converter implements varies by version,
 * and when one is not supported the failure does not say so — the request is
 * rejected, or the keyword is quietly ignored, and either way it looks like the
 * model being bad at its job. Two rounds of schema changes were made blind on
 * that basis.
 *
 * So this asks. Each probe is a tiny, cheap generation using one schema feature,
 * and the result says plainly whether that feature works here. It turns "the
 * rounds will not build" into a specific fact about a specific machine.
 */

import { generateJson, LocalLLMError, type JsonSchema, type LocalLLMConfig } from "@/lib/localLLM";

export interface ProbeResult {
  name: string;
  /** What breaks if this one fails. */
  matters: string;
  ok: boolean;
  ms: number;
  detail?: string;
}

interface Probe {
  name: string;
  matters: string;
  schema: JsonSchema;
  prompt: string;
  check?: (value: any) => void;
  numPredict?: number;
}

const PROBES: Probe[] = [
  {
    name: "plain object",
    matters: "Nothing works without this.",
    schema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] },
    prompt: "Reply with the word yes in `answer`.",
    numPredict: 60,
  },
  {
    name: "array of strings",
    matters: "Rubrics, options and key terms are all arrays.",
    schema: {
      type: "object",
      properties: { items: { type: "array", items: { type: "string" } } },
      required: ["items"],
    },
    prompt: "Put the words red, green and blue in `items`.",
    check: value => { if (!Array.isArray(value.items)) throw new Error("items was not a list"); },
    numPredict: 120,
  },
  {
    name: "bounded array (minItems / maxItems)",
    matters: "This is what stops a small model emitting options forever. If it fails here, the strict schema is the problem, not the model.",
    schema: {
      type: "object",
      properties: { items: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 4 } },
      required: ["items"],
    },
    prompt: "Put exactly four colours in `items`.",
    check: value => { if (!Array.isArray(value.items) || value.items.length !== 4) throw new Error(`got ${value.items?.length ?? 0} items, not 4`); },
    numPredict: 120,
  },
  {
    name: "integer with bounds",
    matters: "The index of the correct multiple-choice option.",
    schema: {
      type: "object",
      properties: { index: { type: "integer", minimum: 0, maximum: 3 } },
      required: ["index"],
    },
    prompt: "Put the number 2 in `index`.",
    check: value => { if (!Number.isInteger(value.index)) throw new Error("index was not a whole number"); },
    numPredict: 60,
  },
  {
    name: "enum",
    matters: "The three grading bands.",
    schema: {
      type: "object",
      properties: { verdict: { type: "string", enum: ["correct", "partial", "wrong"] } },
      required: ["verdict"],
    },
    prompt: "Put the word partial in `verdict`.",
    check: value => { if (!["correct", "partial", "wrong"].includes(value.verdict)) throw new Error(`got ${value.verdict}`); },
    numPredict: 60,
  },
  {
    name: "nested object in an array",
    matters: "A question carries its options and rubric together.",
    schema: {
      type: "object",
      properties: {
        rows: {
          type: "array",
          items: { type: "object", properties: { label: { type: "string" }, value: { type: "string" } }, required: ["label", "value"] },
          minItems: 2, maxItems: 2,
        },
      },
      required: ["rows"],
    },
    prompt: "Put two rows in `rows`: label a with value one, label b with value two.",
    check: value => { if (!Array.isArray(value.rows) || !value.rows.length) throw new Error("rows was empty"); },
    numPredict: 200,
  },
];

/**
 * Run the probes in order, stopping early if the runtime is simply not there.
 *
 * `retries: 0` on purpose — a probe that only passes on the second attempt has
 * failed at the thing being asked, and the fallback to a simplified schema
 * would hide exactly the answer wanted here.
 */
export async function probeSchemaSupport(
  cfg: LocalLLMConfig,
  onResult?: (result: ProbeResult) => void,
  signal?: AbortSignal,
): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];

  for (const probe of PROBES) {
    signal?.throwIfAborted();
    const started = Date.now();
    let result: ProbeResult;
    try {
      const value = await generateJson<any>(cfg, {
        schema: probe.schema,
        prompt: probe.prompt,
        system: "Answer with the requested JSON and nothing else.",
        temperature: 0,
        numCtx: 1024,
        numPredict: probe.numPredict ?? 120,
        retries: 0,
        signal,
        label: `probe: ${probe.name}`,
        validate: raw => { probe.check?.(raw); return raw; },
      });
      void value;
      result = { name: probe.name, matters: probe.matters, ok: true, ms: Date.now() - started };
    } catch (error) {
      const detail = error instanceof LocalLLMError ? `${error.kind}: ${error.message}` : String(error);
      result = { name: probe.name, matters: probe.matters, ok: false, ms: Date.now() - started, detail };
    }
    results.push(result);
    onResult?.(result);
    // If the runtime cannot do a plain object there is nothing to learn from
    // the rest, and each probe costs real seconds.
    if (!results[0].ok) break;
  }

  return results;
}
