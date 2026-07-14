import { describe, expect, it } from "vitest";
import { approxYtm, bondEvents } from "../bonds";
import { upcomingItems } from "../calendar";
import type { Asset } from "../../types";

const btp = (over: Partial<Asset> = {}): Asset => ({
  id: "b1",
  name: "BTP Tf 3,85% Lg34",
  assetClass: "Obbligazioni",
  quantity: 100, // 10.000 € nominali
  avgCost: 98.5,
  currentPrice: 97,
  priceSource: "manuale",
  taxRegime: "whitelist",
  maturityDate: "2034-07-01",
  couponRate: 3.85,
  couponFrequency: "semestrale",
  ...over,
});

describe("bondEvents", () => {
  it("cedole semestrali ancorate alla scadenza, importo = quantità × cedola / 2", () => {
    const ev = bondEvents(btp(), "2026-06-01", "2027-06-30");
    expect(ev.map((e) => e.date)).toEqual(["2026-07-01", "2027-01-01"]);
    // 100 lotti × 3,85 = 385 €/anno → 192,50 a cedola
    expect(ev[0].amount).toBeCloseTo(192.5);
    expect(ev.every((e) => !e.isMaturity)).toBe(true);
  });

  it("alla scadenza: rimborso del nominale + ultima cedola", () => {
    const ev = bondEvents(btp(), "2034-06-01", "2034-08-01");
    expect(ev).toHaveLength(1);
    expect(ev[0].isMaturity).toBe(true);
    expect(ev[0].amount).toBeCloseTo(10000 + 192.5);
  });

  it("frequenza annuale: una cedola l'anno, importo pieno", () => {
    const ev = bondEvents(btp({ couponFrequency: "annuale" }), "2026-01-01", "2027-12-31");
    expect(ev.map((e) => e.date)).toEqual(["2026-07-01", "2027-07-01"]);
    expect(ev[0].amount).toBeCloseTo(385);
  });

  it("senza scadenza o cedola: nessun evento", () => {
    expect(bondEvents(btp({ maturityDate: undefined }), "2026-01-01", "2030-01-01")).toHaveLength(0);
    expect(bondEvents(btp({ couponRate: 0 }), "2026-01-01", "2030-01-01")).toHaveLength(0);
  });
});

describe("approxYtm", () => {
  it("sotto la pari il rendimento supera la cedola", () => {
    const y = approxYtm(btp({ currentPrice: 97 }), "2026-07-14");
    expect(y).not.toBeNull();
    expect((y ?? 0) * 100).toBeGreaterThan(3.85);
  });

  it("alla pari il rendimento ≈ cedola", () => {
    const y = approxYtm(btp({ currentPrice: 100 }), "2026-07-14");
    expect((y ?? 0) * 100).toBeCloseTo(3.85, 1);
  });

  it("null senza piano o a scadenza passata", () => {
    expect(approxYtm(btp({ maturityDate: undefined }), "2026-07-14")).toBeNull();
    expect(approxYtm(btp({ maturityDate: "2026-07-15" }), "2026-07-14")).toBeNull();
  });
});

describe("integrazione calendario", () => {
  it("le cedole compaiono tra le voci in arrivo", () => {
    const items = upcomingItems([], [], [], 90, "2026-06-15", [btp()]);
    const cedola = items.find((x) => x.id.startsWith("bond:"));
    expect(cedola).toBeDefined();
    expect(cedola?.date).toBe("2026-07-01");
    expect(cedola?.title).toContain("Cedola");
    expect(cedola?.amount).toBeCloseTo(192.5);
  });
});
