// ── Calendario finanziario: voci dei prossimi 90 giorni ────────────────────
// Le voci "auto" (rate dei debiti, cedole/dividendi ricorrenti) sono derivate
// al volo dai dati, non persistite: niente duplicati, sempre coerenti.

import type { Asset, CalendarItem, Debt, RecurringTransaction } from "../types";
import { PASSIVE_INCOME_CATEGORIES } from "../types";
import { daysInMonth, parseISODate, toISODate, todayISO } from "../format";
import { bondEvents } from "./bonds";

export interface UpcomingItem {
  id: string;
  title: string;
  amount: number;
  date: string;
  origin: "manuale" | "auto";
  recurrence: string;
  /** id dell'elemento manuale sottostante (per modifica/eliminazione) */
  sourceId?: string;
}

export function upcomingItems(
  manual: CalendarItem[],
  debts: Debt[],
  recurring: RecurringTransaction[],
  horizonDays = 90,
  today: string = todayISO(),
  assets: Asset[] = []
): UpcomingItem[] {
  const end = parseISODate(today);
  end.setDate(end.getDate() + horizonDays);
  const endISO = toISODate(end);
  const out: UpcomingItem[] = [];

  // manuali (con espansione delle ricorrenze nel periodo)
  for (const m of manual) {
    for (const date of occurrences(m.date, m.recurrence, today, endISO)) {
      out.push({
        id: `${m.id}:${date}`,
        sourceId: m.id,
        title: m.title,
        amount: m.amount,
        date,
        origin: "manuale",
        recurrence: m.recurrence,
      });
    }
  }

  // rate dei debiti
  for (const d of debts) {
    if (d.monthlyPayment <= 0 || d.residual <= 0) continue;
    for (const date of monthlyOccurrences(d.paymentDay, today, endISO)) {
      if (d.endDate && date > d.endDate) continue;
      out.push({
        id: `debt:${d.id}:${date}`,
        title: `Rata ${d.name}`,
        amount: -d.monthlyPayment,
        date,
        origin: "auto",
        recurrence: "mensile",
      });
    }
  }

  // entrate ricorrenti passive (cedole, dividendi, affitti...)
  const passive = new Set<string>(PASSIVE_INCOME_CATEGORIES);
  for (const r of recurring) {
    if (!r.active || r.type !== "entrata" || !passive.has(r.category)) continue;
    const dates =
      r.cadence === "mensile"
        ? monthlyOccurrences(r.day, today, endISO)
        : annualOccurrences(r.startDate, r.day, today, endISO);
    for (const date of dates) {
      out.push({
        id: `rec:${r.id}:${date}`,
        title: r.description,
        amount: r.amount,
        date,
        origin: "auto",
        recurrence: r.cadence,
      });
    }
  }

  // cedole e rimborsi delle obbligazioni con piano configurato
  for (const a of assets) {
    for (const ev of bondEvents(a, today, endISO)) {
      out.push({
        id: `bond:${a.id}:${ev.date}`,
        title: ev.isMaturity ? `Rimborso ${a.name} (+ ultima cedola)` : `Cedola ${a.name} (lorda)`,
        amount: ev.amount,
        date: ev.date,
        origin: "auto",
        recurrence: a.couponFrequency ?? "semestrale",
      });
    }
  }

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function occurrences(
  baseDate: string,
  recurrence: CalendarItem["recurrence"],
  from: string,
  to: string
): string[] {
  if (recurrence === "una tantum") {
    return baseDate >= from && baseDate <= to ? [baseDate] : [];
  }
  const base = parseISODate(baseDate);
  if (recurrence === "mensile") {
    return monthlyOccurrences(base.getDate(), from, to).filter((d) => d >= baseDate);
  }
  // annuale
  return annualOccurrences(baseDate, base.getDate(), from, to).filter((d) => d >= baseDate);
}

function monthlyOccurrences(day: number, from: string, to: string): string[] {
  const out: string[] = [];
  const start = parseISODate(from);
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const endD = parseISODate(to);
  let guard = 0;
  while (cursor <= endD && guard++ < 6) {
    const d = new Date(
      cursor.getFullYear(),
      cursor.getMonth(),
      Math.min(day, daysInMonth(cursor.getFullYear(), cursor.getMonth()))
    );
    const iso = toISODate(d);
    if (iso >= from && iso <= to) out.push(iso);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

function annualOccurrences(baseDate: string, day: number, from: string, to: string): string[] {
  const base = parseISODate(baseDate);
  const out: string[] = [];
  for (let y = parseISODate(from).getFullYear(); y <= parseISODate(to).getFullYear(); y++) {
    const d = new Date(y, base.getMonth(), Math.min(day, daysInMonth(y, base.getMonth())));
    const iso = toISODate(d);
    if (iso >= from && iso <= to) out.push(iso);
  }
  return out;
}
