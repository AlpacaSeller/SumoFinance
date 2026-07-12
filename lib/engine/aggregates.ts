// ── Aggregati patrimoniali e KPI (funzioni pure) ────────────────────────────

import {
  PASSIVE_INCOME_CATEGORIES,
  type Account,
  type Asset,
  type AssetClass,
  type Debt,
  type Expense,
  type Income,
  type Snapshot,
} from "../types";
import {
  currentMonthKey,
  daysLeftInMonth,
  monthKey,
  shiftedMonthKey,
  todayISO,
} from "../format";

/** Saldo del conto convertito in EUR (usa il cambio in cache; 1 se EUR o mancante). */
export function accountEurBalance(a: Account): number {
  if (!a.currency || a.currency === "EUR") return a.balance;
  return a.balance * (a.eurRate ?? 1);
}

export function liquidityTotal(accounts: Account[]): number {
  return accounts.reduce((s, a) => s + accountEurBalance(a), 0);
}

export function assetValue(a: Asset): number {
  return a.quantity * a.currentPrice;
}

export function assetCost(a: Asset): number {
  return a.quantity * a.avgCost;
}

export function investmentsTotal(assets: Asset[]): number {
  return assets.reduce((s, a) => s + assetValue(a), 0);
}

/** Investimenti esclusi gli Immobili (patrimonio "liquido") */
export function investmentsFinancial(assets: Asset[]): number {
  return assets
    .filter((a) => a.assetClass !== "Immobili")
    .reduce((s, a) => s + assetValue(a), 0);
}

export function debtsTotal(debts: Debt[]): number {
  return debts.reduce((s, d) => s + d.residual, 0);
}

export interface Aggregates {
  liquidity: number;
  investments: number;
  investmentsFinancial: number;
  gross: number;
  debts: number;
  netWorth: number;
  /** netto senza immobili (e senza i mutui a loro collegati) */
  netFinancial: number;
  hasRealEstate: boolean;
  /** patrimonio liquido usato per autonomia, FIRE e Monte Carlo */
  liquidWealth: number;
}

export function computeAggregates(
  accounts: Account[],
  assets: Asset[],
  debts: Debt[]
): Aggregates {
  const liquidity = liquidityTotal(accounts);
  const investments = investmentsTotal(assets);
  const invFin = investmentsFinancial(assets);
  const totalDebts = debtsTotal(debts);
  const gross = liquidity + investments;
  const realEstateIds = new Set(
    assets.filter((a) => a.assetClass === "Immobili").map((a) => a.id)
  );
  // Debiti non collegati a immobili (contano nel netto finanziario)
  const financialDebts = debts
    .filter((d) => !(d.linkedAssetId && realEstateIds.has(d.linkedAssetId)))
    .reduce((s, d) => s + d.residual, 0);
  return {
    liquidity,
    investments,
    investmentsFinancial: invFin,
    gross,
    debts: totalDebts,
    netWorth: gross - totalDebts,
    netFinancial: liquidity + invFin - financialDebts,
    hasRealEstate: realEstateIds.size > 0,
    liquidWealth: liquidity + invFin,
  };
}

// ── Flussi mensili ──────────────────────────────────────────────────────────

export function sumInMonth(rows: { date: string; amount: number }[], key: string): number {
  return rows.filter((r) => monthKey(r.date) === key).reduce((s, r) => s + r.amount, 0);
}

/** Spesa media mensile sugli ultimi `n` mesi (mese corrente escluso se ci sono
 *  mesi precedenti con dati; altrimenti usa il corrente per non dare 0). */
export function avgMonthlyExpense(expenses: Expense[], n = 6): number {
  const keys: string[] = [];
  for (let i = 1; i <= n; i++) keys.push(shiftedMonthKey(-i));
  const withData = keys.filter((k) => expenses.some((e) => monthKey(e.date) === k));
  if (withData.length === 0) {
    const cur = sumInMonth(expenses, currentMonthKey());
    return cur > 0 ? cur : 0;
  }
  const total = withData.reduce((s, k) => s + sumInMonth(expenses, k), 0);
  return total / withData.length;
}

/** Tasso di risparmio di un mese: (entrate − uscite) / entrate; 0 se entrate = 0 */
export function savingsRate(incomes: Income[], expenses: Expense[], key: string): number {
  const inc = sumInMonth(incomes, key);
  if (inc <= 0) return 0;
  return (inc - sumInMonth(expenses, key)) / inc;
}

/** Media del tasso di risparmio sugli ultimi `n` mesi conclusi con entrate */
export function avgSavingsRate(incomes: Income[], expenses: Income[], n = 3): number {
  const rates: number[] = [];
  for (let i = 1; i <= n; i++) {
    const k = shiftedMonthKey(-i);
    if (incomes.some((r) => monthKey(r.date) === k)) {
      rates.push(savingsRate(incomes, expenses, k));
    }
  }
  if (rates.length === 0) {
    const cur = currentMonthKey();
    return incomes.some((r) => monthKey(r.date) === cur)
      ? savingsRate(incomes, expenses, cur)
      : 0;
  }
  return rates.reduce((s, r) => s + r, 0) / rates.length;
}

/** "Oggi puoi spendere" = (budget totale mese − speso nel mese) / giorni rimanenti */
export function todayCanSpend(totalBudget: number, expenses: Expense[]): number {
  const spent = sumInMonth(expenses, currentMonthKey());
  return Math.max(0, (totalBudget - spent) / daysLeftInMonth());
}

/** Autonomia in anni = patrimonio liquido / spesa media mensile / 12 */
export function autonomyYears(liquidWealth: number, avgExpense: number): number | null {
  if (avgExpense <= 0) return null;
  return liquidWealth / avgExpense / 12;
}

/** Copertura spese in mesi = liquidità / spesa media mensile */
export function coverageMonths(liquidity: number, avgExpense: number): number | null {
  if (avgExpense <= 0) return null;
  return liquidity / avgExpense;
}

/** Rendite passive ultimi 12 mesi (categorie passive + rendite dichiarate su asset) */
export function passiveIncome12M(incomes: Income[], assets: Asset[]): number {
  const cutoff = shiftedMonthKey(-12);
  const passive = new Set<string>(PASSIVE_INCOME_CATEGORIES);
  const fromIncomes = incomes
    .filter((i) => monthKey(i.date) > cutoff && monthKey(i.date) <= currentMonthKey())
    .filter((i) => passive.has(i.category))
    .reduce((s, i) => s + i.amount, 0);
  const declared = assets.reduce((s, a) => s + (a.declaredAnnualIncome || 0), 0);
  return fromIncomes + declared;
}

/** Variazione del netto rispetto a ~30 giorni fa, dallo storico snapshot */
export function change30d(
  snapshots: Snapshot[],
  currentNet: number
): { abs: number; pct: number } | null {
  if (snapshots.length === 0) return null;
  const target = new Date();
  target.setDate(target.getDate() - 30);
  const targetISO = todayISO().slice(0, 4) ? target.toISOString().slice(0, 10) : "";
  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  // lo snapshot più vecchio tra quelli entro 30 giorni, o il più recente prima
  let ref = sorted.filter((s) => s.date <= targetISO).pop();
  if (!ref) ref = sorted[0];
  if (!ref || ref.date === todayISO()) {
    if (sorted.length < 2) return null;
    ref = sorted[0];
  }
  const abs = currentNet - ref.netWorth;
  const pct = ref.netWorth !== 0 ? (abs / Math.abs(ref.netWorth)) * 100 : 0;
  return { abs, pct };
}

// ── Allocazione ─────────────────────────────────────────────────────────────

export function allocationByClass(assets: Asset[]): Map<AssetClass, number> {
  const m = new Map<AssetClass, number>();
  for (const a of assets) {
    m.set(a.assetClass, (m.get(a.assetClass) || 0) + assetValue(a));
  }
  return m;
}

/** Versato effettivo di un obiettivo: se collegato a un conto, è il saldo del
 *  conto (in EUR, limitato al target); altrimenti il campo manuale. */
export function goalEffectiveSaved(
  goal: { saved: number; target: number; linkedAccountId?: string },
  accounts: Account[]
): number {
  if (goal.linkedAccountId) {
    const account = accounts.find((a) => a.id === goal.linkedAccountId);
    if (account) return Math.min(goal.target, Math.max(0, accountEurBalance(account)));
  }
  return goal.saved;
}

/** Peso % del singolo asset più pesante sul lordo (0 se lordo 0) */
export function maxAssetWeight(assets: Asset[], gross: number): { asset: Asset; weight: number } | null {
  if (gross <= 0 || assets.length === 0) return null;
  let best: Asset | null = null;
  let bestV = -1;
  for (const a of assets) {
    const v = assetValue(a);
    if (v > bestV) {
      bestV = v;
      best = a;
    }
  }
  if (!best) return null;
  return { asset: best, weight: (bestV / gross) * 100 };
}
