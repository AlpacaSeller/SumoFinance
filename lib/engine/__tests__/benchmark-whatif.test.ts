import { describe, expect, it } from "vitest";
import { benchmarkFromFlows, priceAt } from "../benchmark";
import { simulate } from "../montecarlo";
import { taxRate } from "../tax";
import { applyTransactions } from "../transactions";
import type { Asset, AssetTransaction } from "../../types";

const ts = (iso: string) => new Date(iso + "T12:00:00").getTime();

const series = [
  { t: ts("2024-01-01"), p: 100 },
  { t: ts("2024-07-01"), p: 110 },
  { t: ts("2025-01-01"), p: 120 },
  { t: ts("2025-07-01"), p: 130 },
];

describe("benchmark", () => {
  it("priceAt: ultimo prezzo ≤ data, clamp prima della serie", () => {
    expect(priceAt(series, "2024-08-15")).toEqual({ price: 110, clamped: false });
    expect(priceAt(series, "2023-01-01")).toEqual({ price: 100, clamped: true });
    expect(priceAt(series, "2026-01-01")).toEqual({ price: 130, clamped: false });
  });

  it("replay dei flussi: acquisti a prezzi storici, valore all'ultimo prezzo", () => {
    // −1000 @100 (10 quote) e −1100 @110 (10 quote) → 20 quote × 130 = 2600
    const res = benchmarkFromFlows(
      [
        { date: "2024-01-01", amount: -1000 },
        { date: "2024-07-01", amount: -1100 },
      ],
      series,
      "2025-07-01"
    )!;
    expect(res.finalValue).toBeCloseTo(2600);
    expect(res.invested).toBeCloseTo(2100);
    expect(res.clampedFlows).toBe(0);
    expect(res.rate).toBeGreaterThan(0.15);
  });

  it("le vendite riducono le quote", () => {
    // compra 10 quote @100, vende 550 € @110 (5 quote) → 5 quote × 130 = 650
    const res = benchmarkFromFlows(
      [
        { date: "2024-01-01", amount: -1000 },
        { date: "2024-07-01", amount: 550 },
      ],
      series,
      "2025-07-01"
    )!;
    expect(res.finalValue).toBeCloseTo(650);
  });
});

describe("what-if: spese una tantum nel Monte Carlo", () => {
  it("una spesa una tantum riduce la mediana (a parità di seme)", () => {
    const base = { start: 50000, monthly: 500, years: 10, mu: 0.05, sigma: 0.1 };
    const a = simulate(base);
    const b = simulate({ ...base, oneOffs: [{ month: 60, amount: 20000 }] });
    expect(b.finals.p50).toBeLessThan(a.finals.p50);
    // la differenza deve essere almeno la spesa (senza la crescita persa sarebbe esattamente 20k)
    expect(a.finals.p50 - b.finals.p50).toBeGreaterThan(20000 * 0.9);
  });
});

describe("aliquota crypto per anno", () => {
  const crypto = (over: Partial<Asset> = {}): Asset => ({
    id: "c1",
    name: "Bitcoin",
    assetClass: "Crypto",
    quantity: 1,
    avgCost: 10000,
    baseQuantity: 1,
    baseAvgCost: 10000,
    currentPrice: 50000,
    priceSource: "manuale",
    taxRegime: "standard",
    ...over,
  });

  it("33% dal 2026, 26% prima", () => {
    expect(taxRate(crypto(), 2026)).toBe(0.33);
    expect(taxRate(crypto(), 2025)).toBe(0.26);
    expect(taxRate(crypto({ assetClass: "ETF" }), 2026)).toBe(0.26);
  });

  it("gli eventi realizzati usano l'aliquota dell'anno di vendita", () => {
    const tx = (id: string, date: string): AssetTransaction => ({
      id,
      assetId: "c1",
      type: "vendita",
      date,
      quantity: 0.1,
      unitPrice: 60000,
      fees: 0,
      createdAt: date + "T10:00:00Z",
    });
    const { realized } = applyTransactions(crypto({ baseQuantity: 1 }), [
      tx("t25", "2025-06-01"),
      tx("t26", "2026-06-01"),
    ]);
    expect(realized.find((e) => e.year === 2025)!.taxRate).toBe(0.26);
    expect(realized.find((e) => e.year === 2026)!.taxRate).toBe(0.33);
  });
});
