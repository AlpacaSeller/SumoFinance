import { describe, expect, it } from "vitest";
import { applyRules, fingerprint, mapRows, parseCsv } from "../csv";
import { parseItAmount, parseItDate } from "../format";
import type { ImportRule } from "../types";

describe("parsing importi it-IT", () => {
  it("gestisce virgola decimale e punto migliaia", () => {
    expect(parseItAmount("1.234,56")).toBeCloseTo(1234.56);
    expect(parseItAmount("-45,90")).toBeCloseTo(-45.9);
    expect(parseItAmount("1234.56")).toBeCloseTo(1234.56);
    expect(parseItAmount("12,00 €")).toBeCloseTo(12);
    expect(parseItAmount("abc")).toBeNull();
    // punto come separatore delle migliaia (solo gruppi di 3)
    expect(parseItAmount("220.000")).toBe(220000);
    expect(parseItAmount("1.300.000")).toBe(1300000);
    expect(parseItAmount("-5.000")).toBe(-5000);
    expect(parseItAmount("220.50")).toBeCloseTo(220.5); // decimale, non migliaia
  });
});

describe("parsing date italiane", () => {
  it("gg/mm/aaaa → ISO", () => {
    expect(parseItDate("05/03/2026")).toBe("2026-03-05");
    expect(parseItDate("5-3-26")).toBe("2026-03-05");
    expect(parseItDate("2026-03-05")).toBe("2026-03-05");
    expect(parseItDate("35/13/2026")).toBeNull();
  });
});

describe("fingerprint (deduplica)", () => {
  it("normalizza spazi e maiuscole", () => {
    expect(fingerprint("2026-07-01", -45.9, "  ESSELUNGA   Milano ")).toBe(
      fingerprint("2026-07-01", -45.9, "esselunga milano")
    );
    expect(fingerprint("2026-07-01", -45.9, "a")).not.toBe(fingerprint("2026-07-02", -45.9, "a"));
  });
});

describe("parse + mappatura CSV stile estratto conto italiano", () => {
  const csv = `Data;Descrizione;Importo
05/07/2026;PAGAMENTO POS ESSELUNGA MILANO;-45,90
06/07/2026;BONIFICO STIPENDIO LUGLIO;1.850,00
07/07/2026;Q8 CARBURANTE;-60,00`;

  it("rileva il separatore ; e mappa con segno", () => {
    const parsed = parseCsv(csv);
    expect(parsed.headers).toEqual(["Data", "Descrizione", "Importo"]);
    expect(parsed.rows).toHaveLength(3);
    const mapped = mapRows(
      parsed.rows,
      { dateCol: "Data", descCol: "Descrizione", amountCol: "Importo" },
      "signed"
    );
    expect(mapped[0]).toMatchObject({ date: "2026-07-05", amount: -45.9, valid: true });
    expect(mapped[1]).toMatchObject({ date: "2026-07-06", amount: 1850, valid: true });
  });

  it("gestisce la convenzione dare/avere", () => {
    const dc = `Data,Causale,Dare,Avere
05/07/2026,SPESA,"45,90",
06/07/2026,ACCREDITO,,"1.850,00"`;
    const parsed = parseCsv(dc);
    const mapped = mapRows(
      parsed.rows,
      { dateCol: "Data", descCol: "Causale", debitCol: "Dare", creditCol: "Avere" },
      "debitCredit"
    );
    expect(mapped[0].amount).toBeCloseTo(-45.9);
    expect(mapped[1].amount).toBeCloseTo(1850);
  });
});

describe("regole di categorizzazione", () => {
  const rules: ImportRule[] = [
    { id: "1", pattern: "ESSELUNGA", category: "Cibo", type: "uscita", active: true },
    { id: "2", pattern: "stipendio", category: "Stipendio", type: "entrata", active: true },
    { id: "3", pattern: "Q8", category: "Auto", type: "entrambi", active: false },
  ];
  it("matcha case-insensitive rispettando tipo e flag attiva", () => {
    expect(applyRules("Pagamento POS Esselunga", false, rules)).toBe("Cibo");
    expect(applyRules("Pagamento POS Esselunga", true, rules)).toBeNull();
    expect(applyRules("BONIFICO STIPENDIO", true, rules)).toBe("Stipendio");
    expect(applyRules("Q8 CARBURANTE", false, rules)).toBeNull(); // regola disattivata
  });
});
