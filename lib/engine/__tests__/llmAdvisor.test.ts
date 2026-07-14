import { describe, expect, it } from "vitest";
import { buildFinancialSummary, parseLlmAdvice } from "../llmAdvisor";
import { computeDerived } from "../state";
import { generateDemoData } from "../../demo";
import { DEFAULT_TAX_STATE } from "../../defaults";
import type { FinancialData } from "../../types";

function demoFinancialData(): FinancialData {
  const demo = generateDemoData(new Date(2026, 6, 13));
  return {
    settings: demo.settings,
    accounts: demo.accounts,
    assets: demo.assets,
    assetTransactions: demo.assetTransactions,
    debts: demo.debts,
    incomes: demo.incomes,
    expenses: demo.expenses,
    subscriptions: demo.subscriptions,
    recurring: demo.recurring,
    goals: demo.goals,
    calendarItems: demo.calendarItems,
    snapshots: demo.snapshots,
    taxState: { ...DEFAULT_TAX_STATE },
  };
}

describe("parseLlmAdvice", () => {
  it("estrae l'array JSON pulito", () => {
    const out = parseLlmAdvice(
      '[{"title":"Titolo","body":"Corpo **123 €**","action":"Fai X","severity":"warn"}]'
    );
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Titolo");
    expect(out[0].severity).toBe("warn");
    expect(out[0].action).toBe("Fai X");
  });

  it("tollera fence markdown e testo attorno", () => {
    const out = parseLlmAdvice(
      'Ecco le analisi:\n```json\n[{"title":"A","body":"B","severity":"ok"}]\n```\nSpero aiutino!'
    );
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe("ok");
  });

  it("normalizza severity sconosciute a warn e taglia a 4 voci", () => {
    const many = JSON.stringify(
      Array.from({ length: 6 }, (_, i) => ({ title: `T${i}`, body: "b", severity: "boh" }))
    );
    const out = parseLlmAdvice(many);
    expect(out).toHaveLength(4);
    expect(out.every((a) => a.severity === "warn")).toBe(true);
  });

  it("scarta voci malformate e lancia senza array", () => {
    const out = parseLlmAdvice('[{"title":"ok","body":"b"},{"nope":1}]');
    expect(out).toHaveLength(1);
    expect(() => parseLlmAdvice("nessun json qui")).toThrow();
  });
});

describe("buildFinancialSummary", () => {
  const data = demoFinancialData();
  const derived = computeDerived(data);
  const summary = buildFinancialSummary(data, derived) as Record<string, unknown>;
  const json = JSON.stringify(summary);

  it("contiene i numeri chiave", () => {
    const patrimonio = summary.patrimonio as { netto: number; debiti: number };
    expect(patrimonio.netto).toBeGreaterThan(0);
    expect(patrimonio.debiti).toBe(4800);
    expect(Object.keys(summary.allocazionePct as object).length).toBeGreaterThan(1);
    expect((summary.obiettivi as unknown[]).length).toBe(2);
  });

  it("non contiene dati sensibili non necessari", () => {
    // niente descrizioni dei movimenti, nomi dei conti o chiavi
    expect(json).not.toContain("Spesa Esselunga");
    expect(json).not.toContain("Conto principale");
    expect(json).not.toContain("aiApiKey");
    expect(json).not.toContain("syncId");
    expect(json).not.toContain("walletAddress");
  });
});
