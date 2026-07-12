import { describe, expect, it } from "vitest";
import { erc20BalanceOfData, hexToUnits } from "../prices/wallet";
import { buildMonthlyReport } from "../engine/monthlyReport";
import { shiftedMonthKey } from "../format";
import type { Expense, FinancialData, Income } from "../types";
import { DEFAULT_SETTINGS, DEFAULT_TAX_STATE } from "../defaults";

describe("wallet: parsing on-chain", () => {
  it("hexToUnits: wei → ETH con precisione", () => {
    expect(hexToUnits("0xde0b6b3a7640000", 18)).toBeCloseTo(1); // 1 ETH
    expect(hexToUnits("0x1bc16d674ec80000", 18)).toBeCloseTo(2);
    expect(hexToUnits("0x0", 18)).toBe(0);
    // 1.234567 USDC (6 decimali)
    expect(hexToUnits("0x12d687", 6)).toBeCloseTo(1.234567);
    // valori enormi senza overflow: 1.000.000 ETH
    expect(hexToUnits("0xd3c21bcecceda1000000", 18)).toBeCloseTo(1_000_000);
    expect(hexToUnits("garbage", 18)).toBe(0);
  });

  it("erc20BalanceOfData: selector + indirizzo paddato", () => {
    const data = erc20BalanceOfData("0xAbC0000000000000000000000000000000000123");
    expect(data).toBe(
      "0x70a08231" + "000000000000000000000000abc0000000000000000000000000000000000123"
    );
    expect(data.length).toBe(2 + 8 + 64);
  });
});

describe("report mensile", () => {
  const lastMonth = shiftedMonthKey(-1);
  const twoAgo = shiftedMonthKey(-2);

  const income = (key: string, amount: number): Income => ({
    id: `i-${key}-${amount}`,
    description: "Stipendio",
    category: "Stipendio",
    amount,
    date: `${key}-05`,
  });
  const expense = (key: string, amount: number, category = "Cibo", description = "Spesa"): Expense => ({
    id: `e-${key}-${amount}-${category}`,
    description,
    category,
    amount,
    date: `${key}-10`,
  });

  const data = (over: Partial<FinancialData>): FinancialData => ({
    settings: { ...DEFAULT_SETTINGS },
    accounts: [],
    assets: [],
    assetTransactions: [],
    debts: [],
    incomes: [],
    expenses: [],
    subscriptions: [],
    recurring: [],
    goals: [],
    calendarItems: [],
    snapshots: [],
    taxState: { ...DEFAULT_TAX_STATE },
    ...over,
  });

  it("null se il mese scorso non ha movimenti", () => {
    expect(buildMonthlyReport(data({}))).toBeNull();
  });

  it("calcola risparmio, top categoria e sforamenti vs media", () => {
    const d = data({
      incomes: [income(lastMonth, 2000), income(twoAgo, 2000)],
      expenses: [
        expense(lastMonth, 800, "Cibo"),
        expense(lastMonth, 300, "Auto", "Benzina"),
        expense(twoAgo, 400, "Cibo"),
        expense(twoAgo, 300, "Auto"),
      ],
      snapshots: [
        { id: "s1", date: `${twoAgo}-28`, netWorth: 10000, gross: 10000, liquidity: 10000, investments: 0, debts: 0 },
        { id: "s2", date: `${lastMonth}-27`, netWorth: 10900, gross: 10900, liquidity: 10900, investments: 0, debts: 0 },
      ],
    });
    const r = buildMonthlyReport(d)!;
    expect(r.income).toBe(2000);
    expect(r.expense).toBe(1100);
    expect(r.saved).toBe(900);
    expect(r.savingsRate).toBeCloseTo(0.45);
    expect(r.topCategory).toMatchObject({ name: "Cibo", amount: 800 });
    // Cibo 800 vs media 400 → sforamento; Auto 300 vs 300 → no
    expect(r.overAverage).toHaveLength(1);
    expect(r.overAverage[0]).toMatchObject({ category: "Cibo", average: 400 });
    expect(r.netDelta).toMatchObject({ abs: 900 });
    expect(r.biggestExpense?.amount).toBe(800);
  });
});
