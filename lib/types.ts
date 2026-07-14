// ── Tipi del modello dati PFOS ──────────────────────────────────────────────
// Tutte le date sono stringhe ISO "YYYY-MM-DD" (o ISO completo dove indicato).
// Tutti gli importi sono in EUR salvo diversa indicazione.

export type RiskProfile = "prudente" | "bilanciato" | "dinamico";

export type AssetClass =
  | "ETF"
  | "Azioni"
  | "Obbligazioni"
  | "Crypto"
  | "Oro & metalli"
  | "Immobili"
  | "Altro";

export const ASSET_CLASSES: AssetClass[] = [
  "ETF",
  "Azioni",
  "Obbligazioni",
  "Crypto",
  "Oro & metalli",
  "Immobili",
  "Altro",
];

export type PriceSource = "manuale" | "coingecko" | "yahoo" | "twelvedata";

export type TaxRegime = "standard" | "whitelist";

export type AccountType = "conto corrente" | "carta/e-money" | "contanti" | "altro";
export const ACCOUNT_TYPES: AccountType[] = [
  "conto corrente",
  "carta/e-money",
  "contanti",
  "altro",
];

export type DebtType = "mutuo" | "prestito" | "finanziamento" | "altro";
export const DEBT_TYPES: DebtType[] = ["mutuo", "prestito", "finanziamento", "altro"];

export const INCOME_CATEGORIES = [
  "Stipendio",
  "Dividendi",
  "Cedole",
  "Interessi",
  "Cashback",
  "Staking",
  "Affitti",
  "Altro",
] as const;

export const PASSIVE_INCOME_CATEGORIES = [
  "Dividendi",
  "Cedole",
  "Interessi",
  "Cashback",
  "Staking",
  "Affitti",
] as const;

export const EXPENSE_CATEGORIES = [
  "Casa",
  "Cibo",
  "Auto",
  "Trasporti",
  "Salute",
  "Tempo libero",
  "Abbonamenti",
  "Altro",
] as const;

export type Cadence = "mensile" | "annuale";

// ── Entità ──────────────────────────────────────────────────────────────────

export interface Settings {
  id: string; // sempre "main"
  riskProfile: RiskProfile;
  fireWithdrawalRate: number; // % annuo, default 3,5
  expectedInflation: number; // % annuo, default 2
  targetAllocation?: Partial<Record<AssetClass, number>>; // % per classe (somma ~100)
  twelveDataApiKey?: string;
  syncOnOpen: boolean; // default true
  pinHash?: string;
  pinSalt?: string;
  lastBackupAt?: string; // ISO datetime
  lastAutoBackupAt?: string; // ISO datetime (backup automatico su cartella)
  onboardingDone: boolean;
  customExpenseCategories: string[];
  customIncomeCategories: string[];
  budgetOverrides: Record<string, number>; // categoria → budget mensile €
  budgetRollover?: boolean; // riporta il non speso del mese scorso
  lastPriceSyncAt?: string; // ISO datetime
  /** true se i dati caricati sono quelli d'esempio (banner con "Azzera") */
  demoMode?: boolean;
  /** Codice del gruppo di sync E2E (la passphrase resta in localStorage). */
  syncId?: string;
  /** Consigli AI (BYOK): provider e chiave dell'utente, mai dei nostri server. */
  aiProvider?: "gemini" | "anthropic";
  aiApiKey?: string;
}

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  balance: number; // nella valuta `currency`
  currency?: string; // default EUR
  eurRate?: number; // cambio verso EUR (cache), 1 se EUR
}

export interface Asset {
  id: string;
  name: string;
  ticker?: string;
  assetClass: AssetClass;
  broker?: string;
  quantity: number; // posizione ATTUALE = base + operazioni (ricalcolata)
  avgCost: number; // PMC ATTUALE per unità, in EUR (ricalcolato dalle operazioni)
  /** Posizione iniziale inserita a mano: quantity/avgCost si ricalcolano da
   *  qui applicando le operazioni (assetTransactions) in ordine cronologico. */
  baseQuantity?: number;
  baseAvgCost?: number;
  /** Data di carico della posizione iniziale (per il rendimento XIRR). */
  baseDate?: string;
  currentPrice: number; // per unità, in EUR (già convertito)
  priceSource: PriceSource;
  symbol?: string; // formato del provider: "bitcoin", "VWCE.MI", "VWCE:XETRA"
  quoteCurrency?: string; // valuta della quotazione originale, es. "USD"
  lastSyncAt?: string; // ISO datetime
  taxRegime: TaxRegime; // standard 26% | whitelist 12,5% (crypto: 33% dal 2026)
  declaredAnnualIncome?: number; // rendita annua dichiarata €, es. affitti
  /** Wallet auto-tracciato: la QUANTITÀ si legge on-chain dall'indirizzo
   *  pubblico a ogni sync (il prezzo resta dal provider, es. CoinGecko). */
  walletChain?: WalletChain;
  walletAddress?: string;
  tokenContract?: string; // ERC-20: indirizzo del contratto (vuoto = nativo)
  tokenDecimals?: number; // ERC-20: decimali del token (default 18)
  exchange?: string; // borsa di quotazione (dalla ricerca)
  ter?: number; // TER % annuo (inserito a mano: non esiste fonte gratuita)
}

export type WalletChain = "bitcoin" | "ethereum" | "solana";

export interface Debt {
  id: string;
  name: string;
  type: DebtType;
  residual: number;
  tan: number; // %
  monthlyPayment: number;
  endDate?: string;
  linkedAssetId?: string; // es. mutuo → immobile
  paymentDay: number; // giorno del mese di registrazione della rata (1–28)
  /** Ammortamento automatico (piano francese): a ogni rata registrata il
   *  residuo scende della quota capitale (rata − interessi del mese). */
  amortize?: boolean;
}

/** Operazione su un asset. Le operazioni sono la fonte di verità: quantità e
 *  PMC dell'asset si ricalcolano da baseQuantity/baseAvgCost applicandole in
 *  ordine (data, createdAt). Le vendite generano plusvalenze o minusvalenze
 *  realizzate (metodo del costo medio ponderato).
 *  - dividendo: `unitPrice` = importo netto incassato (€), quantity ignorata;
 *    entra nell'XIRR e genera un'entrata collegata (sourceRef "tx:<id>").
 *  - frazionamento (split): `quantity` = fattore (10 per un 10:1, 0,1 per un
 *    reverse split 1:10); moltiplica la quantità e divide il PMC. */
export interface AssetTransaction {
  id: string;
  assetId: string;
  type: "acquisto" | "vendita" | "dividendo" | "frazionamento";
  date: string;
  quantity: number; // > 0
  unitPrice: number; // EUR per unità (dividendo: importo totale netto)
  fees: number; // commissioni in EUR (0 se assenti)
  createdAt: string; // ISO, ordina le operazioni nello stesso giorno
}

export interface Income {
  id: string;
  description: string;
  category: string;
  amount: number; // positivo
  date: string;
  source?: "manuale" | "ricorrente" | "import" | "auto";
  sourceRef?: string; // idempotenza generazioni automatiche: "rec:<id>:<periodo>"
  fingerprint?: string; // dedupe import CSV
  importBatch?: string; // id del lotto di import CSV (per l'annullo di gruppo)
  tags?: string[]; // etichette libere trasversali alle categorie ("vacanza giappone")
}

export interface Expense {
  id: string;
  description: string;
  category: string;
  amount: number; // positivo
  date: string;
  source?: "manuale" | "ricorrente" | "import" | "auto";
  sourceRef?: string;
  fingerprint?: string;
  importBatch?: string;
  tags?: string[];
}

export interface Subscription {
  id: string;
  name: string;
  amount: number;
  cadence: Cadence;
  active: boolean;
  chargeDay: number; // giorno del mese (1–28)
  startDate: string; // da quando generare le uscite
}

export interface RecurringTransaction {
  id: string;
  description: string;
  category: string;
  amount: number;
  type: "entrata" | "uscita";
  cadence: Cadence;
  day: number; // giorno di registrazione (1–28)
  active: boolean;
  startDate: string; // da quando generare
  lastRegisteredPeriod?: string; // "YYYY-MM" o "YYYY"
}

export interface ImportRule {
  id: string;
  pattern: string; // testo cercato nella descrizione (case-insensitive)
  category: string;
  type: "entrata" | "uscita" | "entrambi";
  active: boolean;
}

export interface ImportColumnMapping {
  dateCol: string;
  descCol: string;
  amountCol?: string; // convenzione a colonna unica con segno
  debitCol?: string; // convenzione dare/avere
  creditCol?: string;
  categoryCol?: string;
}

export interface ImportProfile {
  id: string;
  name: string; // es. "Intesa", "Revolut"
  mapping: ImportColumnMapping;
  separator: string;
  dateFormat: "gg/mm/aaaa" | "aaaa-mm-gg";
  amountConvention: "signed" | "debitCredit";
}

export interface Goal {
  id: string;
  name: string;
  target: number;
  saved: number;
  deadline: string;
  plannedMonthly: number;
  /** Se collegato a un conto, il versato È il saldo del conto (auto). */
  linkedAccountId?: string;
}

export type CalendarRecurrence = "una tantum" | "mensile" | "annuale";

export interface CalendarItem {
  id: string;
  title: string;
  amount: number; // positivo o negativo
  date: string;
  recurrence: CalendarRecurrence;
  origin: "manuale" | "auto";
  sourceRef?: string;
}

export interface Snapshot {
  id: string; // = data "YYYY-MM-DD" (max 1 al giorno)
  date: string;
  netWorth: number;
  gross: number;
  liquidity: number;
  investments: number;
  debts: number;
}

export interface EconomicEvent {
  title: string;
  country: string; // valuta/area es. "EUR", "USD"
  date: string; // ISO datetime
  impact: "High" | "Medium" | "Low" | string;
  forecast: string;
  previous: string;
  actual?: string;
}

export interface EconomicEventsCache {
  id: string; // "this" | "next"
  fetchedAt: string; // ISO datetime
  events: EconomicEvent[];
}

export interface LossPot {
  year: number; // anno di formazione (scade il 31/12 del 4° anno successivo)
  amount: number;
}

export interface TaxState {
  id: string; // sempre "main"
  realizedGainsYear: number; // plusvalenze realizzate nell'anno corrente
  realizedLossesYear: number; // minusvalenze realizzate nell'anno corrente
  lossPots: LossPot[]; // zainetto fiscale per anno di formazione
}

export interface PriceHistoryCache {
  id: string; // = symbol
  fetchedAt: string;
  currency: string;
  points: { t: number; p: number }[]; // timestamp ms, prezzo
}

/** Tombstone di una riga eliminata: viaggia nei backup/sync così le
 *  cancellazioni si propagano tra dispositivi (sync v2, merge per riga).
 *  id = "<tabella>:<id riga>". Potati dopo 90 giorni. */
export interface Deletion {
  id: string;
  table: string;
  rowId: string;
  deletedAt: string; // ISO datetime
}

/** Nota sync v2: DexieAdapter timbra `updatedAt` (ISO) su ogni riga utente a
 *  ogni scrittura; il merge per riga tiene la versione più recente. Il campo
 *  è dinamico e opzionale: non è dichiarato nelle singole interfacce. */

// ── Backup ──────────────────────────────────────────────────────────────────

export interface BackupFile {
  app: "PFOS";
  version: 1;
  exportedAt: string;
  data: Record<string, unknown[]>;
}

// ── Stato finanziario derivato (input del RulesAdvisor e dei motori) ───────

export interface FinancialData {
  settings: Settings;
  accounts: Account[];
  assets: Asset[];
  assetTransactions: AssetTransaction[];
  debts: Debt[];
  incomes: Income[];
  expenses: Expense[];
  subscriptions: Subscription[];
  recurring: RecurringTransaction[];
  goals: Goal[];
  calendarItems: CalendarItem[];
  snapshots: Snapshot[];
  taxState: TaxState;
}

export interface Advice {
  id: string;
  severity: "alert" | "warn" | "ok";
  priority: number; // più basso = più importante
  title: string;
  // Testo con i numeri in grassetto: usa la sintassi **testo** (renderizzata dalla UI)
  body: string;
  action?: string; // azione concreta suggerita
}

export function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}
