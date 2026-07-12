// ── Stato finanziario derivato ──────────────────────────────────────────────
// Un unico punto che trasforma i dati grezzi in tutte le metriche derivate.
// Deterministico e riproducibile: stessa base dati → stessi numeri ovunque.

import type { FinancialData } from "../types";
import {
  allocationByClass,
  autonomyYears,
  avgMonthlyExpense,
  avgSavingsRate,
  change30d,
  computeAggregates,
  coverageMonths,
  maxAssetWeight,
  passiveIncome12M,
  savingsRate,
  sumInMonth,
  todayCanSpend,
  type Aggregates,
} from "./aggregates";
import { computeBudgets, totalBudget, type CategoryBudget } from "./budget";
import { computeHealth, type HealthResult } from "./health";
import { fireTarget, portfolioParams } from "./montecarlo";
import { totalLatentTax } from "./tax";
import {
  allRealizedEvents,
  computeTaxFromTransactions,
  type TaxComputation,
} from "./transactions";
import { currentMonthKey, fmtNum, fmtPct } from "../format";
import { EXPENSE_CATEGORIES } from "../types";

export interface DerivedState {
  agg: Aggregates;
  avgExpense6m: number;
  savingsRateMonth: number; // mese corrente, 0–1
  avgSavingsRate3m: number; // 0–1
  budgets: CategoryBudget[];
  totalBudget: number;
  todayCanSpend: number;
  autonomyYears: number | null;
  coverageMonths: number | null;
  passive12M: number;
  change30d: { abs: number; pct: number } | null;
  health: HealthResult;
  portfolio: { mu: number; sigma: number };
  fireTarget: number | null;
  latentTax: number;
  /** fisco derivato dalle operazioni registrate in app */
  taxComputed: TaxComputation;
  /** realizzato anno corrente: operazioni in app + rettifiche manuali */
  realizedYear: { gains: number; losses: number };
  incomeMonth: number;
  expenseMonth: number;
  subscriptionsMonthly: number; // costo mensile normalizzato abbonamenti attivi
}

export function computeDerived(data: FinancialData): DerivedState {
  const {
    accounts,
    assets,
    assetTransactions,
    debts,
    incomes,
    expenses,
    settings,
    snapshots,
    subscriptions,
    taxState,
  } = data;
  const agg = computeAggregates(accounts, assets, debts);
  const avgExpense6m = avgMonthlyExpense(expenses, 6);
  const curKey = currentMonthKey();

  const expenseCategories = [
    ...EXPENSE_CATEGORIES,
    ...(settings.customExpenseCategories || []),
  ];
  const budgets = computeBudgets(
    expenses,
    expenseCategories,
    settings.budgetOverrides || {},
    settings.budgetRollover ?? false
  );
  const totBudget = totalBudget(budgets);

  const cov = coverageMonths(agg.liquidity, avgExpense6m);
  const rate3m = avgSavingsRate(incomes, expenses, 3);
  const alloc = allocationByClass(assets);
  const maxW = maxAssetWeight(assets, agg.gross);

  const health = computeHealth(
    {
      coverageMonths: cov,
      avgSavingsRate3m: rate3m,
      assetClassCount: alloc.size,
      debtToGross: agg.gross > 0 ? agg.debts / agg.gross : null,
      maxAssetWeightPct: maxW ? maxW.weight : null,
    },
    {
      months: (n) => `${fmtNum(n, 1)} mesi`,
      pct: (n) => fmtPct(n),
    }
  );

  const portfolio = portfolioParams(assets, agg.liquidity);

  const events = allRealizedEvents(assets, assetTransactions);
  const taxComputed = computeTaxFromTransactions(events, new Date().getFullYear());

  return {
    agg,
    avgExpense6m,
    savingsRateMonth: savingsRate(incomes, expenses, curKey),
    avgSavingsRate3m: rate3m,
    budgets,
    totalBudget: totBudget,
    todayCanSpend: todayCanSpend(totBudget, expenses),
    autonomyYears: autonomyYears(agg.liquidWealth, avgExpense6m),
    coverageMonths: cov,
    passive12M: passiveIncome12M(incomes, assets),
    change30d: change30d(snapshots, agg.netWorth),
    health,
    portfolio,
    fireTarget: fireTarget(avgExpense6m, settings.fireWithdrawalRate),
    latentTax: totalLatentTax(assets),
    taxComputed,
    realizedYear: {
      gains: taxComputed.currentYear.gains + taxState.realizedGainsYear,
      losses: taxComputed.currentYear.losses + taxState.realizedLossesYear,
    },
    incomeMonth: sumInMonth(incomes, curKey),
    expenseMonth: sumInMonth(expenses, curKey),
    subscriptionsMonthly: subscriptions
      .filter((s) => s.active)
      .reduce((s, x) => s + (x.cadence === "mensile" ? x.amount : x.amount / 12), 0),
  };
}
