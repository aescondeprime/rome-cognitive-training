export type Recurrence = "once" | "weekly" | "biweekly" | "monthly" | "annual";
export type ExpenseKind = "subscription" | "membership" | "recurring" | "discretionary";

export interface PaycheckPlan {
  id: string;
  name: string;
  hourlyRate: number;
  hoursPerShift: number;
  shiftsWorked: number;
  overtimeHours: number;
  overtimeMultiplier: number;
  differentialPerShift: number;
  taxRate: number;
  fixedDeductions: number;
  payDate: string;
  recurrence: "once" | "biweekly" | "monthly";
}

export interface PlannedExpense {
  id: string;
  name: string;
  amount: number;
  date: string;
  recurrence: Recurrence;
  kind: ExpenseKind;
  paymentSource: "cash" | "credit";
  creditAccountId?: string;
}

export interface CreditAccount {
  id: string;
  name: string;
  currentBalance: number;
  statementBalance: number;
  minimumDue: number;
  plannedPayment: number;
  apr: number;
  paymentDate: string;
  statementCloseDate: string;
}

export interface LoanPlan {
  id: string;
  name: string;
  totalBalance: number;
  monthlyPayment: number;
  apr: number;
  nextPaymentDate: string;
}

export interface LargeExpense {
  id: string;
  name: string;
  amount: number;
  date: string;
}

export interface FinancialGoal {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  targetDate: string;
  monthlyContribution: number;
  nextContributionDate: string;
}

export interface FinancialState {
  version: 1;
  currentBalance: number;
  balanceUpdatedAt: string;
  forecastMonths: number;
  paychecks: PaycheckPlan[];
  expenses: PlannedExpense[];
  creditAccounts: CreditAccount[];
  loans: LoanPlan[];
  largeExpenses: LargeExpense[];
  goals: FinancialGoal[];
}

export interface FinancialEvent {
  id: string;
  sourceId: string;
  date: string;
  name: string;
  amount: number;
  type: "income" | "expense" | "credit" | "loan" | "large" | "goal" | "scenario";
  kind?: ExpenseKind;
  liabilityAmount?: number;
  accountId?: string;
}

export interface ProjectionPoint {
  date: string;
  label: string;
  balance: number;
  inflow: number;
  outflow: number;
  cumulativeSpend: number;
}

export interface MonthlySnapshot {
  month: string;
  label: string;
  endingBalance: number;
  inflow: number;
  outflow: number;
}

export interface ProjectionResult {
  events: FinancialEvent[];
  dailyPoints: ProjectionPoint[];
  monthlySnapshots: MonthlySnapshot[];
  remainingIncome: number;
  committedOutflow: number;
  projectedMonthEnd: number;
  minimumBalance: number;
  safeDailySpend: number;
  daysRemaining: number;
  healthScore: number;
  liquidityScore: number;
  sustainabilityScore: number;
  debtPressureScore: number;
}

export interface MonthProjection {
  month: string;
  monthLabel: string;
  openingBalance: number;
  projectedMonthEnd: number;
  remainingIncome: number;
  committedOutflow: number;
  minimumBalance: number;
  dailyPoints: ProjectionPoint[];
  events: FinancialEvent[];
}

export interface ScenarioAdjustments {
  additionalShifts: number;
  additionalIncome: number;
  oneTimePurchase: number;
  monthlySpendingChange: number;
  extraDebtPayment: number;
}

const DAY_MS = 86_400_000;

export function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function toDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDate(value: string): Date {
  const parsed = value ? new Date(`${value}T12:00:00`) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 12);
}

function addMonths(date: Date, count: number): Date {
  const day = date.getDate();
  const result = new Date(date.getFullYear(), date.getMonth() + count, 1, 12);
  result.setDate(Math.min(day, endOfMonth(result).getDate()));
  return result;
}

function addRecurrence(date: Date, recurrence: Recurrence): Date | null {
  if (recurrence === "once") return null;
  if (recurrence === "weekly") return new Date(date.getTime() + DAY_MS * 7);
  if (recurrence === "biweekly") return new Date(date.getTime() + DAY_MS * 14);
  if (recurrence === "annual") return addMonths(date, 12);
  return addMonths(date, 1);
}

function clampScore(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)));
}

function occurrences(
  initialDate: string,
  recurrence: Recurrence,
  from: Date,
  through: Date,
): string[] {
  if (!initialDate) return [];
  const output: string[] = [];
  let cursor = parseDate(initialDate);
  let guard = 0;

  while (cursor < from && recurrence !== "once" && guard < 500) {
    const next = addRecurrence(cursor, recurrence);
    if (!next) break;
    cursor = next;
    guard += 1;
  }

  while (cursor <= through && guard < 700) {
    if (cursor >= from) output.push(toDateInput(cursor));
    const next = addRecurrence(cursor, recurrence);
    if (!next) break;
    cursor = next;
    guard += 1;
  }
  return output;
}

export function estimateNetPay(plan: PaycheckPlan, extraShifts = 0): number {
  const shifts = Math.max(0, plan.shiftsWorked + extraShifts);
  const regular = shifts * Math.max(0, plan.hoursPerShift) * Math.max(0, plan.hourlyRate);
  const overtime = Math.max(0, plan.overtimeHours) * Math.max(0, plan.hourlyRate) * Math.max(1, plan.overtimeMultiplier || 1.5);
  const differential = shifts * Math.max(0, plan.differentialPerShift);
  const gross = regular + overtime + differential;
  const taxes = gross * Math.max(0, Math.min(100, plan.taxRate)) / 100;
  return Math.max(0, gross - taxes - Math.max(0, plan.fixedDeductions));
}

export function createDefaultFinancialState(today = new Date()): FinancialState {
  const payDate = new Date(today.getFullYear(), today.getMonth(), Math.min(today.getDate() + 7, endOfMonth(today).getDate()), 12);
  return {
    version: 1,
    currentBalance: 0,
    balanceUpdatedAt: new Date().toISOString(),
    forecastMonths: 6,
    paychecks: [{
      id: makeId("pay"),
      name: "Primary paycheck",
      hourlyRate: 0,
      hoursPerShift: 12,
      shiftsWorked: 0,
      overtimeHours: 0,
      overtimeMultiplier: 1.5,
      differentialPerShift: 0,
      taxRate: 20,
      fixedDeductions: 0,
      payDate: toDateInput(payDate),
      recurrence: "biweekly",
    }],
    expenses: [],
    creditAccounts: [],
    loans: [],
    largeExpenses: [],
    goals: [],
  };
}

function buildEvents(state: FinancialState, from: Date, through: Date): FinancialEvent[] {
  const events: FinancialEvent[] = [];

  state.paychecks.forEach(plan => {
    occurrences(plan.payDate, plan.recurrence, from, through).forEach((date, index) => {
      events.push({
        id: `${plan.id}-${date}-${index}`,
        sourceId: plan.id,
        date,
        name: plan.name,
        amount: estimateNetPay(plan),
        type: "income",
      });
    });
  });

  state.expenses.forEach(expense => {
    occurrences(expense.date, expense.recurrence, from, through).forEach((date, index) => {
      events.push({
        id: `${expense.id}-${date}-${index}`,
        sourceId: expense.id,
        date,
        name: expense.paymentSource === "credit" ? `${expense.name} · credit charge` : expense.name,
        amount: expense.paymentSource === "credit" ? 0 : -Math.abs(expense.amount),
        type: expense.paymentSource === "credit" ? "credit" : "expense",
        kind: expense.kind,
        liabilityAmount: expense.paymentSource === "credit" ? Math.abs(expense.amount) : undefined,
        accountId: expense.creditAccountId,
      });
    });
  });

  state.creditAccounts.forEach(account => {
    if (account.plannedPayment <= 0 || !account.paymentDate) return;
    let remaining = Math.max(0, account.currentBalance);
    const futureCharges = events
      .filter(event => event.type === "credit" && event.accountId === account.id && (event.liabilityAmount ?? 0) > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    let appliedChargeIndex = 0;
    occurrences(account.paymentDate, "monthly", from, through).forEach((date, index) => {
      while (appliedChargeIndex < futureCharges.length && futureCharges[appliedChargeIndex].date <= date) {
        remaining += futureCharges[appliedChargeIndex].liabilityAmount ?? 0;
        appliedChargeIndex += 1;
      }
      const payment = Math.min(Math.abs(account.plannedPayment), remaining);
      remaining = Math.max(0, remaining - payment);
      if (payment <= 0) return;
      events.push({
        id: `${account.id}-${date}-${index}`,
        sourceId: account.id,
        date,
        name: `${account.name} payment`,
        amount: -payment,
        type: "credit",
        accountId: account.id,
      });
    });
  });

  state.loans.forEach(loan => {
    let remaining = Math.max(0, loan.totalBalance);
    occurrences(loan.nextPaymentDate, "monthly", from, through).forEach((date, index) => {
      const payment = Math.min(Math.abs(loan.monthlyPayment), remaining);
      remaining = Math.max(0, remaining - payment);
      if (payment <= 0) return;
      events.push({
        id: `${loan.id}-${date}-${index}`,
        sourceId: loan.id,
        date,
        name: `${loan.name} payment`,
        amount: -payment,
        type: "loan",
      });
    });
  });

  state.largeExpenses.forEach(expense => {
    occurrences(expense.date, "once", from, through).forEach(date => {
      events.push({
        id: `${expense.id}-${date}`,
        sourceId: expense.id,
        date,
        name: expense.name,
        amount: -Math.abs(expense.amount),
        type: "large",
      });
    });
  });

  state.goals.forEach(goal => {
    if (goal.monthlyContribution <= 0 || !goal.nextContributionDate) return;
    let remaining = Math.max(0, goal.targetAmount - goal.currentAmount);
    occurrences(goal.nextContributionDate, "monthly", from, through).forEach((date, index) => {
      const contribution = Math.min(Math.abs(goal.monthlyContribution), remaining);
      remaining = Math.max(0, remaining - contribution);
      if (contribution <= 0) return;
      events.push({
        id: `${goal.id}-${date}-${index}`,
        sourceId: goal.id,
        date,
        name: `${goal.name} contribution`,
        amount: -contribution,
        type: "goal",
      });
    });
  });

  return events.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
}

function scenarioEvents(
  state: FinancialState,
  adjustments: ScenarioAdjustments | undefined,
  from: Date,
  monthEnd: Date,
): FinancialEvent[] {
  if (!adjustments) return [];
  const output: FinancialEvent[] = [];
  const nextPaycheck = state.paychecks
    .map(plan => ({ plan, date: parseDate(plan.payDate) }))
    .filter(item => item.date >= from && item.date <= monthEnd)
    .sort((a, b) => a.date.getTime() - b.date.getTime())[0];
  const scenarioDate = toDateInput(nextPaycheck?.date ?? monthEnd);

  if (adjustments.additionalShifts > 0) {
    const plan = nextPaycheck?.plan ?? state.paychecks[0];
    const value = plan ? estimateNetPay(plan, adjustments.additionalShifts) - estimateNetPay(plan) : 0;
    if (value > 0) output.push({
      id: "scenario-shifts", sourceId: "scenario", date: scenarioDate,
      name: `${adjustments.additionalShifts} additional shift${adjustments.additionalShifts === 1 ? "" : "s"}`,
      amount: value, type: "scenario",
    });
  }
  if (adjustments.additionalIncome > 0) output.push({
    id: "scenario-income", sourceId: "scenario", date: scenarioDate,
    name: "Additional income", amount: adjustments.additionalIncome, type: "scenario",
  });
  if (adjustments.oneTimePurchase > 0) output.push({
    id: "scenario-purchase", sourceId: "scenario", date: toDateInput(from),
    name: "Hypothetical purchase", amount: -adjustments.oneTimePurchase, type: "scenario",
  });
  if (adjustments.monthlySpendingChange !== 0) output.push({
    id: "scenario-spending", sourceId: "scenario", date: toDateInput(monthEnd),
    name: adjustments.monthlySpendingChange > 0 ? "Additional monthly spending" : "Monthly spending reduction",
    amount: -adjustments.monthlySpendingChange, type: "scenario",
  });
  if (adjustments.extraDebtPayment > 0) output.push({
    id: "scenario-debt", sourceId: "scenario", date: toDateInput(monthEnd),
    name: "Extra debt payment", amount: -adjustments.extraDebtPayment, type: "scenario",
  });
  return output;
}

export function projectFinancialMonth(
  state: FinancialState,
  monthOffset: number,
  options?: { today?: Date },
): MonthProjection {
  const today = startOfDay(options?.today ?? new Date());
  const offset = Math.max(0, Math.floor(monthOffset));
  const currentMonth = new Date(today.getFullYear(), today.getMonth(), 1, 12);
  const selectedMonth = addMonths(currentMonth, offset);
  const periodStart = offset === 0
    ? today
    : new Date(selectedMonth.getFullYear(), selectedMonth.getMonth(), 1, 12);
  const periodEnd = endOfMonth(selectedMonth);
  const events = buildEvents(state, today, periodEnd);
  const openingBalance = state.currentBalance + events
    .filter(event => parseDate(event.date) < periodStart)
    .reduce((sum, event) => sum + event.amount, 0);
  const monthEvents = events.filter(event => {
    const date = parseDate(event.date);
    return date >= periodStart && date <= periodEnd;
  });
  const remainingIncome = monthEvents
    .filter(event => event.amount > 0)
    .reduce((sum, event) => sum + event.amount, 0);
  const committedOutflow = Math.abs(monthEvents
    .filter(event => event.amount < 0)
    .reduce((sum, event) => sum + event.amount, 0));

  const dailyPoints: ProjectionPoint[] = [];
  let runningBalance = openingBalance;
  let cumulativeSpend = 0;
  let minimumBalance = openingBalance;
  for (let cursor = new Date(periodStart); cursor <= periodEnd; cursor = new Date(cursor.getTime() + DAY_MS)) {
    const iso = toDateInput(cursor);
    const dayEvents = monthEvents.filter(event => event.date === iso);
    const inflow = dayEvents.filter(event => event.amount > 0).reduce((sum, event) => sum + event.amount, 0);
    const outflow = Math.abs(dayEvents.filter(event => event.amount < 0).reduce((sum, event) => sum + event.amount, 0));
    runningBalance += inflow - outflow;
    cumulativeSpend += outflow;
    minimumBalance = Math.min(minimumBalance, runningBalance);
    dailyPoints.push({
      date: iso,
      label: cursor.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      balance: runningBalance,
      inflow,
      outflow,
      cumulativeSpend,
    });
  }

  return {
    month: `${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth() + 1).padStart(2, "0")}`,
    monthLabel: selectedMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    openingBalance,
    projectedMonthEnd: runningBalance,
    remainingIncome,
    committedOutflow,
    minimumBalance,
    dailyPoints,
    events: monthEvents,
  };
}

export function projectFinancials(
  state: FinancialState,
  options?: { today?: Date; scenario?: ScenarioAdjustments },
): ProjectionResult {
  const today = startOfDay(options?.today ?? new Date());
  const monthEnd = endOfMonth(today);
  const horizonEnd = endOfMonth(addMonths(today, Math.max(1, state.forecastMonths) - 1));
  const baseEvents = buildEvents(state, today, horizonEnd);
  const syntheticEvents = scenarioEvents(state, options?.scenario, today, monthEnd);
  const events = [...baseEvents, ...syntheticEvents]
    .filter(event => parseDate(event.date) <= horizonEnd)
    .sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);

  const monthEvents = events.filter(event => parseDate(event.date) <= monthEnd);
  const remainingIncome = monthEvents.filter(event => event.amount > 0).reduce((sum, event) => sum + event.amount, 0);
  const committedOutflow = Math.abs(monthEvents.filter(event => event.amount < 0).reduce((sum, event) => sum + event.amount, 0));
  const projectedMonthEnd = state.currentBalance + remainingIncome - committedOutflow;
  const daysRemaining = Math.max(1, Math.round((monthEnd.getTime() - today.getTime()) / DAY_MS) + 1);
  const safeDailySpend = projectedMonthEnd / daysRemaining;

  const dailyPoints: ProjectionPoint[] = [];
  let runningBalance = state.currentBalance;
  let cumulativeSpend = 0;
  let minimumBalance = state.currentBalance;
  for (let cursor = new Date(today); cursor <= monthEnd; cursor = new Date(cursor.getTime() + DAY_MS)) {
    const iso = toDateInput(cursor);
    const dayEvents = monthEvents.filter(event => event.date === iso);
    const inflow = dayEvents.filter(event => event.amount > 0).reduce((sum, event) => sum + event.amount, 0);
    const outflow = Math.abs(dayEvents.filter(event => event.amount < 0).reduce((sum, event) => sum + event.amount, 0));
    runningBalance += inflow - outflow;
    cumulativeSpend += outflow;
    minimumBalance = Math.min(minimumBalance, runningBalance);
    dailyPoints.push({
      date: iso,
      label: cursor.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      balance: runningBalance,
      inflow,
      outflow,
      cumulativeSpend,
    });
  }

  const monthlySnapshots: MonthlySnapshot[] = [];
  let monthlyBalance = state.currentBalance;
  for (let index = 0; index < Math.max(1, state.forecastMonths); index += 1) {
    const monthDate = addMonths(today, index);
    const monthStart = index === 0 ? today : new Date(monthDate.getFullYear(), monthDate.getMonth(), 1, 12);
    const monthFinish = endOfMonth(monthDate);
    const currentEvents = events.filter(event => {
      const date = parseDate(event.date);
      return date >= monthStart && date <= monthFinish;
    });
    const inflow = currentEvents.filter(event => event.amount > 0).reduce((sum, event) => sum + event.amount, 0);
    const outflow = Math.abs(currentEvents.filter(event => event.amount < 0).reduce((sum, event) => sum + event.amount, 0));
    monthlyBalance += inflow - outflow;
    monthlySnapshots.push({
      month: `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`,
      label: monthDate.toLocaleDateString(undefined, { month: "short" }),
      endingBalance: monthlyBalance,
      inflow,
      outflow,
    });
  }

  const monthlyDebt = state.loans.reduce((sum, loan) => sum + Math.max(0, loan.monthlyPayment), 0)
    + state.creditAccounts.reduce((sum, account) => sum + Math.max(0, account.plannedPayment || account.minimumDue), 0);
  const hasFinancialData = state.currentBalance !== 0
    || remainingIncome > 0
    || committedOutflow > 0
    || events.some(event => (event.liabilityAmount ?? 0) > 0)
    || state.loans.some(loan => loan.totalBalance > 0)
    || state.creditAccounts.some(account => account.currentBalance > 0 || account.statementBalance > 0);
  const liquidityScore = !hasFinancialData ? 0 : projectedMonthEnd < 0
    ? clampScore(50 + projectedMonthEnd / Math.max(1, committedOutflow) * 50)
    : clampScore(55 + projectedMonthEnd / Math.max(1, committedOutflow) * 45);
  const sustainabilityScore = !hasFinancialData ? 0 : committedOutflow === 0
    ? (remainingIncome > 0 || state.currentBalance >= 0 ? 100 : 0)
    : clampScore((remainingIncome / committedOutflow) * 70 + (projectedMonthEnd >= 0 ? 20 : 0));
  const debtPressureScore = !hasFinancialData ? 0 : monthlyDebt === 0
    ? 100
    : remainingIncome <= 0
      ? 10
      : clampScore(100 - (monthlyDebt / remainingIncome) * 140);
  const healthScore = clampScore(liquidityScore * 0.45 + sustainabilityScore * 0.35 + debtPressureScore * 0.20);

  return {
    events,
    dailyPoints,
    monthlySnapshots,
    remainingIncome,
    committedOutflow,
    projectedMonthEnd,
    minimumBalance,
    safeDailySpend,
    daysRemaining,
    healthScore,
    liquidityScore,
    sustainabilityScore,
    debtPressureScore,
  };
}
