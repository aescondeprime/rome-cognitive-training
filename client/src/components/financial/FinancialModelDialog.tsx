import type { ReactNode } from "react";
import { CalendarDays, CircleDollarSign, CreditCard, Plus, Trash2, TrendingUp, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  makeId,
  toDateInput,
  type ExpenseKind,
  type FinancialState,
  type Recurrence,
} from "@/lib/financialEngine";

interface Props {
  state: FinancialState;
  onChange: (state: FinancialState) => void;
  trigger?: ReactNode;
}

const inputClass = "h-9 border-white/10 bg-black/20 font-mono text-xs";
const labelClass = "text-[9px] uppercase tracking-[0.14em] text-muted-foreground";

function money(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label className={labelClass}>{label}</Label>
      {children}
    </div>
  );
}

function Section({
  icon,
  title,
  description,
  action,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg border border-[hsl(var(--accent-h)_55%_40%/0.25)] bg-[hsl(var(--accent-h)_50%_30%/0.08)] p-2 text-[hsl(var(--accent-h)_70%_62%)]">
            {icon}
          </div>
          <div>
            <h3 className="font-roman text-sm text-foreground">{title}</h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function NativeSelect({ value, onChange, children }: { value: string; onChange: (value: string) => void; children: ReactNode }) {
  return (
    <select
      value={value}
      onChange={event => onChange(event.target.value)}
      className={`${inputClass} w-full rounded-md px-3 text-foreground outline-none focus:ring-1 focus:ring-[hsl(var(--accent-h)_70%_50%/0.5)]`}
    >
      {children}
    </select>
  );
}

export default function FinancialModelDialog({ state, onChange, trigger }: Props) {
  const updatePaycheck = (id: string, patch: Partial<FinancialState["paychecks"][number]>) => {
    onChange({ ...state, paychecks: state.paychecks.map(item => item.id === id ? { ...item, ...patch } : item) });
  };
  const updateExpense = (id: string, patch: Partial<FinancialState["expenses"][number]>) => {
    onChange({ ...state, expenses: state.expenses.map(item => item.id === id ? { ...item, ...patch } : item) });
  };
  const updateCredit = (id: string, patch: Partial<FinancialState["creditAccounts"][number]>) => {
    onChange({ ...state, creditAccounts: state.creditAccounts.map(item => item.id === id ? { ...item, ...patch } : item) });
  };
  const updateLoan = (id: string, patch: Partial<FinancialState["loans"][number]>) => {
    onChange({ ...state, loans: state.loans.map(item => item.id === id ? { ...item, ...patch } : item) });
  };
  const updateLarge = (id: string, patch: Partial<FinancialState["largeExpenses"][number]>) => {
    onChange({ ...state, largeExpenses: state.largeExpenses.map(item => item.id === id ? { ...item, ...patch } : item) });
  };
  const updateGoal = (id: string, patch: Partial<FinancialState["goals"][number]>) => {
    onChange({ ...state, goals: state.goals.map(item => item.id === id ? { ...item, ...patch } : item) });
  };

  const today = toDateInput(new Date());

  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger ?? <Button variant="outline">Manage inputs</Button>}
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] max-w-5xl overflow-hidden border-white/10 bg-[hsl(222_18%_7%)] p-0">
        <DialogHeader className="border-b border-white/[0.07] px-6 pb-4 pt-6">
          <DialogTitle className="font-roman text-lg tracking-[0.08em]">Financial model</DialogTitle>
          <DialogDescription>
            Update the numbers ROME uses to calculate cash projection and daily spending.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="income" className="flex min-h-0 flex-1 flex-col">
          <div className="px-6 pt-4">
            <TabsList className="grid h-auto w-full grid-cols-4 bg-black/20 p-1">
              <TabsTrigger value="income" className="text-[10px] uppercase tracking-wider">Income</TabsTrigger>
              <TabsTrigger value="spending" className="text-[10px] uppercase tracking-wider">Spending</TabsTrigger>
              <TabsTrigger value="debt" className="text-[10px] uppercase tracking-wider">Debt</TabsTrigger>
              <TabsTrigger value="goals" className="text-[10px] uppercase tracking-wider">Goals</TabsTrigger>
            </TabsList>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
            <TabsContent value="income" className="space-y-4 pt-3">
              <Section
                icon={<TrendingUp className="h-4 w-4" />}
                title="Paycheck plans"
                description="Net pay accounts for shifts, hourly rate, differential, deductions, and taxes."
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-[10px]"
                    onClick={() => onChange({
                      ...state,
                      paychecks: [...state.paychecks, {
                        id: makeId("pay"), name: "New paycheck", hourlyRate: 0, hoursPerShift: 12,
                        shiftsWorked: 0, overtimeHours: 0, overtimeMultiplier: 1.5,
                        differentialPerShift: 0, taxRate: 20, fixedDeductions: 0,
                        payDate: today, recurrence: "biweekly",
                      }],
                    })}
                  >
                    <Plus className="mr-1 h-3 w-3" /> Add paycheck
                  </Button>
                }
              >
                <div className="space-y-3">
                  {state.paychecks.map(plan => (
                    <div key={plan.id} className="rounded-lg border border-white/[0.06] bg-black/15 p-3">
                      <div className="grid gap-3 md:grid-cols-12">
                        <Field label="Name" className="md:col-span-3">
                          <Input className={inputClass} value={plan.name} onChange={event => updatePaycheck(plan.id, { name: event.target.value })} />
                        </Field>
                        <Field label="Hourly rate" className="md:col-span-2">
                          <Input className={inputClass} type="number" min="0" step="0.01" value={plan.hourlyRate} onChange={event => updatePaycheck(plan.id, { hourlyRate: money(event.target.value) })} />
                        </Field>
                        <Field label="Hours / shift" className="md:col-span-2">
                          <Input className={inputClass} type="number" min="0" step="0.5" value={plan.hoursPerShift} onChange={event => updatePaycheck(plan.id, { hoursPerShift: money(event.target.value) })} />
                        </Field>
                        <Field label="Shifts worked" className="md:col-span-2">
                          <div className="flex">
                            <Button type="button" variant="outline" className="h-9 rounded-r-none px-3" onClick={() => updatePaycheck(plan.id, { shiftsWorked: Math.max(0, plan.shiftsWorked - 1) })}>−</Button>
                            <Input className={`${inputClass} rounded-none text-center`} type="number" min="0" step="1" value={plan.shiftsWorked} onChange={event => updatePaycheck(plan.id, { shiftsWorked: Math.floor(money(event.target.value)) })} />
                            <Button type="button" variant="outline" className="h-9 rounded-l-none px-3" onClick={() => updatePaycheck(plan.id, { shiftsWorked: plan.shiftsWorked + 1 })}>+</Button>
                          </div>
                        </Field>
                        <Field label="Tax estimate %" className="md:col-span-2">
                          <Input className={inputClass} type="number" min="0" max="100" step="0.1" value={plan.taxRate} onChange={event => updatePaycheck(plan.id, { taxRate: money(event.target.value) })} />
                        </Field>
                        <div className="flex items-end justify-end md:col-span-1">
                          <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-red-400" disabled={state.paychecks.length === 1} onClick={() => onChange({ ...state, paychecks: state.paychecks.filter(item => item.id !== plan.id) })}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-3 border-t border-white/[0.05] pt-3 md:grid-cols-5">
                        <Field label="Pay date">
                          <Input className={inputClass} type="date" value={plan.payDate} onChange={event => updatePaycheck(plan.id, { payDate: event.target.value })} />
                        </Field>
                        <Field label="Repeats">
                          <NativeSelect value={plan.recurrence} onChange={value => updatePaycheck(plan.id, { recurrence: value as "once" | "biweekly" | "monthly" })}>
                            <option value="once">Once</option><option value="biweekly">Every 2 weeks</option><option value="monthly">Monthly</option>
                          </NativeSelect>
                        </Field>
                        <Field label="Differential / shift">
                          <Input className={inputClass} type="number" min="0" step="0.01" value={plan.differentialPerShift} onChange={event => updatePaycheck(plan.id, { differentialPerShift: money(event.target.value) })} />
                        </Field>
                        <Field label="Overtime hours">
                          <Input className={inputClass} type="number" min="0" step="0.5" value={plan.overtimeHours} onChange={event => updatePaycheck(plan.id, { overtimeHours: money(event.target.value) })} />
                        </Field>
                        <Field label="Fixed deductions">
                          <Input className={inputClass} type="number" min="0" step="0.01" value={plan.fixedDeductions} onChange={event => updatePaycheck(plan.id, { fixedDeductions: money(event.target.value) })} />
                        </Field>
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            </TabsContent>

            <TabsContent value="spending" className="space-y-4 pt-3">
              <Section
                icon={<WalletCards className="h-4 w-4" />}
                title="Planned spending"
                description="Subscriptions, memberships, recurring bills, and discretionary plans are scheduled by date."
                action={
                  <Button size="sm" variant="outline" className="h-8 text-[10px]" onClick={() => onChange({
                    ...state,
                    expenses: [...state.expenses, { id: makeId("expense"), name: "New expense", amount: 0, date: today, recurrence: "monthly", kind: "recurring", paymentSource: "cash" }],
                  })}>
                    <Plus className="mr-1 h-3 w-3" /> Add spending
                  </Button>
                }
              >
                <div className="space-y-2">
                  {state.expenses.length === 0 && <p className="rounded-lg border border-dashed border-white/10 p-5 text-center text-xs text-muted-foreground">No planned spending yet.</p>}
                  {state.expenses.map(expense => (
                    <div key={expense.id} className="grid gap-2 rounded-lg border border-white/[0.06] bg-black/15 p-3 md:grid-cols-[1.4fr_1fr_1fr_1fr_1fr_1fr_auto]">
                      <Field label="Name"><Input className={inputClass} value={expense.name} onChange={event => updateExpense(expense.id, { name: event.target.value })} /></Field>
                      <Field label="Type">
                        <NativeSelect value={expense.kind} onChange={value => updateExpense(expense.id, { kind: value as ExpenseKind })}>
                          <option value="subscription">Subscription</option><option value="membership">Membership</option><option value="recurring">Recurring bill</option><option value="discretionary">Discretionary</option>
                        </NativeSelect>
                      </Field>
                      <Field label="Amount"><Input className={inputClass} type="number" min="0" step="0.01" value={expense.amount} onChange={event => updateExpense(expense.id, { amount: money(event.target.value) })} /></Field>
                      <Field label="Next date"><Input className={inputClass} type="date" value={expense.date} onChange={event => updateExpense(expense.id, { date: event.target.value })} /></Field>
                      <Field label="Repeats">
                        <NativeSelect value={expense.recurrence} onChange={value => updateExpense(expense.id, { recurrence: value as Recurrence })}>
                          <option value="once">Once</option><option value="weekly">Weekly</option><option value="biweekly">Every 2 weeks</option><option value="monthly">Monthly</option><option value="annual">Annual</option>
                        </NativeSelect>
                      </Field>
                      <Field label="Paid from">
                        <NativeSelect
                          value={expense.paymentSource === "credit" ? `credit:${expense.creditAccountId ?? ""}` : "cash"}
                          onChange={value => {
                            if (value === "cash") updateExpense(expense.id, { paymentSource: "cash", creditAccountId: undefined });
                            else updateExpense(expense.id, { paymentSource: "credit", creditAccountId: value.replace("credit:", "") || undefined });
                          }}
                        >
                          <option value="cash">Cash / checking</option>
                          {state.creditAccounts.length === 0 && <option value="credit:">Credit card</option>}
                          {state.creditAccounts.map(account => <option key={account.id} value={`credit:${account.id}`}>{account.name}</option>)}
                        </NativeSelect>
                      </Field>
                      <div className="flex items-end"><Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-red-400" onClick={() => onChange({ ...state, expenses: state.expenses.filter(item => item.id !== expense.id) })}><Trash2 className="h-3.5 w-3.5" /></Button></div>
                    </div>
                  ))}
                </div>
              </Section>

              <Section
                icon={<CalendarDays className="h-4 w-4" />}
                title="Large one-time expenses"
                description="Dated purchases immediately change the projected balance and safe daily spending."
                action={
                  <Button size="sm" variant="outline" className="h-8 text-[10px]" onClick={() => onChange({
                    ...state,
                    largeExpenses: [...state.largeExpenses, { id: makeId("large"), name: "Planned purchase", amount: 0, date: today }],
                  })}>
                    <Plus className="mr-1 h-3 w-3" /> Add large expense
                  </Button>
                }
              >
                <div className="space-y-2">
                  {state.largeExpenses.length === 0 && <p className="rounded-lg border border-dashed border-white/10 p-5 text-center text-xs text-muted-foreground">No large expenses planned.</p>}
                  {state.largeExpenses.map(expense => (
                    <div key={expense.id} className="grid gap-2 rounded-lg border border-white/[0.06] bg-black/15 p-3 md:grid-cols-[2fr_1fr_1fr_auto]">
                      <Field label="Expense"><Input className={inputClass} value={expense.name} onChange={event => updateLarge(expense.id, { name: event.target.value })} /></Field>
                      <Field label="Amount"><Input className={inputClass} type="number" min="0" step="0.01" value={expense.amount} onChange={event => updateLarge(expense.id, { amount: money(event.target.value) })} /></Field>
                      <Field label="Date"><Input className={inputClass} type="date" value={expense.date} onChange={event => updateLarge(expense.id, { date: event.target.value })} /></Field>
                      <div className="flex items-end"><Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-red-400" onClick={() => onChange({ ...state, largeExpenses: state.largeExpenses.filter(item => item.id !== expense.id) })}><Trash2 className="h-3.5 w-3.5" /></Button></div>
                    </div>
                  ))}
                </div>
              </Section>
            </TabsContent>

            <TabsContent value="debt" className="space-y-4 pt-3">
              <Section
                icon={<CreditCard className="h-4 w-4" />}
                title="Credit cards"
                description="Statement balance, current balance, and the planned cash payment remain separate to prevent double counting."
                action={
                  <Button size="sm" variant="outline" className="h-8 text-[10px]" onClick={() => onChange({
                    ...state,
                    creditAccounts: [...state.creditAccounts, {
                      id: makeId("card"), name: "New card", currentBalance: 0, statementBalance: 0,
                      minimumDue: 0, plannedPayment: 0, apr: 0, paymentDate: today, statementCloseDate: today,
                    }],
                  })}>
                    <Plus className="mr-1 h-3 w-3" /> Add card
                  </Button>
                }
              >
                <div className="space-y-2">
                  {state.creditAccounts.length === 0 && <p className="rounded-lg border border-dashed border-white/10 p-5 text-center text-xs text-muted-foreground">No credit cards entered.</p>}
                  {state.creditAccounts.map(account => (
                    <div key={account.id} className="grid gap-2 rounded-lg border border-white/[0.06] bg-black/15 p-3 md:grid-cols-4">
                      <Field label="Card" className="md:col-span-2"><Input className={inputClass} value={account.name} onChange={event => updateCredit(account.id, { name: event.target.value })} /></Field>
                      <Field label="Current balance"><Input className={inputClass} type="number" min="0" step="0.01" value={account.currentBalance} onChange={event => updateCredit(account.id, { currentBalance: money(event.target.value) })} /></Field>
                      <Field label="Statement"><Input className={inputClass} type="number" min="0" step="0.01" value={account.statementBalance} onChange={event => updateCredit(account.id, { statementBalance: money(event.target.value) })} /></Field>
                      <Field label="Minimum due"><Input className={inputClass} type="number" min="0" step="0.01" value={account.minimumDue} onChange={event => updateCredit(account.id, { minimumDue: money(event.target.value) })} /></Field>
                      <Field label="Planned payment"><Input className={inputClass} type="number" min="0" step="0.01" value={account.plannedPayment} onChange={event => updateCredit(account.id, { plannedPayment: money(event.target.value) })} /></Field>
                      <Field label="APR %"><Input className={inputClass} type="number" min="0" step="0.01" value={account.apr} onChange={event => updateCredit(account.id, { apr: money(event.target.value) })} /></Field>
                      <Field label="Payment date"><Input className={inputClass} type="date" value={account.paymentDate} onChange={event => updateCredit(account.id, { paymentDate: event.target.value })} /></Field>
                      <Field label="Statement closes"><Input className={inputClass} type="date" value={account.statementCloseDate} onChange={event => updateCredit(account.id, { statementCloseDate: event.target.value })} /></Field>
                      <div className="flex items-end"><Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-red-400" onClick={() => onChange({ ...state, creditAccounts: state.creditAccounts.filter(item => item.id !== account.id) })}><Trash2 className="h-3.5 w-3.5" /></Button></div>
                    </div>
                  ))}
                </div>
              </Section>

              <Section
                icon={<CircleDollarSign className="h-4 w-4" />}
                title="Loans and debt payments"
                description="Track the total liability and the dated monthly payment separately."
                action={
                  <Button size="sm" variant="outline" className="h-8 text-[10px]" onClick={() => onChange({
                    ...state,
                    loans: [...state.loans, { id: makeId("loan"), name: "New loan", totalBalance: 0, monthlyPayment: 0, apr: 0, nextPaymentDate: today }],
                  })}>
                    <Plus className="mr-1 h-3 w-3" /> Add loan
                  </Button>
                }
              >
                <div className="space-y-2">
                  {state.loans.length === 0 && <p className="rounded-lg border border-dashed border-white/10 p-5 text-center text-xs text-muted-foreground">No loans entered.</p>}
                  {state.loans.map(loan => (
                    <div key={loan.id} className="grid gap-2 rounded-lg border border-white/[0.06] bg-black/15 p-3 md:grid-cols-[1.5fr_1fr_1fr_.8fr_1fr_auto]">
                      <Field label="Loan"><Input className={inputClass} value={loan.name} onChange={event => updateLoan(loan.id, { name: event.target.value })} /></Field>
                      <Field label="Total balance"><Input className={inputClass} type="number" min="0" step="0.01" value={loan.totalBalance} onChange={event => updateLoan(loan.id, { totalBalance: money(event.target.value) })} /></Field>
                      <Field label="Monthly payment"><Input className={inputClass} type="number" min="0" step="0.01" value={loan.monthlyPayment} onChange={event => updateLoan(loan.id, { monthlyPayment: money(event.target.value) })} /></Field>
                      <Field label="APR %"><Input className={inputClass} type="number" min="0" step="0.01" value={loan.apr} onChange={event => updateLoan(loan.id, { apr: money(event.target.value) })} /></Field>
                      <Field label="Next payment"><Input className={inputClass} type="date" value={loan.nextPaymentDate} onChange={event => updateLoan(loan.id, { nextPaymentDate: event.target.value })} /></Field>
                      <div className="flex items-end"><Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-red-400" onClick={() => onChange({ ...state, loans: state.loans.filter(item => item.id !== loan.id) })}><Trash2 className="h-3.5 w-3.5" /></Button></div>
                    </div>
                  ))}
                </div>
              </Section>
            </TabsContent>

            <TabsContent value="goals" className="space-y-4 pt-3">
              <Section
                icon={<CircleDollarSign className="h-4 w-4" />}
                title="Financial goals"
                description="Optional monthly contributions are included in the projection on their scheduled date."
                action={
                  <Button size="sm" variant="outline" className="h-8 text-[10px]" onClick={() => onChange({
                    ...state,
                    goals: [...state.goals, { id: makeId("goal"), name: "New goal", targetAmount: 0, currentAmount: 0, targetDate: today, monthlyContribution: 0, nextContributionDate: today }],
                  })}>
                    <Plus className="mr-1 h-3 w-3" /> Add goal
                  </Button>
                }
              >
                <div className="space-y-2">
                  {state.goals.length === 0 && <p className="rounded-lg border border-dashed border-white/10 p-5 text-center text-xs text-muted-foreground">No financial goals entered.</p>}
                  {state.goals.map(goal => (
                    <div key={goal.id} className="grid gap-2 rounded-lg border border-white/[0.06] bg-black/15 p-3 md:grid-cols-[1.5fr_1fr_1fr_1fr_1fr_1fr_auto]">
                      <Field label="Goal"><Input className={inputClass} value={goal.name} onChange={event => updateGoal(goal.id, { name: event.target.value })} /></Field>
                      <Field label="Target"><Input className={inputClass} type="number" min="0" step="0.01" value={goal.targetAmount} onChange={event => updateGoal(goal.id, { targetAmount: money(event.target.value) })} /></Field>
                      <Field label="Saved"><Input className={inputClass} type="number" min="0" step="0.01" value={goal.currentAmount} onChange={event => updateGoal(goal.id, { currentAmount: money(event.target.value) })} /></Field>
                      <Field label="Target date"><Input className={inputClass} type="date" value={goal.targetDate} onChange={event => updateGoal(goal.id, { targetDate: event.target.value })} /></Field>
                      <Field label="Monthly amount"><Input className={inputClass} type="number" min="0" step="0.01" value={goal.monthlyContribution} onChange={event => updateGoal(goal.id, { monthlyContribution: money(event.target.value) })} /></Field>
                      <Field label="Next contribution"><Input className={inputClass} type="date" value={goal.nextContributionDate} onChange={event => updateGoal(goal.id, { nextContributionDate: event.target.value })} /></Field>
                      <div className="flex items-end"><Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-red-400" onClick={() => onChange({ ...state, goals: state.goals.filter(item => item.id !== goal.id) })}><Trash2 className="h-3.5 w-3.5" /></Button></div>
                    </div>
                  ))}
                </div>
              </Section>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
