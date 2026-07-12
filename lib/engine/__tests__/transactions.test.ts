import { describe, expect, it } from "vitest";
import {
  allRealizedEvents,
  applyTransactions,
  computeTaxFromTransactions,
} from "../transactions";
import { monthsToPayoff, payoffMonth, rataSplit } from "../amortization";
import { computeDueMovements } from "../recurring";
import type { Asset, AssetTransaction, Debt } from "../../types";

const asset = (over: Partial<Asset> = {}): Asset => ({
  id: "a1",
  name: "Test",
  assetClass: "ETF",
  quantity: 10,
  avgCost: 100,
  baseQuantity: 10,
  baseAvgCost: 100,
  currentPrice: 120,
  priceSource: "manuale",
  taxRegime: "standard",
  ...over,
});

const tx = (over: Partial<AssetTransaction>): AssetTransaction => ({
  id: Math.random().toString(36).slice(2),
  assetId: "a1",
  type: "acquisto",
  date: "2026-01-10",
  quantity: 1,
  unitPrice: 100,
  fees: 0,
  createdAt: "2026-01-10T10:00:00Z",
  ...over,
});

describe("operazioni: posizione e PMC", () => {
  it("acquisto: PMC medio ponderato con commissioni", () => {
    const { position } = applyTransactions(asset(), [
      tx({ quantity: 10, unitPrice: 120, fees: 10 }),
    ]);
    // (10×100 + 10×120 + 10) / 20 = 110,50
    expect(position.quantity).toBe(20);
    expect(position.avgCost).toBeCloseTo(110.5);
  });

  it("vendita: quantità scende, PMC invariato, plusvalenza al netto commissioni", () => {
    const { position, realized } = applyTransactions(asset(), [
      tx({ type: "vendita", quantity: 4, unitPrice: 130, fees: 5 }),
    ]);
    expect(position.quantity).toBe(6);
    expect(position.avgCost).toBe(100);
    expect(realized).toHaveLength(1);
    expect(realized[0].gain).toBeCloseTo(4 * 30 - 5);
  });

  it("storia completa in ordine cronologico (stesso giorno: createdAt)", () => {
    const txs = [
      tx({ id: "b", date: "2026-02-01", type: "vendita", quantity: 5, unitPrice: 110, createdAt: "2026-02-01T12:00:00Z" }),
      tx({ id: "a", date: "2026-02-01", quantity: 10, unitPrice: 90, createdAt: "2026-02-01T09:00:00Z" }),
    ];
    const { position, realized } = applyTransactions(asset(), txs);
    // prima acquisto (PMC (1000+900)/20 = 95), poi vendita di 5 a 110 → gain 75
    expect(position.quantity).toBe(15);
    expect(realized[0].gain).toBeCloseTo(5 * (110 - 95));
  });

  it("vendita oltre il posseduto: clampata con warning", () => {
    const { position, realized, warnings } = applyTransactions(asset(), [
      tx({ type: "vendita", quantity: 99, unitPrice: 110 }),
    ]);
    expect(position.quantity).toBe(0);
    expect(realized[0].quantity).toBe(10);
    expect(warnings).toHaveLength(1);
  });
});

describe("fisco derivato dalle operazioni", () => {
  it("minusvalenze creano zainetto, plusvalenze lo consumano (prima le più vecchie)", () => {
    const a = asset();
    const events = allRealizedEvents(
      [a],
      [
        // perdita 2024: 10×(80−100) = −200 → zainetto 2024 = 200
        tx({ id: "t1", date: "2024-03-01", type: "vendita", quantity: 10, unitPrice: 80 }),
        // riacquisto
        tx({ id: "t2", date: "2024-04-01", quantity: 10, unitPrice: 80 }),
        // 2026: vendita in utile 10×(95−80) = +150 → compensa 150 dei 200
        tx({ id: "t3", date: "2026-05-01", type: "vendita", quantity: 10, unitPrice: 95 }),
      ]
    );
    const res = computeTaxFromTransactions(events, 2026);
    expect(res.currentYear.gains).toBeCloseTo(150);
    expect(res.compensatedThisYear).toBeCloseTo(150);
    expect(res.estimatedTaxDue).toBe(0);
    expect(res.autoPots).toEqual([{ year: 2024, amount: 50 }]);
  });

  it("plusvalenza non compensata: imposta stimata all'aliquota dell'asset", () => {
    const events = allRealizedEvents(
      [asset()],
      [tx({ id: "t1", date: "2026-05-01", type: "vendita", quantity: 10, unitPrice: 150 })]
    );
    const res = computeTaxFromTransactions(events, 2026);
    expect(res.estimatedTaxDue).toBeCloseTo(500 * 0.26);
  });

  it("le minusvalenze scadute (oltre 4 anni) non compensano e spariscono", () => {
    const events = allRealizedEvents(
      [asset({ baseQuantity: 30 })],
      [
        tx({ id: "t1", date: "2020-06-01", type: "vendita", quantity: 10, unitPrice: 80 }),
        tx({ id: "t2", date: "2026-05-01", type: "vendita", quantity: 10, unitPrice: 150 }),
      ]
    );
    const res = computeTaxFromTransactions(events, 2026);
    expect(res.compensatedThisYear).toBe(0); // il 2020 scadeva il 31/12/2024
    expect(res.autoPots).toEqual([]);
    expect(res.estimatedTaxDue).toBeCloseTo(500 * 0.26);
  });
});

describe("ammortamento (piano francese)", () => {
  it("split rata: interessi = residuo × TAN/12", () => {
    const s = rataSplit(120000, 3, 600);
    expect(s.interest).toBeCloseTo(300);
    expect(s.principal).toBeCloseTo(300);
    expect(s.underwater).toBe(false);
  });
  it("ultima rata ridotta al residuo + interessi", () => {
    const s = rataSplit(100, 3, 600);
    expect(s.principal).toBe(100);
    expect(s.payment).toBeCloseTo(100 + 100 * 0.03 / 12);
  });
  it("rata insufficiente → underwater e payoff null", () => {
    expect(rataSplit(120000, 10, 500).underwater).toBe(true);
    expect(monthsToPayoff(120000, 10, 500)).toBeNull();
  });
  it("mesi all'estinzione: formula chiusa coerente con la simulazione", () => {
    const n = monthsToPayoff(10000, 4, 500)!;
    let residual = 10000;
    let months = 0;
    while (residual > 0 && months < 100) {
      const s = rataSplit(residual, 4, 500);
      residual -= s.principal;
      months++;
    }
    expect(n).toBe(months);
    expect(payoffMonth(0, 4, 500)).toMatch(/^\d{4}-\d{2}$/);
  });

  it("le rate generate scalano il residuo e si fermano a 0", () => {
    const debt: Debt = {
      id: "d1",
      name: "Prestito",
      type: "prestito",
      residual: 1000,
      tan: 0,
      monthlyPayment: 400,
      paymentDay: 1,
      amortize: true,
    };
    // simula 3 mesi consecutivi di aperture: 400 + 400 + 200 (ultima ridotta)
    const refs = new Set<string>();
    let residual = debt.residual;
    const amounts: number[] = [];
    for (const today of ["2026-05-05", "2026-06-05", "2026-07-05", "2026-08-05"]) {
      const res = computeDueMovements([], [], [{ ...debt, residual }], refs, today);
      for (const e of res.expenses) {
        amounts.push(e.amount);
        refs.add(e.sourceRef!);
      }
      if (res.debtUpdates.length > 0) residual = res.debtUpdates[0].residual;
    }
    expect(amounts).toEqual([400, 400, 200]);
    expect(residual).toBe(0);
    // idempotenza: riaprire nello stesso mese non genera nulla
    const again = computeDueMovements([], [], [{ ...debt, residual }], refs, "2026-08-06");
    expect(again.expenses).toHaveLength(0);
    expect(again.debtUpdates).toHaveLength(0);
  });

  it("con TAN > 0 la quota capitale cresce nel tempo", () => {
    const debt: Debt = {
      id: "d2",
      name: "Mutuo",
      type: "mutuo",
      residual: 100000,
      tan: 3,
      monthlyPayment: 600,
      paymentDay: 1,
      amortize: true,
    };
    const res = computeDueMovements([], [], [debt], new Set(), "2026-06-11");
    // aprile? no: mese corrente = giugno, prima rata 2026-06-01 soltanto? start = 1° mese corrente
    expect(res.expenses).toHaveLength(1);
    expect(res.expenses[0].amount).toBeCloseTo(600);
    // residuo sceso della quota capitale: 600 − 250 (interessi) = 350
    expect(res.debtUpdates[0].residual).toBeCloseTo(100000 - 350, 1);
    expect(res.expenses[0].description).toContain("capitale");
  });
});
