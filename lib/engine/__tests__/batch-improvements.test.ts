import { describe, expect, it } from "vitest";
import { detectRecurringCandidates } from "../recurring";
import { computeBudgets } from "../budget";
import { accountEurBalance, liquidityTotal } from "../aggregates";
import { positionAtDate, reconstructPortfolioHistory } from "../portfolioHistory";
import { shiftedMonthKey } from "../../format";
import type { Account, Asset, AssetTransaction, Expense, RecurringTransaction } from "../../types";
import type { PricePoint } from "../benchmark";

describe("multi-valuta conti", () => {
  it("converte in EUR con il cambio in cache", () => {
    const eur: Account = { id: "1", name: "EUR", type: "conto corrente", balance: 1000 };
    const usd: Account = {
      id: "2",
      name: "USD",
      type: "conto corrente",
      balance: 1000,
      currency: "USD",
      eurRate: 0.9,
    };
    expect(accountEurBalance(eur)).toBe(1000);
    expect(accountEurBalance(usd)).toBe(900);
    expect(liquidityTotal([eur, usd])).toBe(1900);
    // senza eurRate: nessuna conversione (fallback 1)
    expect(accountEurBalance({ ...usd, eurRate: undefined })).toBe(1000);
  });
});

describe("rilevamento ricorrenti", () => {
  const mk = (desc: string, amount: number, key: string): Expense => ({
    id: `${desc}-${key}`,
    description: desc,
    category: "Abbonamenti",
    amount,
    date: `${key}-15`,
  });
  it("propone chi compare in ≥3 mesi con importo coerente", () => {
    const movements = [
      mk("NETFLIX", 12.99, shiftedMonthKey(-1)),
      mk("NETFLIX", 12.99, shiftedMonthKey(-2)),
      mk("NETFLIX", 13.99, shiftedMonthKey(-3)),
      mk("Spesa varia", 40, shiftedMonthKey(-1)), // solo 1 mese
    ];
    const cands = detectRecurringCandidates(movements, "uscita", []);
    expect(cands).toHaveLength(1);
    expect(cands[0].description).toBe("NETFLIX");
    expect(cands[0].months).toBe(3);
    expect(cands[0].amount).toBeCloseTo(12.99);
  });
  it("esclude importi troppo variabili e i già ricorrenti", () => {
    const variable = [
      mk("BOLLETTA", 50, shiftedMonthKey(-1)),
      mk("BOLLETTA", 200, shiftedMonthKey(-2)),
      mk("BOLLETTA", 90, shiftedMonthKey(-3)),
    ];
    expect(detectRecurringCandidates(variable, "uscita", [])).toHaveLength(0);

    const stable = [
      mk("AFFITTO", 700, shiftedMonthKey(-1)),
      mk("AFFITTO", 700, shiftedMonthKey(-2)),
      mk("AFFITTO", 700, shiftedMonthKey(-3)),
    ];
    const existing: RecurringTransaction[] = [
      {
        id: "r",
        description: "affitto",
        category: "Casa",
        amount: 700,
        type: "uscita",
        cadence: "mensile",
        day: 1,
        active: true,
        startDate: "2026-01-01",
      },
    ];
    expect(detectRecurringCandidates(stable, "uscita", existing)).toHaveLength(0);
  });
});

describe("budget rollover", () => {
  const mk = (amount: number, key: string): Expense => ({
    id: `${key}-${amount}`,
    description: "x",
    category: "Cibo",
    amount,
    date: `${key}-10`,
  });
  it("riporta il non speso del mese scorso quando attivo", () => {
    // media 3 mesi = 300; mese scorso speso 200 → rollover 100
    const expenses = [
      mk(300, shiftedMonthKey(-1)),
      mk(300, shiftedMonthKey(-2)),
      mk(300, shiftedMonthKey(-3)),
    ];
    // sovrascrivo il mese scorso a 200 per creare un residuo
    expenses[0] = mk(200, shiftedMonthKey(-1));
    const off = computeBudgets(expenses, ["Cibo"], {}, false).find((b) => b.category === "Cibo")!;
    const on = computeBudgets(expenses, ["Cibo"], {}, true).find((b) => b.category === "Cibo")!;
    // base = (200+300+300)/3 ≈ 266.67; rollover = max(0, base - 200)
    expect(off.rollover).toBe(0);
    expect(on.rollover).toBeCloseTo(on.baseBudget - 200);
    expect(on.budget).toBeCloseTo(on.baseBudget + on.rollover);
  });
});

describe("ricostruzione valore investimenti", () => {
  const ts = (iso: string) => new Date(iso + "T12:00:00").getTime();
  const asset: Asset = {
    id: "a1",
    name: "ETF",
    assetClass: "ETF",
    quantity: 10,
    avgCost: 100,
    baseQuantity: 10,
    baseAvgCost: 100,
    baseDate: "2025-08-01",
    currentPrice: 130,
    priceSource: "yahoo",
    symbol: "TEST.MI",
    taxRegime: "standard",
  };

  it("positionAtDate: 0 prima della data di carico, poi la posizione", () => {
    expect(positionAtDate(asset, [], "2025-07-01").quantity).toBe(0);
    expect(positionAtDate(asset, [], "2025-09-01").quantity).toBe(10);
  });

  it("positionAtDate applica solo le operazioni fino alla data", () => {
    const txs: AssetTransaction[] = [
      {
        id: "t1",
        assetId: "a1",
        type: "acquisto",
        date: "2025-10-01",
        quantity: 5,
        unitPrice: 120,
        fees: 0,
        createdAt: "2025-10-01T10:00:00Z",
      },
    ];
    expect(positionAtDate(asset, txs, "2025-09-15").quantity).toBe(10);
    expect(positionAtDate(asset, txs, "2025-10-15").quantity).toBe(15);
  });

  it("ricostruisce il valore da prezzi storici ed esclude gli asset senza storico", () => {
    const history = new Map<string, PricePoint[]>([
      [
        "TEST.MI",
        [
          { t: ts("2025-08-15"), p: 100 },
          { t: ts("2025-12-15"), p: 120 },
        ],
      ],
    ]);
    const manual: Asset = {
      ...asset,
      id: "a2",
      name: "Casa BTP",
      symbol: undefined,
      priceSource: "manuale",
    };
    const res = reconstructPortfolioHistory([asset, manual], [], history, "2026-01-10", 6);
    expect(res.includedAssets).toEqual(["ETF"]);
    expect(res.excludedAssets).toEqual(["Casa BTP"]);
    expect(res.points).toHaveLength(6);
    // il mese corrente usa il prezzo attuale (130) × 10 = 1300
    expect(res.points[res.points.length - 1].value).toBeCloseTo(1300);
    // un mese storico usa il prezzo storico (≤ data)
    const dec = res.points.find((p) => p.key === "2025-12");
    expect(dec?.value).toBeCloseTo(1200);
  });
});
