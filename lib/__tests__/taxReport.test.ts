import { describe, expect, it } from "vitest";
import { bolloEstimate, buildTaxCsv, buildTaxReportHtml } from "../taxReport";
import type { Asset } from "../types";
import type { RealizedEvent } from "../engine/transactions";
import { DEFAULT_TAX_STATE } from "../defaults";

const asset = (over: Partial<Asset> = {}): Asset => ({
  id: "a1",
  name: "ETF; Mondo",
  assetClass: "ETF",
  quantity: 10,
  avgCost: 100,
  currentPrice: 120,
  priceSource: "manuale",
  taxRegime: "standard",
  ...over,
});

const event = (over: Partial<RealizedEvent> = {}): RealizedEvent => ({
  txId: "t1",
  assetId: "a1",
  date: "2026-03-10",
  createdAt: "2026-03-10T10:00:00Z",
  year: 2026,
  quantity: 5,
  gain: 92.5,
  taxRate: 0.26,
  ...over,
});

describe("CSV fiscale", () => {
  it("intestazione, BOM, numeri it-IT e campi con ; quotati", () => {
    const csv = buildTaxCsv([event()], [asset()]);
    expect(csv.charCodeAt(0)).toBe(0xfeff); // BOM per Excel
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe("Data;Asset;Quantità venduta;Risultato (€);Tipo;Aliquota (%);Anno");
    expect(lines[1]).toContain('"ETF; Mondo"'); // nome con ; → quotato
    expect(lines[1]).toContain("92,50");
    expect(lines[1]).toContain("plusvalenza");
    expect(lines[1]).toContain("26,00");
  });
});

describe("bollo stimato", () => {
  it("0,20% sul valore, immobili esclusi", () => {
    const assets = [
      asset(), // 10 × 120 = 1200
      asset({ id: "casa", assetClass: "Immobili", quantity: 1, currentPrice: 200000 }),
    ];
    expect(bolloEstimate(assets)).toBeCloseTo(1200 * 0.002);
  });
});

describe("report HTML", () => {
  it("contiene KPI, tabella vendite e note metodologiche", () => {
    const html = buildTaxReportHtml({
      year: 2026,
      events: [event(), event({ txId: "t2", year: 2025, gain: -50 })],
      assets: [asset()],
      computed: {
        currentYear: { gains: 92.5, losses: 0 },
        autoPots: [{ year: 2025, amount: 50 }],
        compensatedThisYear: 50,
        estimatedTaxDue: 11.05,
      },
      taxState: { ...DEFAULT_TAX_STATE },
      latentTax: 52,
      realizedYear: { gains: 92.5, losses: 0 },
    });
    expect(html).toContain("Report fiscale 2026");
    expect(html).toContain("92,50");
    expect(html).toContain("ETF; Mondo".replace(";", ";")); // nome presente
    expect(html).toContain("Zainetto fiscale residuo");
    expect(html).toContain("31/12/2029"); // scadenza pot 2025
    expect(html).toContain("costo medio ponderato");
    // solo le vendite dell'anno nel dettaglio
    expect((html.match(/<tr>/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});
