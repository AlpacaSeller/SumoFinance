import { describe, expect, it } from "vitest";
import { computeTwr, investmentFlows } from "../twr";
import type { Asset, AssetTransaction, Snapshot } from "../../types";

const snap = (date: string, investments: number): Snapshot => ({
  id: date,
  date,
  netWorth: investments,
  gross: investments,
  liquidity: 0,
  investments,
  debts: 0,
});

describe("computeTwr", () => {
  it("senza flussi: rendimento semplice", () => {
    const r = computeTwr([snap("2026-01-01", 1000), snap("2026-03-01", 1100)], [], "2026-01-01");
    expect(r.computable).toBe(true);
    expect(r.cumulative).toBeCloseTo(0.1, 10);
  });

  it("neutralizza un versamento a metà periodo", () => {
    // 1000 → versati altri 1000 → 2100: il mercato ha reso 5%, non il 110%
    const r = computeTwr(
      [snap("2026-01-01", 1000), snap("2026-03-01", 2100)],
      [{ date: "2026-02-01", amount: 1000 }],
      "2026-01-01"
    );
    expect(r.cumulative).toBeCloseTo(0.05, 10);
  });

  it("concatena i sotto-periodi tra snapshot", () => {
    // +10% poi −5%: cumulato = 1,1 × 0,95 − 1
    const r = computeTwr(
      [snap("2026-01-01", 1000), snap("2026-02-01", 1100), snap("2026-03-01", 1045)],
      [],
      "2026-01-01"
    );
    expect(r.cumulative).toBeCloseTo(1.1 * 0.95 - 1, 10);
  });

  it("annualizza solo oltre i 90 giorni", () => {
    const short = computeTwr(
      [snap("2026-01-01", 1000), snap("2026-02-15", 1050)],
      [],
      "2026-01-01"
    );
    expect(short.annualized).toBeUndefined();
    const long = computeTwr(
      [snap("2026-01-01", 1000), snap("2026-07-02", 1050)],
      [],
      "2026-01-01"
    );
    expect(long.days).toBe(182);
    expect(long.annualized).toBeCloseTo(Math.pow(1.05, 365 / 182) - 1, 10);
  });

  it("non computabile con meno di due snapshot", () => {
    expect(computeTwr([snap("2026-01-01", 1000)], [], "2026-01-01").computable).toBe(false);
  });
});

describe("investmentFlows", () => {
  it("basi + acquisti − vendite; dividendi e split ignorati", () => {
    const asset: Asset = {
      id: "a",
      name: "ETF",
      assetClass: "ETF",
      quantity: 10,
      avgCost: 100,
      baseQuantity: 10,
      baseAvgCost: 100,
      baseDate: "2026-01-05",
      currentPrice: 110,
      priceSource: "manuale",
      taxRegime: "standard",
    };
    const txs: AssetTransaction[] = [
      { id: "1", assetId: "a", type: "acquisto", date: "2026-02-01", quantity: 5, unitPrice: 102, fees: 3, createdAt: "" },
      { id: "2", assetId: "a", type: "vendita", date: "2026-03-01", quantity: 2, unitPrice: 108, fees: 1, createdAt: "" },
      { id: "3", assetId: "a", type: "dividendo", date: "2026-03-10", quantity: 1, unitPrice: 12, fees: 0, createdAt: "" },
      { id: "4", assetId: "a", type: "frazionamento", date: "2026-04-01", quantity: 10, unitPrice: 0, fees: 0, createdAt: "" },
    ];
    const flows = investmentFlows([asset], txs);
    expect(flows).toHaveLength(3);
    expect(flows[0]).toEqual({ date: "2026-01-05", amount: 1000 });
    expect(flows[1].amount).toBeCloseTo(5 * 102 + 3);
    expect(flows[2].amount).toBeCloseTo(-(2 * 108 - 1));
  });
});
