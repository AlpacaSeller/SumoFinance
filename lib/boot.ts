// ── Attività di apertura app ────────────────────────────────────────────────
// 1. Garantisce settings/taxState di default
// 2. Registra i movimenti ricorrenti maturati (idempotente)
// 3. Salva lo snapshot patrimoniale (max 1 al giorno)
// 4. Pulisce lo zainetto fiscale dalle minusvalenze scadute

import { storage } from "./storage";
import { DEFAULT_SETTINGS, DEFAULT_TAX_STATE } from "./defaults";
import type {
  Account,
  Asset,
  Debt,
  Expense,
  Income,
  RecurringTransaction,
  Settings,
  Snapshot,
  Subscription,
  TaxState,
} from "./types";
import { computeDueMovements } from "./engine/recurring";
import { computeAggregates } from "./engine/aggregates";
import { prunePots } from "./engine/tax";
import { todayISO } from "./format";

/** Chiede al browser lo storage "persistente": protegge IndexedDB dalla
 *  cancellazione automatica quando il disco è sotto pressione. Idempotente. */
export async function ensurePersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function ensureDefaults(): Promise<Settings> {
  let settings = await storage.get<Settings>("settings", "main");
  if (!settings) {
    settings = { ...DEFAULT_SETTINGS };
    await storage.put("settings", settings);
  }
  const tax = await storage.get<TaxState>("taxState", "main");
  if (!tax) {
    await storage.put("taxState", { ...DEFAULT_TAX_STATE });
  }
  return settings;
}

export async function registerRecurringMovements(): Promise<number> {
  const [recurring, subscriptions, debts, incomes, expenses] = await Promise.all([
    storage.list<RecurringTransaction>("recurringTransactions"),
    storage.list<Subscription>("subscriptions"),
    storage.list<Debt>("debts"),
    storage.list<Income>("incomes"),
    storage.list<Expense>("expenses"),
  ]);
  const existingRefs = new Set<string>();
  for (const i of incomes) if (i.sourceRef) existingRefs.add(i.sourceRef);
  for (const e of expenses) if (e.sourceRef) existingRefs.add(e.sourceRef);

  const due = computeDueMovements(recurring, subscriptions, debts, existingRefs);
  if (due.incomes.length > 0) await storage.bulkPut("incomes", due.incomes);
  if (due.expenses.length > 0) await storage.bulkPut("expenses", due.expenses);
  // ammortamento: le rate appena registrate scalano il residuo dei debiti
  for (const upd of due.debtUpdates) {
    const debt = debts.find((d) => d.id === upd.id);
    if (debt) await storage.put("debts", { ...debt, residual: upd.residual });
  }
  return due.incomes.length + due.expenses.length;
}

/** Snapshot patrimoniale: max 1 al giorno (id = data) */
export async function takeDailySnapshot(): Promise<boolean> {
  const today = todayISO();
  const existing = await storage.get<Snapshot>("snapshots", today);
  if (existing) return false;
  const [accounts, assets, debts] = await Promise.all([
    storage.list<Account>("accounts"),
    storage.list<Asset>("assets"),
    storage.list<Debt>("debts"),
  ]);
  // niente snapshot per un'app completamente vuota
  if (accounts.length === 0 && assets.length === 0 && debts.length === 0) return false;
  const agg = computeAggregates(accounts, assets, debts);
  await storage.put<Snapshot>("snapshots", {
    id: today,
    date: today,
    netWorth: agg.netWorth,
    gross: agg.gross,
    liquidity: agg.liquidity,
    investments: agg.investments,
    debts: agg.debts,
  });
  return true;
}

export async function pruneExpiredLossPots(): Promise<void> {
  const tax = await storage.get<TaxState>("taxState", "main");
  if (!tax) return;
  const year = new Date().getFullYear();
  const pruned = prunePots(tax.lossPots, year);
  if (pruned.length !== tax.lossPots.length) {
    await storage.put("taxState", { ...tax, lossPots: pruned });
  }
}

/** Rimuove dalla cache gli storici prezzi non aggiornati da oltre 30 giorni
 *  (simboli di asset eliminati o non più consultati). */
export async function pruneStalePriceHistory(): Promise<void> {
  const rows = await storage.list<{ id: string; fetchedAt: string }>("priceHistoryCache");
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const row of rows) {
    if (new Date(row.fetchedAt).getTime() < cutoff) {
      await storage.remove("priceHistoryCache", row.id);
    }
  }
}

/** true se serve mostrare il promemoria backup (mai fatto con dati, o > 30 giorni) */
export async function backupReminderDue(): Promise<boolean> {
  const settings = await storage.get<Settings>("settings", "main");
  if (!settings) return false;
  const [accounts, incomes, expenses, assets] = await Promise.all([
    storage.list("accounts"),
    storage.list("incomes"),
    storage.list("expenses"),
    storage.list("assets"),
  ]);
  const hasData =
    accounts.length + incomes.length + expenses.length + assets.length > 0;
  if (!hasData) return false;
  if (!settings.lastBackupAt) return true;
  const last = new Date(settings.lastBackupAt).getTime();
  return Date.now() - last > 30 * 24 * 60 * 60 * 1000;
}

export async function runBootTasks(): Promise<{ registered: number; snapshot: boolean }> {
  await ensureDefaults();
  const registered = await registerRecurringMovements();
  const snapshot = await takeDailySnapshot();
  await pruneExpiredLossPots();
  return { registered, snapshot };
}
