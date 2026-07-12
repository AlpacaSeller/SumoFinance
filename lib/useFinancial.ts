"use client";

// ── Hook centrale: dati grezzi reattivi + stato derivato ────────────────────
// Le pagine leggono lo store solo da qui, dopo il mount (niente hydration
// mismatch: i dati esistono solo nel browser).

import { useMemo } from "react";
import { useTable } from "./storage";
import { DEFAULT_SETTINGS, DEFAULT_TAX_STATE } from "./defaults";
import type {
  Account,
  Asset,
  AssetTransaction,
  CalendarItem,
  Debt,
  Expense,
  FinancialData,
  Goal,
  Income,
  RecurringTransaction,
  Settings,
  Snapshot,
  Subscription,
  TaxState,
} from "./types";
import { computeDerived, type DerivedState } from "./engine/state";

export interface Financial {
  ready: boolean;
  data: FinancialData;
  derived: DerivedState;
}

export function useFinancial(): Financial {
  const settings = useTable<Settings>("settings");
  const accounts = useTable<Account>("accounts");
  const assets = useTable<Asset>("assets");
  const assetTransactions = useTable<AssetTransaction>("assetTransactions");
  const debts = useTable<Debt>("debts");
  const incomes = useTable<Income>("incomes");
  const expenses = useTable<Expense>("expenses");
  const subscriptions = useTable<Subscription>("subscriptions");
  const recurring = useTable<RecurringTransaction>("recurringTransactions");
  const goals = useTable<Goal>("goals");
  const calendarItems = useTable<CalendarItem>("calendarItems");
  const snapshots = useTable<Snapshot>("snapshots");
  const taxState = useTable<TaxState>("taxState");

  const ready =
    settings !== undefined &&
    accounts !== undefined &&
    assets !== undefined &&
    assetTransactions !== undefined &&
    debts !== undefined &&
    incomes !== undefined &&
    expenses !== undefined &&
    subscriptions !== undefined &&
    recurring !== undefined &&
    goals !== undefined &&
    calendarItems !== undefined &&
    snapshots !== undefined &&
    taxState !== undefined;

  const data: FinancialData = useMemo(
    () => ({
      settings: settings?.find((s) => s.id === "main") ?? { ...DEFAULT_SETTINGS },
      accounts: accounts ?? [],
      assets: assets ?? [],
      assetTransactions: assetTransactions ?? [],
      debts: debts ?? [],
      incomes: incomes ?? [],
      expenses: expenses ?? [],
      subscriptions: subscriptions ?? [],
      recurring: recurring ?? [],
      goals: goals ?? [],
      calendarItems: calendarItems ?? [],
      snapshots: snapshots ?? [],
      taxState: taxState?.find((t) => t.id === "main") ?? { ...DEFAULT_TAX_STATE },
    }),
    [
      settings,
      accounts,
      assets,
      assetTransactions,
      debts,
      incomes,
      expenses,
      subscriptions,
      recurring,
      goals,
      calendarItems,
      snapshots,
      taxState,
    ]
  );

  const derived = useMemo(() => computeDerived(data), [data]);

  return { ready, data, derived };
}
