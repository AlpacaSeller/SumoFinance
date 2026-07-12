// ── XIRR: rendimento annualizzato money-weighted ────────────────────────────
// Tiene conto di QUANDO i soldi sono entrati/usciti (a differenza del P/L%).
// Flussi: negativi = esborsi (acquisti), positivi = incassi (vendite) +
// valore attuale della posizione come incasso virtuale finale.
// Limiti dichiarati: ignora dividendi/cedole non registrati come operazioni.

import type { Asset, AssetTransaction } from "../types";
import { parseISODate, todayISO } from "../format";
import { basePosition, sortTransactions } from "./transactions";

export interface CashFlow {
  date: string;
  amount: number; // negativo = esborso, positivo = incasso
}

const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;

/** Tasso interno di rendimento annualizzato; null se non calcolabile.
 *  Bisezione robusta su NPV(r) in [-99,99%, +1000%]. */
export function xirr(flows: CashFlow[]): number | null {
  if (flows.length < 2) return null;
  const sorted = [...flows].sort((a, b) => a.date.localeCompare(b.date));
  const hasPos = sorted.some((f) => f.amount > 0);
  const hasNeg = sorted.some((f) => f.amount < 0);
  if (!hasPos || !hasNeg) return null;

  const t0 = parseISODate(sorted[0].date).getTime();
  const years = sorted.map((f) => (parseISODate(f.date).getTime() - t0) / MS_PER_YEAR);
  const span = years[years.length - 1];
  // sotto il mese l'annualizzazione spara numeri assurdi: meglio niente
  if (span < 1 / 12) return null;

  const npv = (r: number) =>
    sorted.reduce((s, f, i) => s + f.amount / Math.pow(1 + r, years[i]), 0);

  let lo = -0.9999;
  let hi = 10;
  let flo = npv(lo);
  const fhi = npv(hi);
  if (flo * fhi > 0) return null; // nessuna radice nel range ragionevole
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < 1e-7) return mid;
    if (flo * fm < 0) {
      hi = mid;
    } else {
      lo = mid;
      flo = fm;
    }
  }
  return (lo + hi) / 2;
}

export interface AssetFlowsResult {
  computable: boolean;
  reason?: string;
  flows: CashFlow[];
}

/** Flussi di cassa datati di un asset (posizione iniziale + operazioni + valore attuale). */
export function assetFlows(
  asset: Asset,
  txs: AssetTransaction[],
  today: string = todayISO()
): AssetFlowsResult {
  const base = basePosition(asset);
  const mine = sortTransactions(txs.filter((t) => t.assetId === asset.id));
  const flows: CashFlow[] = [];

  if (base.quantity > 0 && base.quantity * base.avgCost > 0) {
    if (!asset.baseDate) {
      return {
        computable: false,
        reason:
          "Imposta la data di carico della posizione iniziale (modifica asset) per calcolare il rendimento annualizzato.",
        flows: [],
      };
    }
    flows.push({ date: asset.baseDate, amount: -(base.quantity * base.avgCost) });
  }

  for (const tx of mine) {
    if (tx.type === "dividendo") {
      // dividendo netto incassato: entra come flusso positivo nell'XIRR
      if (tx.unitPrice > 0) flows.push({ date: tx.date, amount: tx.unitPrice });
      continue;
    }
    if (tx.type === "frazionamento") continue; // nessun flusso di cassa
    if (tx.quantity <= 0) continue;
    if (tx.type === "acquisto") {
      flows.push({ date: tx.date, amount: -(tx.quantity * tx.unitPrice + tx.fees) });
    } else {
      flows.push({ date: tx.date, amount: tx.quantity * tx.unitPrice - tx.fees });
    }
  }

  const currentValue = asset.quantity * asset.currentPrice;
  if (currentValue > 0) {
    flows.push({ date: today, amount: currentValue });
  }

  if (flows.length < 2) {
    return { computable: false, reason: "Servono almeno un esborso e un valore/incasso.", flows };
  }
  return { computable: true, flows };
}

/** XIRR di un singolo asset. */
export function assetXirr(
  asset: Asset,
  txs: AssetTransaction[],
  today: string = todayISO()
): { rate: number | null; reason?: string } {
  const res = assetFlows(asset, txs, today);
  if (!res.computable) return { rate: null, reason: res.reason };
  const rate = xirr(res.flows);
  return {
    rate,
    reason:
      rate == null ? "Orizzonte troppo breve (< 1 mese) o flussi non sufficienti." : undefined,
  };
}

/** Solo i flussi di investimento datati (senza il valore attuale finale) degli
 *  asset calcolabili — base per confronti/benchmark. `filter` esclude classi. */
export function investmentFlows(
  assets: Asset[],
  txs: AssetTransaction[],
  filter: (a: Asset) => boolean = () => true
): { flows: CashFlow[]; included: Asset[]; excluded: number } {
  const flows: CashFlow[] = [];
  const included: Asset[] = [];
  let excluded = 0;
  for (const a of assets) {
    if (!filter(a)) continue;
    const res = assetFlows(a, txs, "9999-12-31"); // data futura: nessun flusso "oggi"
    if (!res.computable) {
      if (a.quantity > 0 || txs.some((t) => t.assetId === a.id)) excluded++;
      continue;
    }
    // assetFlows aggiunge il valore attuale con la data passata: qui lo evitiamo
    flows.push(...res.flows.filter((f) => f.date !== "9999-12-31"));
    included.push(a);
  }
  flows.sort((a, b) => a.date.localeCompare(b.date));
  return { flows, included, excluded };
}

/** XIRR aggregato del portafoglio: unisce i flussi degli asset calcolabili. */
export function portfolioXirr(
  assets: Asset[],
  txs: AssetTransaction[],
  today: string = todayISO()
): { rate: number | null; included: number; excluded: number } {
  const flows: CashFlow[] = [];
  let included = 0;
  let excluded = 0;
  for (const a of assets) {
    const res = assetFlows(a, txs, today);
    if (res.computable) {
      flows.push(...res.flows);
      included++;
    } else if (a.quantity > 0 || txs.some((t) => t.assetId === a.id)) {
      excluded++;
    }
  }
  if (included === 0) return { rate: null, included, excluded };
  return { rate: xirr(flows), included, excluded };
}
