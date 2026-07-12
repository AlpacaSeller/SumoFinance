import { describe, expect, it } from "vitest";
import { applyTransactions } from "../transactions";
import { assetFlows } from "../xirr";
import { goalEffectiveSaved } from "../aggregates";
import type { Account, Asset, AssetTransaction } from "../../types";

const asset = (over: Partial<Asset> = {}): Asset => ({
  id: "a1",
  name: "ETF Test",
  assetClass: "ETF",
  quantity: 10,
  avgCost: 100,
  baseQuantity: 10,
  baseAvgCost: 100,
  baseDate: "2025-01-01",
  currentPrice: 120,
  priceSource: "manuale",
  taxRegime: "standard",
  ...over,
});

const tx = (over: Partial<AssetTransaction>): AssetTransaction => ({
  id: Math.random().toString(36).slice(2),
  assetId: "a1",
  type: "acquisto",
  date: "2025-06-01",
  quantity: 1,
  unitPrice: 100,
  fees: 0,
  createdAt: "2025-06-01T10:00:00Z",
  ...over,
});

describe("frazionamento (split)", () => {
  it("moltiplica la quantità e divide il PMC (capitale invariato)", () => {
    const { position } = applyTransactions(asset(), [
      tx({ type: "frazionamento", quantity: 10, unitPrice: 0 }),
    ]);
    expect(position.quantity).toBe(100);
    expect(position.avgCost).toBeCloseTo(10);
    expect(position.quantity * position.avgCost).toBeCloseTo(1000); // invariato
  });

  it("reverse split con fattore < 1", () => {
    const { position } = applyTransactions(asset(), [
      tx({ type: "frazionamento", quantity: 0.1, unitPrice: 0 }),
    ]);
    expect(position.quantity).toBeCloseTo(1);
    expect(position.avgCost).toBeCloseTo(1000);
  });

  it("le vendite dopo lo split usano il PMC corretto", () => {
    const { realized } = applyTransactions(asset(), [
      tx({ id: "s", type: "frazionamento", quantity: 10, unitPrice: 0, date: "2025-06-01" }),
      tx({ id: "v", type: "vendita", quantity: 50, unitPrice: 15, date: "2025-07-01" }),
    ]);
    // PMC post split = 10 → gain = 50 × (15 − 10) = 250
    expect(realized[0].gain).toBeCloseTo(250);
  });
});

describe("dividendo", () => {
  it("non tocca la posizione né il realizzato", () => {
    const { position, realized } = applyTransactions(asset(), [
      tx({ type: "dividendo", quantity: 1, unitPrice: 24.35 }),
    ]);
    expect(position.quantity).toBe(10);
    expect(position.avgCost).toBe(100);
    expect(realized).toHaveLength(0);
  });

  it("entra nei flussi XIRR come incasso", () => {
    const res = assetFlows(
      asset(),
      [tx({ type: "dividendo", quantity: 1, unitPrice: 24.35, date: "2025-06-01" })],
      "2026-01-01"
    );
    expect(res.computable).toBe(true);
    const dividend = res.flows.find((f) => f.date === "2025-06-01");
    expect(dividend?.amount).toBeCloseTo(24.35);
  });

  it("lo split non genera flussi di cassa", () => {
    const res = assetFlows(
      asset(),
      [tx({ type: "frazionamento", quantity: 10, unitPrice: 0, date: "2025-06-01" })],
      "2026-01-01"
    );
    expect(res.flows.filter((f) => f.date === "2025-06-01")).toHaveLength(0);
  });
});

describe("obiettivi collegati a un conto", () => {
  const accounts: Account[] = [
    { id: "c1", name: "Deposito", type: "conto corrente", balance: 1200 },
    { id: "c2", name: "USD", type: "conto corrente", balance: 1000, currency: "USD", eurRate: 0.9 },
  ];
  it("il versato segue il saldo del conto (limitato al target)", () => {
    expect(
      goalEffectiveSaved({ saved: 0, target: 3000, linkedAccountId: "c1" }, accounts)
    ).toBe(1200);
    expect(
      goalEffectiveSaved({ saved: 0, target: 1000, linkedAccountId: "c1" }, accounts)
    ).toBe(1000); // cap al target
    // conto in valuta: convertito in EUR
    expect(
      goalEffectiveSaved({ saved: 0, target: 3000, linkedAccountId: "c2" }, accounts)
    ).toBe(900);
  });
  it("senza collegamento resta il campo manuale", () => {
    expect(goalEffectiveSaved({ saved: 250, target: 3000 }, accounts)).toBe(250);
    // conto eliminato → fallback al manuale
    expect(
      goalEffectiveSaved({ saved: 250, target: 3000, linkedAccountId: "sparito" }, accounts)
    ).toBe(250);
  });
});
