// ── Motore operazioni: posizione, PMC, plusvalenze realizzate, zainetto ─────
// Le operazioni (assetTransactions) sono la fonte di verità: quantità e PMC
// dell'asset si ricalcolano dalla posizione iniziale (baseQuantity/baseAvgCost)
// applicandole in ordine cronologico. Metodo del costo medio ponderato (PMC):
//   acquisto → PMC = (qty·PMC + q·prezzo + commissioni) / (qty + q)
//   vendita  → plus/minusvalenza = q·(prezzo − PMC) − commissioni, PMC invariato
// Tutto è derivato e riproducibile: modifiche/eliminazioni ricalcolano tutto.

import type { Asset, AssetTransaction, LossPot, TaxState } from "../types";
import { potExpiryYear, taxRate } from "./tax";

export interface Position {
  quantity: number;
  avgCost: number;
}

export interface RealizedEvent {
  txId: string;
  assetId: string;
  date: string;
  createdAt: string; // ordina gli eventi dello stesso giorno
  year: number;
  quantity: number;
  gain: number; // >0 plusvalenza, <0 minusvalenza (commissioni incluse)
  taxRate: number; // aliquota del regime dell'asset venduto
}

export function sortTransactions(txs: AssetTransaction[]): AssetTransaction[] {
  return [...txs].sort(
    (a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)
  );
}

export function basePosition(asset: Asset): Position {
  return {
    quantity: asset.baseQuantity ?? asset.quantity,
    avgCost: asset.baseAvgCost ?? asset.avgCost,
  };
}

/** Applica le operazioni di UN asset alla sua posizione iniziale. */
export function applyTransactions(
  asset: Asset,
  txs: AssetTransaction[]
): { position: Position; realized: RealizedEvent[]; warnings: string[] } {
  let { quantity, avgCost } = basePosition(asset);
  const realized: RealizedEvent[] = [];
  const warnings: string[] = [];

  for (const tx of sortTransactions(txs.filter((t) => t.assetId === asset.id))) {
    if (tx.type === "dividendo") continue; // non tocca la posizione (entra nell'XIRR)
    if (tx.quantity <= 0) continue;
    if (tx.type === "frazionamento") {
      // split: la quantità si moltiplica per il fattore, il PMC si divide;
      // il capitale investito resta identico
      quantity *= tx.quantity;
      avgCost /= tx.quantity;
    } else if (tx.type === "acquisto") {
      const newQty = quantity + tx.quantity;
      avgCost = (quantity * avgCost + tx.quantity * tx.unitPrice + tx.fees) / newQty;
      quantity = newQty;
    } else {
      const q = Math.min(tx.quantity, quantity);
      if (q < tx.quantity) {
        warnings.push(
          `Vendita del ${tx.date} oltre la quantità posseduta: considerate solo ${q} unità.`
        );
      }
      if (q > 0) {
        const year = Number(tx.date.slice(0, 4));
        realized.push({
          txId: tx.id,
          assetId: asset.id,
          date: tx.date,
          createdAt: tx.createdAt,
          year,
          quantity: q,
          gain: q * (tx.unitPrice - avgCost) - tx.fees,
          // aliquota dell'anno di realizzo (crypto: 26% fino al 2025, 33% dal 2026)
          taxRate: taxRate(asset, year),
        });
        quantity -= q;
      }
    }
  }
  return { position: { quantity, avgCost }, realized, warnings };
}

/** Eventi realizzati di tutti gli asset, in ordine cronologico. */
export function allRealizedEvents(
  assets: Asset[],
  txs: AssetTransaction[]
): RealizedEvent[] {
  const events: RealizedEvent[] = [];
  for (const asset of assets) {
    events.push(...applyTransactions(asset, txs).realized);
  }
  return events.sort(
    (a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)
  );
}

export interface YearRealized {
  gains: number; // somma plusvalenze
  losses: number; // somma |minusvalenze|
}

export function realizedByYear(events: RealizedEvent[]): Map<number, YearRealized> {
  const m = new Map<number, YearRealized>();
  for (const e of events) {
    const row = m.get(e.year) ?? { gains: 0, losses: 0 };
    if (e.gain >= 0) row.gains += e.gain;
    else row.losses += -e.gain;
    m.set(e.year, row);
  }
  return m;
}

export interface TaxComputation {
  /** realizzato dell'anno corrente, solo da operazioni registrate in app */
  currentYear: YearRealized;
  /** zainetto residuo generato dalle operazioni, per anno di formazione,
   *  dopo le compensazioni cronologiche (scadenza: 31/12 del 4° anno succ.) */
  autoPots: LossPot[];
  /** plusvalenze dell'anno corrente compensate dallo zainetto auto */
  compensatedThisYear: number;
  /** imposta stimata dovuta sul realizzato dell'anno (dopo compensazione) */
  estimatedTaxDue: number;
}

/** Ricostruisce zainetto e compensazioni dall'intera storia delle operazioni.
 *  Semplificazione dichiarata: compensazione al valore nominale, senza
 *  distinzione redditi diversi/da capitale; le minusvalenze più vicine alla
 *  scadenza si usano per prime. Le rettifiche manuali (taxState) NON vengono
 *  consumate automaticamente: si sommano soltanto allo zainetto mostrato. */
export function computeTaxFromTransactions(
  events: RealizedEvent[],
  currentYear: number
): TaxComputation {
  const pots = new Map<number, number>(); // anno formazione → residuo
  let compensatedThisYear = 0;
  let estimatedTaxDue = 0;

  for (const e of events) {
    if (e.gain < 0) {
      pots.set(e.year, (pots.get(e.year) ?? 0) + -e.gain);
      continue;
    }
    // plusvalenza: compensa con le minusvalenze non scadute, prima le più vecchie
    let remaining = e.gain;
    const usable = [...pots.entries()]
      .filter(([year, amount]) => amount > 0 && potExpiryYear({ year, amount }) >= e.year && year <= e.year)
      .sort((a, b) => a[0] - b[0]);
    for (const [year, amount] of usable) {
      if (remaining <= 0) break;
      const used = Math.min(amount, remaining);
      pots.set(year, amount - used);
      remaining -= used;
      if (e.year === currentYear) compensatedThisYear += used;
    }
    if (e.year === currentYear && remaining > 0) {
      estimatedTaxDue += remaining * e.taxRate;
    }
  }

  const autoPots: LossPot[] = [...pots.entries()]
    .filter(([year, amount]) => amount > 0.005 && potExpiryYear({ year, amount }) >= currentYear)
    .map(([year, amount]) => ({ year, amount }))
    .sort((a, b) => a.year - b.year);

  const byYear = realizedByYear(events);
  return {
    currentYear: byYear.get(currentYear) ?? { gains: 0, losses: 0 },
    autoPots,
    compensatedThisYear,
    estimatedTaxDue,
  };
}

/** Zainetto totale mostrato = auto (da operazioni) + rettifiche manuali. */
export function mergedPots(auto: LossPot[], manual: LossPot[]): { pot: LossPot; source: "auto" | "manuale" }[] {
  return [
    ...auto.map((pot) => ({ pot, source: "auto" as const })),
    ...manual.map((pot) => ({ pot, source: "manuale" as const })),
  ].sort((a, b) => a.pot.year - b.pot.year);
}

export function totalMergedPots(auto: LossPot[], tax: TaxState): number {
  return (
    auto.reduce((s, p) => s + p.amount, 0) + tax.lossPots.reduce((s, p) => s + p.amount, 0)
  );
}
