import { describe, expect, it } from "vitest";
import { detectSubscriptionCandidates } from "../recurring";
import type { Expense, Subscription } from "../../types";

const spesa = (description: string, amount: number, date: string, over: Partial<Expense> = {}): Expense => ({
  id: Math.random().toString(36).slice(2),
  description,
  category: "Abbonamenti",
  amount,
  date,
  source: "import",
  ...over,
});

describe("detectSubscriptionCandidates", () => {
  const netflix = [
    spesa("Netflix.com", 13.99, "2026-04-08"),
    spesa("Netflix.com", 13.99, "2026-05-08"),
    spesa("Netflix.com", 13.99, "2026-06-08"),
  ];

  it("riconosce un addebito mensile costante", () => {
    const out = detectSubscriptionCandidates(netflix, [], []);
    expect(out).toHaveLength(1);
    expect(out[0].description).toBe("Netflix.com");
    expect(out[0].amount).toBeCloseTo(13.99);
    expect(out[0].day).toBe(8);
  });

  it("ignora chi è già un abbonamento (stesso nome normalizzato)", () => {
    const subs: Subscription[] = [
      { id: "s", name: "netflix.com", amount: 13.99, cadence: "mensile", active: true, chargeDay: 8, startDate: "2026-01-01" },
    ];
    expect(detectSubscriptionCandidates(netflix, subs, [])).toHaveLength(0);
  });

  it("ignora i movimenti generati automaticamente", () => {
    const auto = netflix.map((e) => ({ ...e, source: "auto" as const, sourceRef: "sub:x:2026-05" }));
    expect(detectSubscriptionCandidates(auto, [], [])).toHaveLength(0);
  });

  it("scarta importi incoerenti (spesa variabile, non abbonamento)", () => {
    const spese = [
      spesa("Esselunga", 82.4, "2026-04-08"),
      spesa("Esselunga", 55.1, "2026-05-08"),
      spesa("Esselunga", 104.9, "2026-06-08"),
    ];
    expect(detectSubscriptionCandidates(spese, [], [])).toHaveLength(0);
  });

  it("servono almeno 3 mesi distinti", () => {
    expect(detectSubscriptionCandidates(netflix.slice(0, 2), [], [])).toHaveLength(0);
  });
});
