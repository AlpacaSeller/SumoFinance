// ── Budget dinamici per categoria ───────────────────────────────────────────
// Budget = media delle uscite degli ultimi 3 mesi (mese corrente escluso),
// con possibilità di override manuale per categoria.

import type { Expense } from "../types";
import { currentMonthKey, monthKey, shiftedMonthKey } from "../format";

export interface CategoryBudget {
  category: string;
  budget: number; // budget effettivo (base + eventuale rollover)
  baseBudget: number; // budget di base senza rollover
  rollover: number; // residuo del mese scorso riportato (0 se disattivo)
  isOverride: boolean;
  spent: number; // nel mese corrente
}

export function computeBudgets(
  expenses: Expense[],
  categories: string[],
  overrides: Record<string, number>,
  rolloverEnabled = false
): CategoryBudget[] {
  const prevKeys = [shiftedMonthKey(-1), shiftedMonthKey(-2), shiftedMonthKey(-3)];
  const prevKey = shiftedMonthKey(-1);
  const curKey = currentMonthKey();
  // mesi precedenti in cui esiste almeno una spesa (di qualunque categoria)
  const monthsWithData = prevKeys.filter((k) => expenses.some((e) => monthKey(e.date) === k));

  const cats = new Set<string>(categories);
  for (const e of expenses) cats.add(e.category);

  const result: CategoryBudget[] = [];
  for (const cat of cats) {
    const spent = expenses
      .filter((e) => e.category === cat && monthKey(e.date) === curKey)
      .reduce((s, e) => s + e.amount, 0);
    let baseBudget: number;
    let isOverride = false;
    if (overrides[cat] != null) {
      baseBudget = overrides[cat];
      isOverride = true;
    } else if (monthsWithData.length > 0) {
      const tot = monthsWithData.reduce(
        (s, k) =>
          s +
          expenses
            .filter((e) => e.category === cat && monthKey(e.date) === k)
            .reduce((x, e) => x + e.amount, 0),
        0
      );
      baseBudget = tot / monthsWithData.length;
    } else {
      // nessuno storico: il budget del primo mese è la spesa corrente
      baseBudget = spent;
    }
    // rollover: il non speso del mese scorso (rispetto al budget di base) si riporta
    let rollover = 0;
    if (rolloverEnabled && baseBudget > 0) {
      const spentPrev = expenses
        .filter((e) => e.category === cat && monthKey(e.date) === prevKey)
        .reduce((s, e) => s + e.amount, 0);
      rollover = Math.max(0, baseBudget - spentPrev);
    }
    const budget = baseBudget + rollover;
    if (budget > 0 || spent > 0 || categories.includes(cat)) {
      result.push({ category: cat, budget, baseBudget, rollover, isOverride, spent });
    }
  }
  return result.sort((a, b) => b.spent - a.spent || b.budget - a.budget);
}

export function totalBudget(budgets: CategoryBudget[]): number {
  return budgets.reduce((s, b) => s + b.budget, 0);
}
