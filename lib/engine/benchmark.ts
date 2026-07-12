// ── Benchmark: "e se avessi investito gli stessi flussi in un indice?" ──────
// Replay dei flussi reali datati (posizione iniziale, acquisti, vendite) come
// se fossero stati investiti nel benchmark ai prezzi storici: quote accumulate
// × ultimo prezzo = valore finale alternativo, e XIRR sui flussi sintetici.

import type { CashFlow } from "./xirr";
import { xirr } from "./xirr";
import { parseISODate, todayISO } from "../format";

export interface PricePoint {
  t: number; // timestamp ms
  p: number;
}

/** Prezzo alla data: ultimo punto ≤ data; se la data precede la serie, il
 *  primo punto disponibile (flusso "clampato", conteggiato a parte). */
export function priceAt(
  points: PricePoint[],
  date: string
): { price: number; clamped: boolean } | null {
  if (points.length === 0) return null;
  // granularità a giorni: un punto quotato nello stesso giorno del flusso conta
  const t = parseISODate(date).getTime() + 86_399_999;
  if (t < points[0].t) return { price: points[0].p, clamped: true };
  let best = points[0].p;
  for (const pt of points) {
    if (pt.t > t) break;
    best = pt.p;
  }
  return { price: best, clamped: false };
}

export interface BenchmarkResult {
  finalValue: number; // valore attuale della strategia benchmark
  rate: number | null; // XIRR della strategia benchmark
  invested: number; // Σ esborsi netti
  clampedFlows: number; // flussi precedenti allo storico disponibile
}

export function benchmarkFromFlows(
  flows: CashFlow[],
  points: PricePoint[],
  today: string = todayISO()
): BenchmarkResult | null {
  if (flows.length === 0 || points.length === 0) return null;
  const lastPrice = points[points.length - 1].p;
  let units = 0;
  let invested = 0;
  let clampedFlows = 0;

  for (const f of flows) {
    const at = priceAt(points, f.date);
    if (!at) return null;
    if (at.clamped) clampedFlows++;
    if (f.amount < 0) {
      // esborso: si comprano quote del benchmark
      units += -f.amount / at.price;
      invested += -f.amount;
    } else if (f.amount > 0) {
      // incasso: si vendono quote (non oltre il posseduto)
      const sellUnits = Math.min(units, f.amount / at.price);
      units -= sellUnits;
      invested -= f.amount;
    }
  }

  const finalValue = units * lastPrice;
  const synthetic: CashFlow[] = [...flows, { date: today, amount: finalValue }];
  return { finalValue, rate: xirr(synthetic), invested, clampedFlows };
}
