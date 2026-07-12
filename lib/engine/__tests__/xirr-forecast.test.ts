import { describe, expect, it } from "vitest";
import { assetXirr, portfolioXirr, xirr } from "../xirr";
import { estimateVariableExpenses, forecastLiquidity } from "../forecast";
import { shiftedMonthKey, todayISO } from "../../format";
import type { Asset, AssetTransaction, FinancialData } from "../../types";
import { DEFAULT_SETTINGS, DEFAULT_TAX_STATE } from "../../defaults";

const asset = (over: Partial<Asset> = {}): Asset => ({
  id: "a1",
  name: "Test",
  assetClass: "ETF",
  quantity: 10,
  avgCost: 100,
  baseQuantity: 10,
  baseAvgCost: 100,
  baseDate: "2024-01-01",
  currentPrice: 120,
  priceSource: "manuale",
  taxRegime: "standard",
  ...over,
});

const emptyData = (over: Partial<FinancialData> = {}): FinancialData => ({
  settings: { ...DEFAULT_SETTINGS },
  accounts: [],
  assets: [],
  assetTransactions: [],
  debts: [],
  incomes: [],
  expenses: [],
  subscriptions: [],
  recurring: [],
  goals: [],
  calendarItems: [],
  snapshots: [],
  taxState: { ...DEFAULT_TAX_STATE },
  ...over,
});

describe("xirr", () => {
  it("caso noto: −1000 → +1100 dopo un anno esatto ≈ 10%", () => {
    const r = xirr([
      { date: "2024-01-01", amount: -1000 },
      { date: "2025-01-01", amount: 1100 },
    ]);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(0.1, 2);
  });
  it("flussi multipli: coerente con NPV = 0", () => {
    const flows = [
      { date: "2024-01-01", amount: -1000 },
      { date: "2024-07-01", amount: -500 },
      { date: "2025-07-01", amount: 1700 },
    ];
    const r = xirr(flows)!;
    // verifica: NPV al tasso trovato ≈ 0
    const t0 = new Date(2024, 0, 1).getTime();
    const npv = flows.reduce((s, f) => {
      const [y, m, d] = f.date.split("-").map(Number);
      const yrs = (new Date(y, m - 1, d).getTime() - t0) / (365.25 * 24 * 3600 * 1000);
      return s + f.amount / Math.pow(1 + r, yrs);
    }, 0);
    expect(Math.abs(npv)).toBeLessThan(0.01);
  });
  it("null senza flussi di segno opposto o sotto il mese", () => {
    expect(xirr([{ date: "2024-01-01", amount: -100 }])).toBeNull();
    expect(
      xirr([
        { date: "2024-01-01", amount: -100 },
        { date: "2024-01-10", amount: 110 },
      ])
    ).toBeNull();
  });
});

describe("assetXirr / portfolioXirr", () => {
  it("posizione iniziale senza data → non calcolabile con motivo", () => {
    const r = assetXirr(asset({ baseDate: undefined }), []);
    expect(r.rate).toBeNull();
    expect(r.reason).toContain("data di carico");
  });
  it("posizione con data + valore attuale → tasso positivo", () => {
    // −1000 il 2024-01-01, valore 1200 oggi (≈ 2,5 anni dopo) → ~7,5%
    const r = assetXirr(asset(), [], "2026-07-11");
    expect(r.rate).not.toBeNull();
    expect(r.rate!).toBeGreaterThan(0.05);
    expect(r.rate!).toBeLessThan(0.12);
  });
  it("le vendite entrano come incassi", () => {
    const txs: AssetTransaction[] = [
      {
        id: "t1",
        assetId: "a1",
        type: "vendita",
        date: "2025-01-01",
        quantity: 10,
        unitPrice: 130,
        fees: 0,
        createdAt: "2025-01-01T10:00:00Z",
      },
    ];
    // tutto venduto: −1000 → +1300 in un anno = 30%
    const sold = asset({ quantity: 0 });
    const r = assetXirr(sold, txs, "2026-07-11");
    expect(r.rate).toBeCloseTo(0.3, 1);
  });
  it("portafoglio: aggrega i calcolabili e conta gli esclusi", () => {
    const a1 = asset();
    const a2 = asset({ id: "a2", baseDate: undefined });
    const r = portfolioXirr([a1, a2], [], "2026-07-11");
    expect(r.included).toBe(1);
    expect(r.excluded).toBe(1);
    expect(r.rate).not.toBeNull();
  });
});

describe("previsione liquidità", () => {
  it("stima variabili: media dei 3 mesi precedenti, solo spese non automatiche", () => {
    const mk = (delta: number, amount: number, source?: "auto" | "ricorrente") => ({
      id: `${delta}-${amount}-${source}`,
      description: "x",
      category: "Cibo",
      amount,
      date: `${shiftedMonthKey(delta)}-10`,
      source,
    });
    const data = emptyData({
      expenses: [mk(-1, 300), mk(-2, 200), mk(-3, 100), mk(-1, 999, "auto"), mk(0, 50)],
    });
    expect(estimateVariableExpenses(data)).toBeCloseTo(200);
  });

  it("proietta stipendio, rata con ammortamento che si estingue e variabili", () => {
    const data = emptyData({
      accounts: [{ id: "c", name: "Conto", type: "conto corrente", balance: 1000 }],
      recurring: [
        {
          id: "r1",
          description: "Stipendio",
          category: "Stipendio",
          amount: 2000,
          type: "entrata",
          cadence: "mensile",
          day: 27,
          active: true,
          startDate: todayISO(),
        },
      ],
      debts: [
        {
          id: "d1",
          name: "Prestito",
          type: "prestito",
          residual: 900,
          tan: 0,
          monthlyPayment: 400,
          paymentDay: 1,
          amortize: true,
        },
      ],
    });
    const f = forecastLiquidity(data, 4);
    expect(f.start).toBe(1000);
    expect(f.variableMonthly).toBe(0);
    // rate: 400, 400, 100, 0 (estinto) — entrate 2000 costanti
    expect(f.months[0].net).toBeCloseTo(2000 - 400);
    expect(f.months[1].net).toBeCloseTo(2000 - 400);
    expect(f.months[2].net).toBeCloseTo(2000 - 100);
    expect(f.months[3].net).toBeCloseTo(2000);
    expect(f.months[3].balance).toBeCloseTo(1000 + 2000 * 4 - 900);
    expect(f.firstNegative).toBeNull();
  });

  it("segnala il primo mese sotto zero", () => {
    const data = emptyData({
      accounts: [{ id: "c", name: "Conto", type: "contanti", balance: 500 }],
      recurring: [
        {
          id: "r1",
          description: "Affitto",
          category: "Casa",
          amount: 300,
          type: "uscita",
          cadence: "mensile",
          day: 1,
          active: true,
          startDate: todayISO(),
        },
      ],
    });
    const f = forecastLiquidity(data, 6);
    expect(f.firstNegative).toBe(shiftedMonthKey(2)); // 500 − 300×2 < 0 al 2° mese
  });
});
