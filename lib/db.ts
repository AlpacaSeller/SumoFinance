// ── Schema Dexie (IndexedDB) ────────────────────────────────────────────────
// Questo modulo è un dettaglio implementativo di DexieAdapter: il resto
// dell'app non deve importarlo direttamente (usa lib/storage).

import Dexie, { type Table } from "dexie";
import type {
  Account,
  Asset,
  AssetTransaction,
  CalendarItem,
  Debt,
  EconomicEventsCache,
  Expense,
  Goal,
  ImportProfile,
  ImportRule,
  Income,
  PriceHistoryCache,
  RecurringTransaction,
  Settings,
  Snapshot,
  Subscription,
  TaxState,
} from "./types";

export class PfosDB extends Dexie {
  settings!: Table<Settings, string>;
  accounts!: Table<Account, string>;
  assets!: Table<Asset, string>;
  assetTransactions!: Table<AssetTransaction, string>;
  debts!: Table<Debt, string>;
  incomes!: Table<Income, string>;
  expenses!: Table<Expense, string>;
  subscriptions!: Table<Subscription, string>;
  recurringTransactions!: Table<RecurringTransaction, string>;
  importRules!: Table<ImportRule, string>;
  importProfiles!: Table<ImportProfile, string>;
  goals!: Table<Goal, string>;
  calendarItems!: Table<CalendarItem, string>;
  snapshots!: Table<Snapshot, string>;
  economicEventsCache!: Table<EconomicEventsCache, string>;
  taxState!: Table<TaxState, string>;
  priceHistoryCache!: Table<PriceHistoryCache, string>;
  /** Handle della cartella di backup automatico (File System Access API).
   *  NON è in TABLE_NAMES: non è serializzabile in JSON e non deve finire
   *  nei backup; viene però azzerata da wipeAll. */
  fsHandles!: Table<{ id: string; handle: FileSystemDirectoryHandle }, string>;

  constructor() {
    super("pfos");
    this.version(1).stores({
      settings: "id",
      accounts: "id",
      assets: "id",
      debts: "id",
      incomes: "id, date, category, sourceRef, fingerprint",
      expenses: "id, date, category, sourceRef, fingerprint",
      subscriptions: "id",
      recurringTransactions: "id",
      importRules: "id",
      importProfiles: "id",
      goals: "id",
      calendarItems: "id, date",
      snapshots: "id, date",
      economicEventsCache: "id",
      taxState: "id",
      priceHistoryCache: "id",
    });
    // v3: cartella di backup automatico
    this.version(3).stores({
      fsHandles: "id",
    });
    // v2: operazioni di acquisto/vendita; gli asset esistenti diventano la
    // "posizione iniziale" (base) da cui si ricalcola la posizione attuale
    this.version(2)
      .stores({
        assetTransactions: "id, assetId, date",
      })
      .upgrade(async (tx) => {
        await tx
          .table("assets")
          .toCollection()
          .modify((a: Asset) => {
            if (a.baseQuantity == null) a.baseQuantity = a.quantity;
            if (a.baseAvgCost == null) a.baseAvgCost = a.avgCost;
          });
      });
  }
}

export const db = new PfosDB();

export const TABLE_NAMES = [
  "settings",
  "accounts",
  "assets",
  "assetTransactions",
  "debts",
  "incomes",
  "expenses",
  "subscriptions",
  "recurringTransactions",
  "importRules",
  "importProfiles",
  "goals",
  "calendarItems",
  "snapshots",
  "economicEventsCache",
  "taxState",
  "priceHistoryCache",
] as const;

export type TableName = (typeof TABLE_NAMES)[number];
