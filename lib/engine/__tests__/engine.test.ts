import { describe, expect, it } from "vitest";
import { computeAggregates } from "../aggregates";
import { computeBudgets } from "../budget";
import { computeHealth } from "../health";
import { fireTarget, futureValueMonthly, portfolioParams, simulate } from "../montecarlo";
import { latentTax, prunePots, expiringPots } from "../tax";
import { computeDueMovements, dueDates } from "../recurring";
import { shiftedMonthKey } from "../../format";
import type { Asset, Debt, Expense, RecurringTransaction, TaxState } from "../../types";

const asset = (over: Partial<Asset>): Asset => ({
  id: "a1",
  name: "Test",
  assetClass: "ETF",
  quantity: 10,
  avgCost: 100,
  currentPrice: 120,
  priceSource: "manuale",
  taxRegime: "standard",
  ...over,
});

describe("aggregati", () => {
  it("calcola lordo, netto e netto finanziario con immobile e mutuo collegato", () => {
    const home = asset({ id: "home", assetClass: "Immobili", quantity: 1, avgCost: 200000, currentPrice: 220000 });
    const etf = asset({ id: "etf", quantity: 10, avgCost: 100, currentPrice: 110 });
    const mortgage: Debt = {
      id: "m1",
      name: "Mutuo",
      type: "mutuo",
      residual: 150000,
      tan: 3,
      monthlyPayment: 600,
      linkedAssetId: "home",
      paymentDay: 1,
    };
    const agg = computeAggregates(
      [{ id: "c1", name: "Conto", type: "conto corrente", balance: 5000 }],
      [home, etf],
      [mortgage]
    );
    expect(agg.gross).toBe(5000 + 220000 + 1100);
    expect(agg.netWorth).toBe(agg.gross - 150000);
    // il netto finanziario esclude immobile e mutuo collegato
    expect(agg.netFinancial).toBe(5000 + 1100);
    expect(agg.liquidWealth).toBe(5000 + 1100);
    expect(agg.hasRealEstate).toBe(true);
  });
});

describe("indice di salute", () => {
  const fmt = { months: (n: number) => `${n}`, pct: (n: number) => `${n}%` };
  it("dà 100 al fondo emergenza con 6+ mesi di copertura", () => {
    const r = computeHealth(
      { coverageMonths: 6, avgSavingsRate3m: 0.2, assetClassCount: 5, debtToGross: 0.1, maxAssetWeightPct: 10 },
      fmt
    );
    expect(r.total).toBe(100);
  });
  it("è lineare sul debito tra 30% e 200%", () => {
    const r = computeHealth(
      { coverageMonths: 0, avgSavingsRate3m: 0, assetClassCount: 0, debtToGross: 1.15, maxAssetWeightPct: null },
      fmt
    );
    const debito = r.subscores.find((s) => s.key === "debito")!;
    expect(debito.score).toBeCloseTo(50, 0);
  });
});

describe("budget dinamici", () => {
  it("usa la media dei 3 mesi precedenti e rispetta gli override", () => {
    const mk = (delta: number, amount: number, category = "Cibo"): Expense => ({
      id: `e${delta}-${amount}`,
      description: "x",
      category,
      amount,
      date: `${shiftedMonthKey(delta)}-10`,
    });
    const expenses = [mk(-1, 300), mk(-2, 200), mk(-3, 100), mk(0, 50)];
    const budgets = computeBudgets(expenses, ["Cibo"], {});
    const cibo = budgets.find((b) => b.category === "Cibo")!;
    expect(cibo.budget).toBeCloseTo(200);
    expect(cibo.spent).toBe(50);

    const withOverride = computeBudgets(expenses, ["Cibo"], { Cibo: 500 });
    expect(withOverride.find((b) => b.category === "Cibo")!.budget).toBe(500);
    expect(withOverride.find((b) => b.category === "Cibo")!.isOverride).toBe(true);
  });
});

describe("Monte Carlo", () => {
  it("è deterministico a parità di seme e ordina i percentili", () => {
    const input = { start: 10000, monthly: 500, years: 10, mu: 0.06, sigma: 0.15 };
    const a = simulate(input);
    const b = simulate(input);
    expect(a.finals).toEqual(b.finals);
    expect(a.finals.p10).toBeLessThanOrEqual(a.finals.p50);
    expect(a.finals.p50).toBeLessThanOrEqual(a.finals.p90);
    expect(a.points).toHaveLength(11);
  });
  it("calcola la probabilità del target", () => {
    const r = simulate({ start: 0, monthly: 1000, years: 5, mu: 0.05, sigma: 0.1, target: 10000 });
    expect(r.targetProbability).toBeGreaterThan(95);
    expect(r.targetMedianYear).not.toBeNull();
  });
  it("fireTarget = spese annue / tasso prelievo", () => {
    expect(fireTarget(2000, 4)).toBeCloseTo((2000 * 12) / 0.04);
    expect(fireTarget(0, 4)).toBeNull();
  });
  it("futureValueMonthly cresce col tasso", () => {
    expect(futureValueMonthly(100, 0, 10)).toBeCloseTo(12000);
    expect(futureValueMonthly(100, 0.06, 10)).toBeGreaterThan(12000);
  });
  it("parametri portafoglio = media pesata", () => {
    const p = portfolioParams(
      [asset({ assetClass: "ETF", quantity: 1, currentPrice: 5000 })],
      5000
    );
    expect(p.mu).toBeCloseTo((0.06 + 0.01) / 2);
    expect(p.sigma).toBeCloseTo((0.15 + 0.005) / 2);
  });
});

describe("tasse", () => {
  it("tasse latenti: 26% standard, 12,5% whitelist, 0 in perdita", () => {
    expect(latentTax(asset({ quantity: 10, avgCost: 100, currentPrice: 120 }))).toBeCloseTo(200 * 0.26);
    expect(
      latentTax(asset({ taxRegime: "whitelist", quantity: 10, avgCost: 100, currentPrice: 120 }))
    ).toBeCloseTo(200 * 0.125);
    expect(latentTax(asset({ quantity: 10, avgCost: 120, currentPrice: 100 }))).toBe(0);
  });
  it("zainetto: scadenza al 4° anno, pruning delle scadute", () => {
    const tax: TaxState = {
      id: "main",
      realizedGainsYear: 0,
      realizedLossesYear: 0,
      lossPots: [
        { year: 2022, amount: 500 },
        { year: 2025, amount: 300 },
      ],
    };
    expect(expiringPots(tax, 2026).map((p) => p.year)).toEqual([2022]);
    expect(prunePots(tax.lossPots, 2027).map((p) => p.year)).toEqual([2025]);
  });
});

describe("movimenti ricorrenti", () => {
  it("genera le date maturate e mai quelle future", () => {
    const dates = dueDates("2026-01-15", "mensile", 27, "rec:x", "2026-03-10");
    expect(dates.map((d) => d.date)).toEqual(["2026-01-27", "2026-02-27"]);
  });
  it("è idempotente: al secondo giro non genera nulla", () => {
    const rec: RecurringTransaction = {
      id: "r1",
      description: "Stipendio",
      category: "Stipendio",
      amount: 1800,
      type: "entrata",
      cadence: "mensile",
      day: 5,
      active: true,
      startDate: "2026-05-01",
    };
    const first = computeDueMovements([rec], [], [], new Set(), "2026-07-10");
    expect(first.incomes).toHaveLength(3); // mag, giu, lug
    const refs = new Set(first.incomes.map((i) => i.sourceRef!));
    const second = computeDueMovements([rec], [], [], refs, "2026-07-10");
    expect(second.incomes).toHaveLength(0);
  });
  it("clampa il giorno nei mesi corti", () => {
    const dates = dueDates("2026-02-01", "mensile", 28, "rec:y", "2026-02-28");
    expect(dates[0].date).toBe("2026-02-28");
  });
});
