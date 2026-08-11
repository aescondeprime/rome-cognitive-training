import { useMemo, useState } from "react";
import { FlaskConical, RotateCcw, TrendingDown, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { projectFinancials, type FinancialState, type ProjectionResult, type ScenarioAdjustments } from "@/lib/financialEngine";

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const emptyScenario: ScenarioAdjustments = {
  additionalShifts: 0,
  additionalIncome: 0,
  oneTimePurchase: 0,
  monthlySpendingChange: 0,
  extraDebtPayment: 0,
};

function numeric(value: string, signed = false): number {
  const result = Number(value);
  if (!Number.isFinite(result)) return 0;
  return signed ? result : Math.max(0, result);
}
function ScenarioField({ label, hint, value, onChange, signed = false }: { label: string; hint: string; value: number; onChange: (value: number) => void; signed?: boolean }) {
  return (
    <div className="rounded-lg border border-white/[0.07] bg-black/15 p-3">
      <Label className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{label}</Label>
      <Input
        className="mt-2 h-10 border-white/10 bg-black/20 font-mono text-sm"
        type="number"
        min={signed ? undefined : 0}
        step={label.includes("shift") ? 1 : 10}
        value={value}
        onChange={event => onChange(numeric(event.target.value, signed))}
      />
      <p className="mt-1.5 text-[10px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function ComparisonCard({ label, baseline, scenario, money = true }: { label: string; baseline: number; scenario: number; money?: boolean }) {
  const delta = scenario - baseline;
  const positive = delta >= 0;
  const format = (value: number) => money ? currency.format(value) : `${Math.round(value)}/100`;
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
      <p className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] text-muted-foreground line-through decoration-white/20">{format(baseline)}</p>
          <p className="font-mono text-xl text-foreground">{format(scenario)}</p>
        </div>
        <span className={`flex items-center gap-1 font-mono text-[10px] ${positive ? "text-emerald-300" : "text-rose-300"}`}>
          {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {delta >= 0 ? "+" : ""}{money ? currency.format(delta) : Math.round(delta)}
        </span>
      </div>
    </div>
  );
}

export default function WhatIfDialog({ state, baseline }: { state: FinancialState; baseline: ProjectionResult }) {
  const [scenario, setScenario] = useState<ScenarioAdjustments>(emptyScenario);
  const projection = useMemo(() => projectFinancials(state, { scenario }), [state, scenario]);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" className="border-[hsl(var(--accent-h)_50%_34%/0.36)] bg-[hsl(var(--accent-h)_50%_25%/0.06)] text-xs">
          <FlaskConical className="mr-2 h-3.5 w-3.5" /> What-if simulation
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto border-white/10 bg-[hsl(222_18%_7%)]">
        <DialogHeader>
          <DialogTitle className="font-roman tracking-[0.08em]">Simulation Lab</DialogTitle>
          <DialogDescription>Test a decision without changing your saved financial model.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 md:grid-cols-3">
          <ScenarioField label="Additional shifts" hint="Uses your next paycheck's shift value after taxes." value={scenario.additionalShifts} onChange={value => setScenario(current => ({ ...current, additionalShifts: Math.floor(value) }))} />
          <ScenarioField label="Additional income" hint="Adds expected net cash this month." value={scenario.additionalIncome} onChange={value => setScenario(current => ({ ...current, additionalIncome: value }))} />
          <ScenarioField label="One-time purchase" hint="Tests whether a purchase is affordable now." value={scenario.oneTimePurchase} onChange={value => setScenario(current => ({ ...current, oneTimePurchase: value }))} />
          <ScenarioField label="Monthly spending change" hint="Positive adds spending; negative represents a cut." value={scenario.monthlySpendingChange} signed onChange={value => setScenario(current => ({ ...current, monthlySpendingChange: value }))} />
          <ScenarioField label="Extra debt payment" hint="Tests an additional principal payment this month." value={scenario.extraDebtPayment} onChange={value => setScenario(current => ({ ...current, extraDebtPayment: value }))} />
          <button
            type="button"
            onClick={() => setScenario(emptyScenario)}
            className="flex min-h-28 flex-col items-center justify-center rounded-lg border border-dashed border-white/10 text-muted-foreground transition hover:border-white/20 hover:text-foreground"
          >
            <RotateCcw className="mb-2 h-4 w-4" />
            <span className="text-[10px] uppercase tracking-widest">Reset scenario</span>
          </button>
        </div>

        <div className="grid gap-3 border-t border-white/[0.07] pt-5 md:grid-cols-3">
          <ComparisonCard label="Safe daily spending" baseline={baseline.safeDailySpend} scenario={projection.safeDailySpend} />
          <ComparisonCard label="Projected month-end" baseline={baseline.projectedMonthEnd} scenario={projection.projectedMonthEnd} />
          <ComparisonCard label="Financial health" baseline={baseline.healthScore} scenario={projection.healthScore} money={false} />
        </div>

        <div className={`rounded-xl border p-4 ${projection.projectedMonthEnd >= 0 ? "border-emerald-400/15 bg-emerald-400/[0.04]" : "border-rose-400/15 bg-rose-400/[0.04]"}`}>
          <p className="font-roman text-xs uppercase tracking-widest">Scenario outcome</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {projection.projectedMonthEnd >= 0
              ? `This scenario finishes the month at ${currency.format(projection.projectedMonthEnd)} and leaves ${currency.format(projection.safeDailySpend)} per day available.`
              : `This scenario creates a ${currency.format(Math.abs(projection.projectedMonthEnd))} month-end shortfall. Add income or reduce planned spending before committing.`}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
