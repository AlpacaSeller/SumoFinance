// ── TWR: rendimento time-weighted del portafoglio ───────────────────────────
// Complementare allo XIRR (money-weighted): il TWR neutralizza l'effetto di
// QUANDO hai versato o prelevato, misurando solo la bontà degli investimenti.
// È la metrica giusta per confrontarsi con un benchmark.
//
// Calcolo: la serie del valore investimenti viene dagli snapshot giornalieri;
// i flussi esterni (acquisti, vendite, posizioni iniziali) spezzano il periodo
// in sotto-periodi i cui rendimenti vengono concatenati:
//   r_i = V_fine / (V_inizio + F_i)   (flussi a inizio sotto-periodo)
//   TWR = Π (1 + r_i) − 1
// Con granularità giornaliera degli snapshot l'approssimazione è ottima.

import type { Asset, AssetTransaction, Snapshot } from "../types";

export interface ExternalFlow {
  date: string; // YYYY-MM-DD
  amount: number; // + capitale entrato negli investimenti, − uscito
}

/** Flussi esterni del "secchio investimenti": basi + acquisti − vendite.
 *  Dividendi e split non muovono capitale dentro/fuori. */
export function investmentFlows(assets: Asset[], txs: AssetTransaction[]): ExternalFlow[] {
  const flows: ExternalFlow[] = [];
  for (const a of assets) {
    if (a.baseDate && (a.baseQuantity ?? 0) > 0) {
      flows.push({ date: a.baseDate, amount: (a.baseQuantity ?? 0) * (a.baseAvgCost ?? 0) });
    }
  }
  for (const t of txs) {
    if (t.type === "acquisto") flows.push({ date: t.date, amount: t.quantity * t.unitPrice + t.fees });
    else if (t.type === "vendita")
      flows.push({ date: t.date, amount: -(t.quantity * t.unitPrice - t.fees) });
  }
  return flows.sort((a, b) => a.date.localeCompare(b.date));
}

export interface TwrResult {
  computable: boolean;
  reason?: string;
  /** rendimento cumulato del periodo, es. 0,072 = +7,2% */
  cumulative?: number;
  /** annualizzato (solo se il periodo copre almeno 90 giorni) */
  annualized?: number;
  days?: number;
  from?: string;
  to?: string;
}

/** TWR dal primo snapshot ≥ fromISO all'ultimo disponibile. */
export function computeTwr(
  snapshots: Snapshot[],
  flows: ExternalFlow[],
  fromISO: string
): TwrResult {
  const series = snapshots
    .filter((s) => s.date >= fromISO && s.investments > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (series.length < 2) {
    return { computable: false, reason: "servono almeno due snapshot con investimenti" };
  }

  let growth = 1;
  for (let i = 0; i < series.length - 1; i++) {
    const start = series[i];
    const end = series[i + 1];
    const f = flows
      .filter((x) => x.date > start.date && x.date <= end.date)
      .reduce((s, x) => s + x.amount, 0);
    const denom = start.investments + f;
    if (denom <= 0) continue; // sotto-periodo degenere (es. liquidazione totale)
    growth *= end.investments / denom;
  }

  const from = series[0].date;
  const to = series[series.length - 1].date;
  const days = Math.max(
    1,
    Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000)
  );
  const cumulative = growth - 1;
  const result: TwrResult = { computable: true, cumulative, days, from, to };
  if (days >= 90) {
    result.annualized = Math.pow(1 + cumulative, 365 / days) - 1;
  }
  return result;
}
