// ── Registrazione automatica dei movimenti ricorrenti ──────────────────────
// Idempotente: ogni movimento generato porta un sourceRef univoco
// ("rec:<id>:<periodo>", "sub:<id>:<periodo>", "debt:<id>:<periodo>");
// prima di inserire si verifica che non esista già. Riaprire l'app più volte
// non crea mai duplicati.

import type {
  Debt,
  Expense,
  Income,
  RecurringTransaction,
  Subscription,
} from "../types";
import { uid } from "../types";
import { daysInMonth, parseISODate, toISODate, todayISO } from "../format";
import { rataSplit } from "./amortization";

interface DueEntry {
  date: string; // data di registrazione
  sourceRef: string;
}

/** Date di scadenza maturate tra startDate e oggi per una cadenza data. */
export function dueDates(
  startDate: string,
  cadence: "mensile" | "annuale",
  day: number,
  refPrefix: string,
  today: string = todayISO()
): DueEntry[] {
  if (startDate > today) return [];
  const out: DueEntry[] = [];
  const start = parseISODate(startDate);
  const end = parseISODate(today);
  const clampDay = (y: number, m0: number) => Math.min(day, daysInMonth(y, m0));

  if (cadence === "mensile") {
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    // limite di sicurezza: massimo 36 mesi di backfill
    let guard = 0;
    while (cursor <= end && guard++ < 36) {
      const d = new Date(
        cursor.getFullYear(),
        cursor.getMonth(),
        clampDay(cursor.getFullYear(), cursor.getMonth())
      );
      const iso = toISODate(d);
      if (iso >= startDate && iso <= today) {
        const period = iso.slice(0, 7);
        out.push({ date: iso, sourceRef: `${refPrefix}:${period}` });
      }
      cursor.setMonth(cursor.getMonth() + 1);
    }
  } else {
    // annuale: una registrazione all'anno, nel mese di partenza
    let guard = 0;
    const month0 = start.getMonth();
    for (let y = start.getFullYear(); y <= end.getFullYear() && guard++ < 10; y++) {
      const d = new Date(y, month0, clampDay(y, month0));
      const iso = toISODate(d);
      if (iso >= startDate && iso <= today) {
        out.push({ date: iso, sourceRef: `${refPrefix}:${y}` });
      }
    }
  }
  return out;
}

export interface GeneratedMovements {
  incomes: Income[];
  expenses: Expense[];
  /** residui aggiornati dei debiti con ammortamento automatico */
  debtUpdates: { id: string; residual: number }[];
}

/** Calcola i movimenti da registrare (quelli il cui sourceRef non esiste già). */
export function computeDueMovements(
  recurring: RecurringTransaction[],
  subscriptions: Subscription[],
  debts: Debt[],
  existingRefs: Set<string>,
  today: string = todayISO()
): GeneratedMovements {
  const incomes: Income[] = [];
  const expenses: Expense[] = [];

  for (const r of recurring) {
    if (!r.active) continue;
    for (const due of dueDates(r.startDate, r.cadence, r.day, `rec:${r.id}`, today)) {
      if (existingRefs.has(due.sourceRef)) continue;
      const base = {
        id: uid(),
        description: r.description,
        category: r.category,
        amount: r.amount,
        date: due.date,
        source: "ricorrente" as const,
        sourceRef: due.sourceRef,
      };
      if (r.type === "entrata") incomes.push(base);
      else expenses.push(base);
    }
  }

  for (const s of subscriptions) {
    if (!s.active) continue;
    for (const due of dueDates(s.startDate, s.cadence, s.chargeDay, `sub:${s.id}`, today)) {
      if (existingRefs.has(due.sourceRef)) continue;
      expenses.push({
        id: uid(),
        description: s.name,
        category: "Abbonamenti",
        amount: s.amount,
        date: due.date,
        source: "auto",
        sourceRef: due.sourceRef,
      });
    }
  }

  const debtUpdates: { id: string; residual: number }[] = [];
  for (const d of debts) {
    if (d.monthlyPayment <= 0 || d.residual <= 0) continue;
    // le rate partono dal mese corrente in poi (startDate implicita = oggi al
    // primo avvio con il debito presente): usiamo il primo giorno utile
    const start = d.endDate && d.endDate < today ? null : firstOfCurrentMonth(today);
    if (!start) continue;
    // residuo corrente: le rate già registrate (sourceRef esistente) lo hanno
    // già scalato in passato, quindi si riduce solo per le rate NUOVE
    let residual = d.residual;
    for (const due of dueDates(start, "mensile", d.paymentDay, `debt:${d.id}`, today)) {
      if (existingRefs.has(due.sourceRef)) continue;
      if (residual <= 0) break;
      let amount = d.monthlyPayment;
      let description = `Rata ${d.name}`;
      if (d.amortize && d.tan > 0) {
        const split = rataSplit(residual, d.tan, d.monthlyPayment);
        if (!split.underwater) {
          amount = round2(split.payment);
          residual = round2(residual - split.principal);
          description = `Rata ${d.name} (${round2(split.principal).toLocaleString("it-IT", { minimumFractionDigits: 2 })} € capitale + ${round2(split.interest).toLocaleString("it-IT", { minimumFractionDigits: 2 })} € interessi)`;
        }
      } else if (d.amortize) {
        // TAN 0: tutta la rata è capitale
        const principal = Math.min(d.monthlyPayment, residual);
        amount = round2(principal);
        residual = round2(residual - principal);
      }
      expenses.push({
        id: uid(),
        description,
        category: d.type === "mutuo" ? "Casa" : "Altro",
        amount,
        date: due.date,
        source: "auto",
        sourceRef: due.sourceRef,
      });
    }
    if (d.amortize && residual !== d.residual) {
      debtUpdates.push({ id: d.id, residual: Math.max(0, residual) });
    }
  }

  return { incomes, expenses, debtUpdates };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function firstOfCurrentMonth(today: string): string {
  return today.slice(0, 7) + "-01";
}

// ── Rilevamento movimenti ricorrenti da suggerire ───────────────────────────

export interface RecurringCandidate {
  description: string;
  category: string;
  amount: number; // mediana degli importi
  type: "entrata" | "uscita";
  day: number; // giorno tipico del mese
  months: number; // in quanti mesi distinti compare
}

function normalizeDesc(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Possibili ABBONAMENTI: addebiti mensili con stessa descrizione e importo
 *  quasi identico (±5%), non già coperti da un abbonamento o da un ricorrente.
 *  Considera solo movimenti manuali/import (quelli auto sono già generati). */
export function detectSubscriptionCandidates(
  expenses: { description: string; category: string; amount: number; date: string; sourceRef?: string; source?: string }[],
  subscriptions: Subscription[],
  existingRecurring: RecurringTransaction[]
): RecurringCandidate[] {
  const organic = expenses.filter((e) => !e.sourceRef && e.source !== "auto" && e.source !== "ricorrente");
  const subNames = new Set(subscriptions.map((s) => normalizeDesc(s.name)));
  return detectRecurringCandidates(organic, "uscita", existingRecurring)
    .filter((c) => !subNames.has(normalizeDesc(c.description)))
    .filter((c) => c.amount >= 2) // sotto i 2 € non è un abbonamento sensato
    .slice(0, 3);
}

/** Movimenti (stessa descrizione, importo simile) presenti in ≥3 mesi distinti
 *  e non già coperti da un movimento ricorrente: candidati a diventarlo. */
export function detectRecurringCandidates(
  movements: { description: string; category: string; amount: number; date: string }[],
  type: "entrata" | "uscita",
  existingRecurring: RecurringTransaction[]
): RecurringCandidate[] {
  const existing = new Set(
    existingRecurring.filter((r) => r.type === type).map((r) => normalizeDesc(r.description))
  );
  const groups = new Map<
    string,
    { description: string; category: string; amounts: number[]; days: number[]; months: Set<string> }
  >();

  for (const m of movements) {
    const key = normalizeDesc(m.description);
    if (!key || existing.has(key)) continue;
    const g = groups.get(key) ?? {
      description: m.description,
      category: m.category,
      amounts: [],
      days: [],
      months: new Set<string>(),
    };
    g.amounts.push(m.amount);
    g.days.push(Number(m.date.slice(8, 10)));
    g.months.add(m.date.slice(0, 7));
    groups.set(key, g);
  }

  const out: RecurringCandidate[] = [];
  for (const g of groups.values()) {
    if (g.months.size < 3) continue;
    const med = median(g.amounts);
    // importi coerenti: tutti entro ±20% della mediana
    const coherent = g.amounts.every((a) => Math.abs(a - med) <= med * 0.2 + 1);
    if (!coherent) continue;
    out.push({
      description: g.description,
      category: g.category,
      amount: Math.round(med * 100) / 100,
      type,
      day: Math.min(28, Math.max(1, Math.round(median(g.days)))),
      months: g.months.size,
    });
  }
  return out.sort((a, b) => b.months - a.months || b.amount - a.amount);
}
