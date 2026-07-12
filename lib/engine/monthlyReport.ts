// ── Report del mese concluso ────────────────────────────────────────────────
// Il "perché riaprire l'app ogni mese": riepilogo automatico dell'ultimo mese
// completo, calcolato dai dati come tutto il resto.

import type { FinancialData } from "../types";
import { monthKey, shiftedMonthKey } from "../format";
import { sumInMonth } from "./aggregates";

export interface MonthlyReport {
  key: string; // "YYYY-MM" del mese concluso
  income: number;
  expense: number;
  saved: number;
  savingsRate: number | null; // 0–1, null se entrate 0
  prevIncome: number;
  prevExpense: number;
  topCategory: { name: string; amount: number; sharePct: number } | null;
  biggestExpense: { description: string; amount: number } | null;
  /** categorie oltre la media dei 3 mesi precedenti (min +10% e +20 €) */
  overAverage: { category: string; spent: number; average: number }[];
  /** variazione del patrimonio netto nel mese, dagli snapshot */
  netDelta: { abs: number; pct: number } | null;
}

export function buildMonthlyReport(
  data: FinancialData,
  key: string = shiftedMonthKey(-1)
): MonthlyReport | null {
  const { incomes, expenses, snapshots } = data;
  const income = sumInMonth(incomes, key);
  const expense = sumInMonth(expenses, key);
  if (income === 0 && expense === 0) return null; // mese senza movimenti: niente report

  const prevKey = addMonthsToKey(key, -1);
  const monthExpenses = expenses.filter((e) => monthKey(e.date) === key);

  // top categoria
  const byCat = new Map<string, number>();
  for (const e of monthExpenses) byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount);
  const top = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];

  // spesa singola più grande
  const biggest = [...monthExpenses].sort((a, b) => b.amount - a.amount)[0];

  // categorie sopra la media dei 3 mesi precedenti il mese del report
  const prevKeys = [-1, -2, -3].map((d) => addMonthsToKey(key, d));
  const monthsWithData = prevKeys.filter((k) => expenses.some((e) => monthKey(e.date) === k));
  const overAverage: MonthlyReport["overAverage"] = [];
  if (monthsWithData.length > 0) {
    for (const [category, spent] of byCat) {
      const avg =
        monthsWithData.reduce(
          (s, k) =>
            s +
            expenses
              .filter((e) => e.category === category && monthKey(e.date) === k)
              .reduce((x, e) => x + e.amount, 0),
          0
        ) / monthsWithData.length;
      if (avg > 0 && spent > avg * 1.1 && spent - avg > 20) {
        overAverage.push({ category, spent, average: avg });
      }
    }
    overAverage.sort((a, b) => b.spent - b.average - (a.spent - a.average));
  }

  // delta patrimonio dagli snapshot: ultimo ≤ inizio mese vs ultimo nel mese
  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const startBound = `${key}-01`;
  const endBound = `${key}-31`;
  const before = sorted.filter((s) => s.date < startBound).pop();
  const inMonth = sorted.filter((s) => s.date >= startBound && s.date <= endBound).pop();
  let netDelta: MonthlyReport["netDelta"] = null;
  if (before && inMonth) {
    const abs = inMonth.netWorth - before.netWorth;
    netDelta = {
      abs,
      pct: before.netWorth !== 0 ? (abs / Math.abs(before.netWorth)) * 100 : 0,
    };
  }

  return {
    key,
    income,
    expense,
    saved: income - expense,
    savingsRate: income > 0 ? (income - expense) / income : null,
    prevIncome: sumInMonth(incomes, prevKey),
    prevExpense: sumInMonth(expenses, prevKey),
    topCategory: top
      ? { name: top[0], amount: top[1], sharePct: expense > 0 ? (top[1] / expense) * 100 : 0 }
      : null,
    biggestExpense: biggest
      ? { description: biggest.description, amount: biggest.amount }
      : null,
    overAverage: overAverage.slice(0, 3),
    netDelta,
  };
}

/** "YYYY-MM" spostata di delta mesi */
export function addMonthsToKey(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
