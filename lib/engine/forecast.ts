// ── Previsione liquidità: prossimi 12 mesi ──────────────────────────────────
// Proietta il saldo dei conti usando solo dati strutturati: movimenti
// ricorrenti attivi, abbonamenti, rate dei debiti (con ammortamento simulato),
// scadenze del calendario, più una stima delle spese variabili (media delle
// uscite NON automatiche degli ultimi 3 mesi). Deterministica e dichiarata.

import type { FinancialData } from "../types";
import { monthKey, parseISODate, shiftedMonthKey, todayISO } from "../format";
import { liquidityTotal } from "./aggregates";
import { rataSplit } from "./amortization";

export interface ForecastMonth {
  key: string; // "YYYY-MM"
  incomeRecurring: number;
  expenseStructured: number; // ricorrenti + abbonamenti + rate + scadenze
  variableExpense: number; // stima spese variabili
  oneOff: number; // scadenze una tantum del calendario (con segno)
  net: number;
  balance: number;
}

export interface ForecastResult {
  start: number; // liquidità attuale
  months: ForecastMonth[];
  variableMonthly: number;
  firstNegative: string | null; // primo mese con saldo < 0
}

/** Media mensile delle uscite non automatiche (manuali + import). */
export function estimateVariableExpenses(data: FinancialData, today = todayISO()): number {
  const manual = data.expenses.filter(
    (e) => e.source !== "ricorrente" && e.source !== "auto"
  );
  const prevKeys = [-1, -2, -3].map((d) => shiftedMonthKey(d));
  const withData = prevKeys.filter((k) => manual.some((e) => monthKey(e.date) === k));
  if (withData.length === 0) {
    // nessuno storico: usa il mese corrente come stima
    const cur = today.slice(0, 7);
    return manual.filter((e) => monthKey(e.date) === cur).reduce((s, e) => s + e.amount, 0);
  }
  const tot = withData.reduce(
    (s, k) => s + manual.filter((e) => monthKey(e.date) === k).reduce((x, e) => x + e.amount, 0),
    0
  );
  return tot / withData.length;
}

export function forecastLiquidity(
  data: FinancialData,
  horizon = 12,
  today = todayISO()
): ForecastResult {
  const start = liquidityTotal(data.accounts);
  const variableMonthly = estimateVariableExpenses(data, today);
  const months: ForecastMonth[] = [];
  let balance = start;
  let firstNegative: string | null = null;

  // residui simulati dei debiti con ammortamento
  const residuals = new Map(data.debts.map((d) => [d.id, d.residual]));

  for (let m = 1; m <= horizon; m++) {
    const key = shiftedMonthKey(m);
    const month0 = Number(key.slice(5, 7)) - 1;

    let incomeRecurring = 0;
    let expenseStructured = 0;
    let oneOff = 0;

    // movimenti ricorrenti attivi
    for (const r of data.recurring) {
      if (!r.active) continue;
      const due =
        r.cadence === "mensile" || parseISODate(r.startDate).getMonth() === month0;
      if (!due) continue;
      if (r.type === "entrata") incomeRecurring += r.amount;
      else expenseStructured += r.amount;
    }

    // abbonamenti attivi
    for (const s of data.subscriptions) {
      if (!s.active) continue;
      if (s.cadence === "mensile" || parseISODate(s.startDate).getMonth() === month0) {
        expenseStructured += s.amount;
      }
    }

    // rate dei debiti (ammortamento simulato mese per mese)
    for (const d of data.debts) {
      if (d.monthlyPayment <= 0) continue;
      if (d.endDate && key > d.endDate.slice(0, 7)) continue;
      const residual = residuals.get(d.id) ?? 0;
      if (residual <= 0) continue;
      if (d.amortize) {
        const split = rataSplit(residual, d.tan, d.monthlyPayment);
        if (split.underwater) {
          expenseStructured += d.monthlyPayment;
        } else {
          expenseStructured += split.payment;
          residuals.set(d.id, Math.max(0, residual - split.principal));
        }
      } else {
        expenseStructured += d.monthlyPayment;
      }
    }

    // scadenze manuali del calendario
    for (const c of data.calendarItems) {
      const itemMonth = c.date.slice(0, 7);
      const applies =
        c.recurrence === "una tantum"
          ? itemMonth === key
          : c.recurrence === "mensile"
            ? itemMonth <= key
            : parseISODate(c.date).getMonth() === month0 && itemMonth <= key;
      if (!applies) continue;
      if (c.recurrence === "una tantum") oneOff += c.amount;
      else if (c.amount >= 0) incomeRecurring += c.amount;
      else expenseStructured += -c.amount;
    }

    const net = incomeRecurring - expenseStructured - variableMonthly + oneOff;
    balance += net;
    if (balance < 0 && firstNegative === null) firstNegative = key;

    months.push({
      key,
      incomeRecurring,
      expenseStructured,
      variableExpense: variableMonthly,
      oneOff,
      net,
      balance,
    });
  }

  return { start, months, variableMonthly, firstNegative };
}
