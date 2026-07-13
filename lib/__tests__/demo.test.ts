import { describe, expect, it } from "vitest";
import { generateDemoData } from "../demo";
import { applyTransactions } from "../engine/transactions";

const TODAY = new Date(2026, 6, 13); // 13 luglio 2026

describe("dati d'esempio (modalità demo)", () => {
  const demo = generateDemoData(TODAY);
  const todayISO = "2026-07-13";

  it("genera una base dati completa e non vuota", () => {
    expect(demo.accounts.length).toBeGreaterThanOrEqual(3);
    expect(demo.assets.length).toBeGreaterThanOrEqual(3);
    expect(demo.incomes.length).toBeGreaterThanOrEqual(8);
    expect(demo.expenses.length).toBeGreaterThan(80); // ~13 uscite/mese × 9 mesi
    expect(demo.subscriptions.length).toBe(3);
    expect(demo.goals.length).toBe(2);
    expect(demo.snapshots.length).toBeGreaterThanOrEqual(8);
    expect(demo.settings.onboardingDone).toBe(true);
    expect(demo.settings.demoMode).toBe(true);
  });

  it("nessun movimento o snapshot nel futuro", () => {
    for (const m of [...demo.incomes, ...demo.expenses]) {
      expect(m.date <= todayISO).toBe(true);
    }
    for (const s of demo.snapshots) expect(s.date <= todayISO).toBe(true);
  });

  it("i sourceRef combaciano col formato idempotente del motore ricorrenti", () => {
    const refs = [...demo.incomes, ...demo.expenses]
      .map((m) => m.sourceRef)
      .filter((r): r is string => Boolean(r));
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) {
      expect(r).toMatch(/^(rec|sub|debt):[^:]+:\d{4}-\d{2}$/);
    }
    // ogni ricorrente/abbonamento ha riferimenti generati per il suo id
    for (const rec of demo.recurring) {
      expect(refs.some((r) => r.startsWith(`rec:${rec.id}:`))).toBe(true);
    }
    for (const sub of demo.subscriptions) {
      expect(refs.some((r) => r.startsWith(`sub:${sub.id}:`))).toBe(true);
    }
  });

  it("posizioni asset coerenti col motore delle operazioni", () => {
    for (const asset of demo.assets) {
      const txs = demo.assetTransactions.filter((t) => t.assetId === asset.id);
      const { position } = applyTransactions(asset, txs);
      expect(position.quantity).toBeCloseTo(asset.quantity, 6);
      expect(position.avgCost).toBeCloseTo(asset.avgCost, 2);
    }
  });

  it("è deterministica (stesso seed → stessi numeri)", () => {
    const again = generateDemoData(TODAY);
    expect(again.expenses.map((e) => e.amount)).toEqual(demo.expenses.map((e) => e.amount));
    expect(again.snapshots.map((s) => s.netWorth)).toEqual(demo.snapshots.map((s) => s.netWorth));
  });

  it("l'obiettivo collegato punta a un conto esistente", () => {
    const linked = demo.goals.find((g) => g.linkedAccountId);
    expect(linked).toBeDefined();
    expect(demo.accounts.some((a) => a.id === linked?.linkedAccountId)).toBe(true);
  });
});
