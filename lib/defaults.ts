import type { Settings, TaxState } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  id: "main",
  riskProfile: "bilanciato",
  fireWithdrawalRate: 3.5,
  expectedInflation: 2,
  syncOnOpen: true,
  onboardingDone: false,
  customExpenseCategories: [],
  customIncomeCategories: [],
  budgetOverrides: {},
};

export const DEFAULT_TAX_STATE: TaxState = {
  id: "main",
  realizedGainsYear: 0,
  realizedLossesYear: 0,
  lossPots: [],
};
