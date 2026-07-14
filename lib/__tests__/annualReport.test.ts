import { describe, expect, it } from "vitest";
import { buildAnnualReportHtml } from "../annualReport";
import { generateDemoData } from "../demo";
import { DEFAULT_TAX_STATE } from "../defaults";
import type { FinancialData } from "../types";

describe("report annuale", () => {
  const demo = generateDemoData(new Date(2026, 6, 13));
  const data: FinancialData = {
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
  const html = buildAnnualReportHtml(data, 2026);

  it("contiene le sezioni principali", () => {
    expect(html).toContain("Report annuale 2026");
    expect(html).toContain("Entrate per categoria");
    expect(html).toContain("Uscite per categoria");
    expect(html).toContain("Le 10 spese più grandi");
    expect(html).toContain("Abbonamenti attivi");
    expect(html).toContain("Netflix");
    expect(html).toContain("Stipendio");
  });

  it("le somme quadrano coi movimenti dell'anno", () => {
    const totIn = data.incomes
      .filter((i) => i.date.startsWith("2026"))
      .reduce((s, i) => s + i.amount, 0);
    expect(html).toContain(
      totIn.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    );
  });

  it("un anno senza movimenti produce comunque un documento valido", () => {
    const empty = buildAnnualReportHtml(data, 2019);
    expect(empty).toContain("Report annuale 2019");
    expect(empty).toContain("Nessuna entrata registrata");
  });

  it("le descrizioni sono escapate (niente XSS nel report)", () => {
    const evil: FinancialData = {
      ...data,
      expenses: [
        {
          id: "x",
          description: '<script>alert("xss")</script>',
          category: "Altro",
          amount: 9999,
          date: "2026-05-05",
        },
      ],
    };
    const out = buildAnnualReportHtml(evil, 2026);
    expect(out).not.toContain('<script>alert("xss")</script>');
    expect(out).toContain("&lt;script&gt;");
  });
});
