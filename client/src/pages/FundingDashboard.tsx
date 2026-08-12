import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleGauge,
  Clock3,
  CreditCard,
  Landmark,
  Pencil,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import FinancialModelDialog from "@/components/financial/FinancialModelDialog";
import ProjectionChart from "@/components/financial/ProjectionChart";
import WhatIfDialog from "@/components/financial/WhatIfDialog";
import { projectFinancialMonth, projectFinancials, type FinancialEvent, type FinancialState } from "@/lib/financialEngine";
import { loadFinancialState, saveFinancialState } from "@/lib/financialStore";

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const wholeDollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rome-card overflow-hidden ${className}`}>{children}</div>;
}

function MetricLabel({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
      {icon}{children}
    </div>
  );
}

function healthLabel(score: number, hasData: boolean): string {
  if (!hasData) return "Needs input";
  if (score >= 80) return "Strong";
  if (score >= 65) return "Stable";
  if (score >= 45) return "Watch";
  return "At risk";
}

function freshness(updatedAt: string): { label: string; detail: string; tone: string } {
  const value = new Date(updatedAt).getTime();
  const hours = Number.isFinite(value) ? Math.max(0, (Date.now() - value) / 3_600_000) : 999;
  if (hours < 24) return { label: "Current", detail: hours < 1 ? "updated moments ago" : `updated ${Math.floor(hours)}h ago`, tone: "text-emerald-300" };
  if (hours < 72) return { label: "Aging", detail: `updated ${Math.floor(hours / 24)}d ago`, tone: "text-amber-300" };
  return { label: "Stale", detail: `updated ${Math.floor(hours / 24)}d ago`, tone: "text-rose-300" };
}

function eventIcon(event: FinancialEvent) {
  if (event.amount > 0) return <ArrowUpRight className="h-3.5 w-3.5" />;
  if (event.type === "credit") return <CreditCard className="h-3.5 w-3.5" />;
  if (event.type === "loan") return <Landmark className="h-3.5 w-3.5" />;
  if (event.type === "goal") return <Target className="h-3.5 w-3.5" />;
  return <ArrowDownRight className="h-3.5 w-3.5" />;
}

function BalanceEditor({ state, onSave }: { state: FinancialState; onSave: (balance: number) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(state.currentBalance));

  useEffect(() => setValue(String(state.currentBalance)), [state.currentBalance]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 px-2 text-[10px] text-muted-foreground hover:text-foreground">
          <Pencil className="mr-1.5 h-3 w-3" /> Update balance
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md border-white/10 bg-[hsl(222_18%_7%)]">
        <DialogHeader>
          <DialogTitle className="font-roman tracking-wider">Current account balance</DialogTitle>
          <DialogDescription>Enter the liquid balance ROME should use as today's starting point.</DialogDescription>
        </DialogHeader>
        <div className="relative py-3">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 font-mono text-lg text-muted-foreground">$</span>
          <Input
            autoFocus
            type="number"
            step="0.01"
            value={value}
            onChange={event => setValue(event.target.value)}
            className="h-14 border-white/10 bg-black/20 pl-9 font-mono text-2xl"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            onClick={() => {
              const parsed = Number(value);
              onSave(Number.isFinite(parsed) ? parsed : 0);
              setOpen(false);
            }}
          >
            <Check className="mr-2 h-4 w-4" /> Save balance
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function FundingDashboard() {
  const { data: activeProfile } = useQuery<any>({ queryKey: ["/api/active-profile"] });
  const profileId = activeProfile?.id as number | undefined;
  const [state, setState] = useState<FinancialState>(() => loadFinancialState());
  const [projectionMonthOffset, setProjectionMonthOffset] = useState(0);

  useEffect(() => {
    setState(loadFinancialState(profileId));
  }, [profileId]);

  const updateState = useCallback((next: FinancialState) => {
    setState(next);
    saveFinancialState(next, profileId);
  }, [profileId]);

  const projection = useMemo(() => projectFinancials(state), [state]);
  const chartProjection = useMemo(
    () => projectFinancialMonth(state, projectionMonthOffset),
    [projectionMonthOffset, state],
  );

  useEffect(() => {
    setProjectionMonthOffset(current => Math.min(current, Math.max(0, state.forecastMonths - 1)));
  }, [state.forecastMonths]);
  const dataFreshness = freshness(state.balanceUpdatedAt);
  const monthDelta = projection.projectedMonthEnd - state.currentBalance;
  const upcomingEvents = projection.events.slice(0, 8);
  const totalDebt = state.loans.reduce((sum, loan) => sum + loan.totalBalance, 0)
    + state.creditAccounts.reduce((sum, account) => sum + account.currentBalance, 0);
  const scheduledCount = state.expenses.length + state.largeExpenses.length + state.loans.length + state.creditAccounts.length;
  const hasFinancialData = state.currentBalance !== 0 || projection.remainingIncome > 0 || projection.committedOutflow > 0 || totalDebt > 0;
  const goalProgress = state.goals.length
    ? state.goals.reduce((sum, goal) => sum + Math.min(1, goal.currentAmount / Math.max(1, goal.targetAmount)), 0) / state.goals.length * 100
    : 0;
  const safePositive = projection.safeDailySpend >= 0;

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 pb-8">
      <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
        <div>
          <div className="flex items-center gap-2 text-[9px] uppercase tracking-[0.22em] text-[hsl(var(--accent-h)_65%_57%)]">
            <CircleGauge className="h-3.5 w-3.5" /> Financial Node
          </div>
          <h2 className="mt-1 font-roman text-2xl tracking-[0.08em] text-foreground">Funding Dashboard</h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            A living projection of account health, dated obligations, and the amount available each day.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <WhatIfDialog state={state} baseline={projection} />
          <FinancialModelDialog
            state={state}
            onChange={updateState}
            trigger={<Button className="text-xs"><Settings2 className="mr-2 h-3.5 w-3.5" /> Manage inputs</Button>}
          />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="relative min-h-48 p-6 xl:col-span-7">
          <div className="absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_100%_50%,hsl(var(--accent-h)_70%_50%/0.11),transparent_68%)]" />
          <div className="relative flex h-full flex-col justify-between gap-6">
            <div className="flex items-start justify-between gap-4">
              <MetricLabel icon={<Wallet className="h-3.5 w-3.5" />}>Current account balance</MetricLabel>
              <BalanceEditor
                state={state}
                onSave={balance => updateState({ ...state, currentBalance: balance, balanceUpdatedAt: new Date().toISOString() })}
              />
            </div>
            <div>
              <p className="font-mono text-4xl font-medium tracking-[-0.04em] text-foreground sm:text-5xl xl:text-6xl">
                {dollars.format(state.currentBalance)}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[10px]">
                <span className={dataFreshness.tone}>{dataFreshness.label}</span>
                <span className="text-muted-foreground">{dataFreshness.detail}</span>
                <button
                  type="button"
                  className="flex items-center gap-1 text-muted-foreground transition hover:text-foreground"
                  onClick={() => updateState({ ...state, balanceUpdatedAt: new Date().toISOString() })}
                >
                  <RefreshCw className="h-3 w-3" /> Mark current
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-6 border-t border-white/[0.06] pt-4">
              <div>
                <p className="text-[9px] uppercase tracking-widest text-muted-foreground">Projected month-end</p>
                <p className={`mt-1 font-mono text-lg ${projection.projectedMonthEnd >= 0 ? "text-foreground" : "text-rose-300"}`}>{dollars.format(projection.projectedMonthEnd)}</p>
              </div>
              <div>
                <p className="text-[9px] uppercase tracking-widest text-muted-foreground">Net change remaining</p>
                <p className={`mt-1 flex items-center gap-1 font-mono text-lg ${monthDelta >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                  {monthDelta >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                  {monthDelta >= 0 ? "+" : ""}{dollars.format(monthDelta)}
                </p>
              </div>
            </div>
          </div>
        </Card>

        <Card className={`relative min-h-48 p-6 xl:col-span-5 ${safePositive ? "border-emerald-400/15" : "border-rose-400/20"}`}>
          <div className={`absolute inset-0 ${safePositive ? "bg-[radial-gradient(circle_at_85%_20%,rgba(52,211,153,0.10),transparent_50%)]" : "bg-[radial-gradient(circle_at_85%_20%,rgba(251,113,133,0.12),transparent_50%)]"}`} />
          <div className="relative flex h-full flex-col justify-between gap-5">
            <div className="flex items-center justify-between gap-3">
              <MetricLabel icon={<ShieldCheck className="h-3.5 w-3.5" />}>Safe daily spending</MetricLabel>
              <span className={`rounded-full border px-2.5 py-1 font-mono text-[9px] uppercase tracking-widest ${!hasFinancialData ? "border-white/10 bg-white/[0.03] text-muted-foreground" : safePositive ? "border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300" : "border-rose-400/20 bg-rose-400/[0.07] text-rose-300"}`}>
                {!hasFinancialData ? "Set up model" : safePositive ? "Available" : "Correction needed"}
              </span>
            </div>
            <div>
              <div className="flex items-baseline gap-2">
                <p className={`font-mono text-5xl font-medium tracking-[-0.05em] sm:text-6xl ${safePositive ? "text-emerald-200" : "text-rose-200"}`}>
                  {dollars.format(projection.safeDailySpend)}
                </p>
                <span className="font-mono text-xs text-muted-foreground">/ day</span>
              </div>
              <p className="mt-3 max-w-md text-xs leading-relaxed text-muted-foreground">
                {hasFinancialData
                  ? "After all dated income, recurring payments, loans, planned discretionary spending, goals, and large expenses through month-end."
                  : "Enter your current balance, income, and dated spending to calculate this number."}
              </p>
            </div>
            <div className="flex items-center gap-2 border-t border-white/[0.06] pt-4 font-mono text-[10px] text-muted-foreground">
              <Clock3 className="h-3.5 w-3.5" /> {projection.daysRemaining} day{projection.daysRemaining === 1 ? "" : "s"} remaining in this month
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="p-5 xl:col-span-9">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
            <div>
              <MetricLabel icon={<TrendingUp className="h-3.5 w-3.5" />}>
                {projectionMonthOffset === 0 ? "Current-month projection" : "Future projection"}
              </MetricLabel>
              <h3 className="mt-1 font-roman text-sm tracking-wider">Balance trajectory</h3>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
              <div className="flex items-center rounded-lg border border-white/[0.07] bg-black/15 p-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={projectionMonthOffset === 0}
                  aria-label="View previous projection month"
                  onClick={() => setProjectionMonthOffset(current => Math.max(0, current - 1))}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="min-w-32 px-2 text-center font-mono text-[10px] uppercase tracking-wider text-foreground">
                  {chartProjection.monthLabel}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={projectionMonthOffset >= Math.max(0, state.forecastMonths - 1)}
                  aria-label="View next projection month"
                  onClick={() => setProjectionMonthOffset(current => Math.min(Math.max(0, state.forecastMonths - 1), current + 1))}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="flex items-center gap-4 font-mono text-[9px] text-muted-foreground">
                <span className="flex items-center gap-1.5"><i className="h-0.5 w-4 bg-[hsl(var(--accent-h)_82%_66%)]" /> Account balance</span>
                <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-rose-400/60" /> Dated outflow</span>
              </div>
            </div>
          </div>
          <ProjectionChart data={chartProjection.dailyPoints} />
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 xl:col-span-3 xl:grid-cols-1">
          <Card className="p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <MetricLabel>Financial health</MetricLabel>
                <p className="mt-2 font-roman text-lg">{healthLabel(projection.healthScore, hasFinancialData)}</p>
              </div>
              <div
                className="grid h-20 w-20 place-items-center rounded-full"
                style={{ background: `conic-gradient(hsl(var(--accent-h) 80% 60%) ${projection.healthScore * 3.6}deg, hsl(216 12% 14%) 0deg)` }}
              >
                <div className="grid h-[66px] w-[66px] place-items-center rounded-full bg-[hsl(222_16%_8%)] font-mono text-lg">{projection.healthScore}</div>
              </div>
            </div>
            <div className="mt-4 space-y-2 border-t border-white/[0.06] pt-4">
              {[
                ["Liquidity", projection.liquidityScore],
                ["Sustainability", projection.sustainabilityScore],
                ["Debt pressure", projection.debtPressureScore],
              ].map(([label, value]) => (
                <div key={String(label)} className="flex items-center gap-3">
                  <span className="w-24 text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-[hsl(var(--accent-h)_70%_56%/0.72)]" style={{ width: `${value}%` }} /></div>
                  <span className="w-6 text-right font-mono text-[9px] text-muted-foreground">{value}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="grid grid-cols-2 divide-x divide-white/[0.06] p-0">
            <div className="p-4">
              <MetricLabel>Income remaining</MetricLabel>
              <p className="mt-2 font-mono text-base text-emerald-300">{wholeDollars.format(projection.remainingIncome)}</p>
            </div>
            <div className="p-4">
              <MetricLabel>Outflow remaining</MetricLabel>
              <p className="mt-2 font-mono text-base text-rose-300">{wholeDollars.format(projection.committedOutflow)}</p>
            </div>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="p-5 xl:col-span-7">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <MetricLabel icon={<CalendarClock className="h-3.5 w-3.5" />}>Financial event timeline</MetricLabel>
              <h3 className="mt-1 font-roman text-sm tracking-wider">What moves the balance next</h3>
            </div>
            <span className="font-mono text-[9px] text-muted-foreground">{scheduledCount} planned item{scheduledCount === 1 ? "" : "s"}</span>
          </div>
          <div className="divide-y divide-white/[0.055]">
            {upcomingEvents.length === 0 && (
              <div className="rounded-lg border border-dashed border-white/10 py-9 text-center">
                <CalendarClock className="mx-auto mb-2 h-5 w-5 text-muted-foreground/50" />
                <p className="text-xs text-muted-foreground">Add dated income and spending to build the timeline.</p>
              </div>
            )}
            {upcomingEvents.map(event => (
              <div key={event.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${event.liabilityAmount ? "border-amber-400/15 bg-amber-400/[0.05] text-amber-300" : event.amount > 0 ? "border-emerald-400/15 bg-emerald-400/[0.05] text-emerald-300" : "border-rose-400/15 bg-rose-400/[0.05] text-rose-300"}`}>
                  {eventIcon(event)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-foreground">{event.name}</p>
                  <p className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                    {new Date(`${event.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · {event.type}
                  </p>
                </div>
                <p className={`font-mono text-xs ${event.liabilityAmount ? "text-amber-300" : event.amount > 0 ? "text-emerald-300" : "text-rose-300"}`}>
                  {event.liabilityAmount ? "+" : event.amount > 0 ? "+" : "−"}{dollars.format(event.liabilityAmount ?? Math.abs(event.amount))}{event.liabilityAmount ? " debt" : ""}
                </p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5 xl:col-span-5">
          <div className="mb-4">
            <MetricLabel icon={<Landmark className="h-3.5 w-3.5" />}>{state.forecastMonths}-month outlook</MetricLabel>
            <h3 className="mt-1 font-roman text-sm tracking-wider">Monthly rollover</h3>
          </div>
          <div className="space-y-3">
            {projection.monthlySnapshots.map((month, index) => {
              const maxMagnitude = Math.max(1, ...projection.monthlySnapshots.map(item => Math.abs(item.endingBalance)));
              return (
                <div key={month.month} className="grid grid-cols-[36px_1fr_auto] items-center gap-3">
                  <span className="font-mono text-[9px] uppercase text-muted-foreground">{month.label}</span>
                  <div className="relative h-6 overflow-hidden rounded-md bg-white/[0.035]">
                    <div
                      className={`absolute inset-y-0 left-0 rounded-md ${month.endingBalance >= 0 ? "bg-[hsl(var(--accent-h)_70%_52%/0.22)]" : "bg-rose-400/20"}`}
                      style={{ width: `${Math.max(3, Math.abs(month.endingBalance) / maxMagnitude * 100)}%` }}
                    />
                    {index > 0 && <div className="absolute inset-y-1 left-0 border-l border-white/10" />}
                  </div>
                  <span className={`w-24 text-right font-mono text-[10px] ${month.endingBalance >= 0 ? "text-foreground" : "text-rose-300"}`}>{wholeDollars.format(month.endingBalance)}</span>
                </div>
              );
            })}
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 border-t border-white/[0.06] pt-4">
            <div className="rounded-lg bg-black/15 p-3">
              <MetricLabel>Total debt</MetricLabel>
              <p className="mt-2 font-mono text-sm">{wholeDollars.format(totalDebt)}</p>
            </div>
            <div className="rounded-lg bg-black/15 p-3">
              <MetricLabel>Average goal progress</MetricLabel>
              <p className="mt-2 font-mono text-sm">{Math.round(goalProgress)}%</p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
