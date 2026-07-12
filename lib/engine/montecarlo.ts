// ── Monte Carlo & FIRE ──────────────────────────────────────────────────────
// 400 simulazioni a passo mensile con rendimenti gaussiani. RNG con seme fisso:
// a parità di input il risultato è riproducibile. Le correlazioni tra classi
// sono ignorate (dichiarato nella card "Regole del modello").

import type { Asset, AssetClass } from "../types";
import { assetValue } from "./aggregates";

/** Rendimento atteso e volatilità annua per classe (tabella statica documentata) */
export const CLASS_PARAMS: Record<AssetClass, { mu: number; sigma: number }> = {
  ETF: { mu: 0.06, sigma: 0.15 },
  Azioni: { mu: 0.06, sigma: 0.15 },
  Obbligazioni: { mu: 0.025, sigma: 0.05 },
  Crypto: { mu: 0.2, sigma: 0.7 },
  "Oro & metalli": { mu: 0.03, sigma: 0.15 },
  Immobili: { mu: 0.03, sigma: 0.1 },
  Altro: { mu: 0.03, sigma: 0.1 },
};

export const LIQUIDITY_PARAMS = { mu: 0.01, sigma: 0.005 };

/** μ e σ del portafoglio = media pesata sulle allocazioni reali (immobili esclusi) */
export function portfolioParams(
  assets: Asset[],
  liquidity: number
): { mu: number; sigma: number } {
  const rows: { value: number; mu: number; sigma: number }[] = [];
  for (const a of assets) {
    if (a.assetClass === "Immobili") continue;
    const p = CLASS_PARAMS[a.assetClass];
    rows.push({ value: assetValue(a), mu: p.mu, sigma: p.sigma });
  }
  if (liquidity > 0) rows.push({ value: liquidity, ...LIQUIDITY_PARAMS });
  const total = rows.reduce((s, r) => s + r.value, 0);
  if (total <= 0) return { mu: 0.04, sigma: 0.1 }; // default neutro se vuoto
  return {
    mu: rows.reduce((s, r) => s + (r.value / total) * r.mu, 0),
    sigma: rows.reduce((s, r) => s + (r.value / total) * r.sigma, 0),
  };
}

// RNG deterministico (mulberry32) + gaussiana Box-Muller
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SimulationInput {
  start: number; // patrimonio liquido di partenza
  monthly: number; // versamento mensile
  years: number; // orizzonte (1–40)
  mu: number; // rendimento atteso annuo (es. 0.06)
  sigma: number; // volatilità annua (es. 0.15)
  runs?: number; // default 400
  target?: number; // capitale FIRE (opzionale)
  seed?: number;
  /** spese una tantum (what-if): sottratte al mese indicato (1-based) */
  oneOffs?: { month: number; amount: number }[];
}

export interface SimulationResult {
  /** un punto per anno (0..years): percentili 10/50/90 del patrimonio */
  points: { year: number; p10: number; p50: number; p90: number }[];
  finals: { p10: number; p50: number; p90: number };
  /** % di percorsi che raggiungono il target entro l'orizzonte (se target) */
  targetProbability: number | null;
  /** mediana dell'anno di primo raggiungimento; null = "> orizzonte" */
  targetMedianYear: number | null;
}

export function simulate(input: SimulationInput): SimulationResult {
  const runs = input.runs ?? 400;
  const months = Math.round(input.years * 12);
  const muM = input.mu / 12;
  const sigmaM = input.sigma / Math.sqrt(12);
  const rand = mulberry32(input.seed ?? 42);
  const oneOffByMonth = new Map<number, number>();
  for (const o of input.oneOffs ?? []) {
    if (o.amount > 0 && o.month >= 1 && o.month <= months) {
      oneOffByMonth.set(o.month, (oneOffByMonth.get(o.month) ?? 0) + o.amount);
    }
  }

  // paths[r][y] = valore a fine anno y (y=0 è la partenza)
  const yearly: number[][] = Array.from({ length: input.years + 1 }, () => []);
  const firstHit: number[] = [];
  let reached = 0;

  for (let r = 0; r < runs; r++) {
    let v = input.start;
    let hit: number | null = input.target != null && v >= input.target ? 0 : null;
    yearly[0].push(v);
    for (let m = 1; m <= months; m++) {
      // Box-Muller
      const u1 = Math.max(rand(), 1e-12);
      const u2 = rand();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = v * (1 + muM + sigmaM * z) + input.monthly;
      const oneOff = oneOffByMonth.get(m);
      if (oneOff) v -= oneOff;
      if (v < 0) v = 0;
      if (input.target != null && hit === null && v >= input.target) {
        hit = m / 12;
      }
      if (m % 12 === 0) yearly[m / 12].push(v);
    }
    if (input.target != null) {
      if (hit !== null) {
        reached++;
        firstHit.push(hit);
      }
    }
  }

  const pct = (arr: number[], p: number) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
    return sorted[idx];
  };

  const points = yearly.map((vals, year) => ({
    year,
    p10: pct(vals, 0.1),
    p50: pct(vals, 0.5),
    p90: pct(vals, 0.9),
  }));

  const last = points[points.length - 1];
  let targetMedianYear: number | null = null;
  if (input.target != null && firstHit.length > 0 && reached / runs >= 0.5) {
    firstHit.sort((a, b) => a - b);
    targetMedianYear = Math.ceil(firstHit[Math.floor(firstHit.length / 2)]);
  }

  return {
    points,
    finals: { p10: last.p10, p50: last.p50, p90: last.p90 },
    targetProbability: input.target != null ? (reached / runs) * 100 : null,
    targetMedianYear,
  };
}

/** Capitale FIRE = spese annue / tasso di prelievo */
export function fireTarget(avgMonthlyExpense: number, withdrawalRatePct: number): number | null {
  if (avgMonthlyExpense <= 0 || withdrawalRatePct <= 0) return null;
  return (avgMonthlyExpense * 12) / (withdrawalRatePct / 100);
}

// Cache di sessione: goalProbability è deterministico (seme fisso), quindi a
// parità di parametri il risultato è identico. Evita di rieseguire 400
// simulazioni ogni volta che advisor e pagina Obiettivi chiedono lo stesso dato.
const goalProbCache = new Map<string, number>();

/** Probabilità di raggiungere un obiettivo al ritmo attuale (riusa il Monte Carlo) */
export function goalProbability(
  saved: number,
  target: number,
  plannedMonthly: number,
  monthsLeft: number,
  mu: number,
  sigma: number
): number {
  if (saved >= target) return 100;
  if (monthsLeft <= 0) return 0;
  const key = `${saved.toFixed(2)}|${target.toFixed(2)}|${plannedMonthly.toFixed(2)}|${monthsLeft}|${mu.toFixed(4)}|${sigma.toFixed(4)}`;
  const cached = goalProbCache.get(key);
  if (cached !== undefined) return cached;
  const res = simulate({
    start: saved,
    monthly: plannedMonthly,
    years: Math.max(1 / 12, monthsLeft / 12),
    mu,
    sigma,
    runs: 400,
    target,
    seed: 7,
  });
  const prob = res.targetProbability ?? 0;
  if (goalProbCache.size > 500) goalProbCache.clear();
  goalProbCache.set(key, prob);
  return prob;
}

/** Versamento mensile necessario (senza rendimenti) per un obiettivo */
export function goalMonthlyNeeded(saved: number, target: number, monthsLeft: number): number {
  if (monthsLeft <= 0) return Math.max(0, target - saved);
  return Math.max(0, (target - saved) / monthsLeft);
}

/** Valore futuro di un versamento mensile a tasso annuo `rate` per `years` anni */
export function futureValueMonthly(monthly: number, rate: number, years: number): number {
  const i = rate / 12;
  const n = years * 12;
  if (i === 0) return monthly * n;
  return monthly * ((Math.pow(1 + i, n) - 1) / i);
}
