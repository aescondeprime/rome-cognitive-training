import { createDefaultFinancialState, type FinancialState } from "./financialEngine";

const STORAGE_PREFIX = "rome-financial-v1";

function storageKey(profileId?: number | string): string {
  return `${STORAGE_PREFIX}:${profileId ?? "default"}`;
}

export function loadFinancialState(profileId?: number | string): FinancialState {
  if (typeof window === "undefined") return createDefaultFinancialState();
  try {
    const stored = window.localStorage.getItem(storageKey(profileId));
    if (!stored) return createDefaultFinancialState();
    const parsed = JSON.parse(stored) as Partial<FinancialState>;
    const fallback = createDefaultFinancialState();
    return {
      ...fallback,
      ...parsed,
      version: 1,
      paychecks: Array.isArray(parsed.paychecks) ? parsed.paychecks : fallback.paychecks,
      expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
      creditAccounts: Array.isArray(parsed.creditAccounts) ? parsed.creditAccounts : [],
      loans: Array.isArray(parsed.loans) ? parsed.loans : [],
      largeExpenses: Array.isArray(parsed.largeExpenses) ? parsed.largeExpenses : [],
      goals: Array.isArray(parsed.goals) ? parsed.goals : [],
    };
  } catch {
    return createDefaultFinancialState();
  }
}

export function saveFinancialState(state: FinancialState, profileId?: number | string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(profileId), JSON.stringify(state));
}
