// ── Ricostruzione del valore investito nel tempo ────────────────────────────
// SOLO dati accurati: per ogni mese, quantità realmente detenuta (dalla
// posizione iniziale datata + operazioni fino a quella data) × prezzo storico
// reale (serie prezzi in cache). Gli asset senza storico prezzi sono esclusi
// e conteggiati a parte: non inventiamo valori passati.

import type { Asset, AssetTransaction } from "../types";
import { toISODate } from "../format";
import { applyTransactions } from "./transactions";
import { priceAt, type PricePoint } from "./benchmark";

export interface PortfolioHistoryPoint {
  key: string; // "YYYY-MM"
  label: string;
  value: number; // valore di mercato del portafoglio a fine mese
  invested: number; // capitale investito (costo) a fine mese
}

export interface PortfolioHistoryResult {
  points: PortfolioHistoryPoint[];
  includedAssets: string[]; // nomi degli asset con storico prezzi
  excludedAssets: string[]; // nomi senza storico (non ricostruibili)
}

/** Posizione (quantità, PMC) di un asset a una certa data. */
export function positionAtDate(
  asset: Asset,
  txs: AssetTransaction[],
  cutoff: string
): { quantity: number; avgCost: number } {
  // prima della data di carico non risulta detenuto
  if (asset.baseDate && cutoff < asset.baseDate) return { quantity: 0, avgCost: 0 };
  const upTo = txs.filter((t) => t.assetId === asset.id && t.date <= cutoff);
  const { position } = applyTransactions(asset, upTo);
  return position;
}

/** Ultimo giorno del mese `key` ("YYYY-MM"), o oggi se è il mese corrente. */
function monthEnd(key: string, today: string): string {
  if (key === today.slice(0, 7)) return today;
  const [y, m] = key.split("-").map(Number);
  return toISODate(new Date(y, m, 0)); // giorno 0 del mese successivo = ultimo del mese
}

export function reconstructPortfolioHistory(
  assets: Asset[],
  txs: AssetTransaction[],
  historyBySymbol: Map<string, PricePoint[]>,
  today: string,
  months = 12
): PortfolioHistoryResult {
  // asset ricostruibili: hanno un simbolo con storico prezzi in cache
  const tracked = assets.filter(
    (a) => a.assetClass !== "Immobili" && a.symbol && historyBySymbol.has(a.symbol)
  );
  const excluded = assets.filter(
    (a) =>
      a.assetClass !== "Immobili" &&
      (a.quantity > 0 || txs.some((t) => t.assetId === a.id)) &&
      !(a.symbol && historyBySymbol.has(a.symbol))
  );

  const points: PortfolioHistoryPoint[] = [];
  const now = new Date(today + "T12:00:00");
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const cutoff = monthEnd(key, today);
    let value = 0;
    let invested = 0;
    for (const a of tracked) {
      const pos = positionAtDate(a, txs, cutoff);
      if (pos.quantity <= 0) continue;
      const isCurrentMonth = key === today.slice(0, 7);
      const priced = isCurrentMonth
        ? { price: a.currentPrice, clamped: false }
        : priceAt(historyBySymbol.get(a.symbol!)!, cutoff);
      if (!priced) continue;
      value += pos.quantity * priced.price;
      invested += pos.quantity * pos.avgCost;
    }
    points.push({
      key,
      label: d.toLocaleDateString("it-IT", { month: "short", year: "2-digit" }),
      value: Math.round(value * 100) / 100,
      invested: Math.round(invested * 100) / 100,
    });
  }

  return {
    points,
    includedAssets: tracked.map((a) => a.name),
    excludedAssets: excluded.map((a) => a.name),
  };
}
