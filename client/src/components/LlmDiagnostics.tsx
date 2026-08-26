/**
 * What the model is actually doing, and what this runtime can actually take.
 *
 * Two rounds of schema changes were made from outside the machine, on guesses
 * about which JSON Schema keywords Ollama's grammar converter implements. That
 * was the wrong way round. This panel replaces the guessing with two things:
 *
 * - **Check runtime** runs a short probe suite, one schema feature at a time,
 *   and says plainly which ones work here. If bounded arrays fail, the strict
 *   schema is the problem and no amount of prompt work will fix it.
 * - **The call log** shows the last few model calls with their timing and
 *   outcome, including whether a call only succeeded after falling back to a
 *   simplified schema — which is the same finding, observed in the wild.
 *
 * Both are diagnostic, not decorative. Neither runs unless asked, because each
 * probe costs real seconds of the same GPU the rest of the app is waiting on.
 */

import { useEffect, useState } from "react";
import { Activity, Check, Loader2, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { clearCallLog, getCallLog, onCallLog, type CallRecord, type LocalLLMConfig } from "@/lib/localLLM";
import { probeSchemaSupport, type ProbeResult } from "@/lib/llmProbe";

const OUTCOME_TONE: Record<CallRecord["outcome"], string> = {
  ok: "text-[hsl(150_45%_58%)]",
  retried: "text-[hsl(43_70%_62%)]",
  simplified: "text-[hsl(28_70%_62%)]",
  failed: "text-[hsl(350_60%_66%)]",
};

export default function LlmDiagnostics({ cfg, onClose }: { cfg: LocalLLMConfig; onClose: () => void }) {
  const [log, setLog] = useState<CallRecord[]>(() => getCallLog());
  const [probes, setProbes] = useState<ProbeResult[]>([]);
  const [probing, setProbing] = useState(false);

  useEffect(() => onCallLog(() => setLog(getCallLog())), []);

  const runProbes = async () => {
    setProbing(true);
    setProbes([]);
    try {
      await probeSchemaSupport(cfg, result => setProbes(old => [...old, result]));
    } finally {
      setProbing(false);
    }
  };

  const strictFails = probes.some(probe => !probe.ok && probe.name.startsWith("bounded"));

  return <div className="space-y-2 rounded-sm border border-[hsl(220_18%_18%)] bg-[hsl(222_20%_4%/.8)] p-2.5">
    <div className="flex items-center gap-2">
      <Activity size={11} className="text-cyan-400/55" />
      <span className="text-[8px] font-mono tracking-[.18em] text-foreground/55">DIAGNOSTICS</span>
      <button onClick={onClose} className="ml-auto text-muted-foreground/40 hover:text-foreground"><X size={11} /></button>
    </div>

    <button onClick={() => void runProbes()} disabled={probing || !cfg.model}
      className="flex w-full items-center justify-center gap-1.5 rounded-sm border border-[hsl(190_40%_24%)] py-1.5 text-[8px] font-mono tracking-widest text-[hsl(190_60%_64%)] disabled:opacity-30">
      {probing ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />} CHECK RUNTIME
    </button>

    {probes.length > 0 && <div className="space-y-1">
      {probes.map(probe => <div key={probe.name} className="flex items-start gap-1.5">
        <span className={cn("mt-px text-[8px] font-mono", probe.ok ? "text-[hsl(150_45%_58%)]" : "text-[hsl(350_60%_66%)]")}>
          {probe.ok ? "OK " : "NO "}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[8.5px] text-foreground/60">{probe.name} <span className="text-muted-foreground/30">{probe.ms}ms</span></p>
          {!probe.ok && <p className="text-[8px] leading-3.5 text-muted-foreground/40">{probe.matters}</p>}
          {!probe.ok && probe.detail && <p className="truncate text-[8px] text-[hsl(350_45%_60%)]/60">{probe.detail}</p>}
        </div>
      </div>)}

      {strictFails && <p className="rounded-sm border border-[hsl(28_45%_28%)] bg-[hsl(28_35%_8%)] p-2 text-[8px] leading-4 text-[hsl(28_70%_70%)]">
        Bounded arrays are not supported by this runtime, which is why questions fail to build.
        Generation already falls back to a simplified schema after a rejection — that fallback is
        now doing the real work, and the bounds are enforced afterwards instead.
      </p>}
    </div>}

    <div className="flex items-center gap-2 pt-1">
      <span className="text-[8px] font-mono tracking-[.16em] text-muted-foreground/35">LAST {log.length} CALLS</span>
      <button onClick={clearCallLog} className="ml-auto text-muted-foreground/30 hover:text-foreground"><RotateCcw size={10} /></button>
    </div>

    {log.length === 0 && <p className="text-[8px] text-muted-foreground/25">Nothing yet. Read a source, prepare one, or start a run.</p>}

    <div className="max-h-52 space-y-1 overflow-y-auto">
      {log.map((entry, i) => <div key={`${entry.at}-${i}`} className="border-l pl-2" style={{ borderColor: "hsl(220 18% 16%)" }}>
        <div className="flex items-baseline gap-2">
          <span className={cn("text-[8px] font-mono tracking-wider", OUTCOME_TONE[entry.outcome])}>{entry.outcome.toUpperCase()}</span>
          <span className="min-w-0 flex-1 truncate text-[8.5px] text-foreground/55">{entry.label}</span>
          <span className="text-[8px] font-mono tabular-nums text-muted-foreground/30">{(entry.ms / 1000).toFixed(1)}s</span>
        </div>
        {entry.attempts > 1 && <p className="text-[8px] text-muted-foreground/30">{entry.attempts} attempts</p>}
        {entry.detail && <p className="text-[8px] leading-3.5 text-[hsl(350_45%_62%)]/60">{entry.detail}</p>}
        {entry.sample && <p className="truncate text-[8px] font-mono text-muted-foreground/25">{entry.sample}</p>}
      </div>)}
    </div>
  </div>;
}
