// ── Modalità demo: dati d'esempio realistici ────────────────────────────────
// Genera 9 mesi di storia finanziaria plausibile e deterministica (seed
// fisso) per far provare l'app senza inserire dati veri. I movimenti generati
// portano gli STESSI sourceRef idempotenti del motore ricorrenti
// ("rec:<id>:<periodo>", "sub:<id>:<periodo>", "debt:<id>:<periodo>"): al
// prossimo boot l'app non registra duplicati. Si esce con "Cancella tutto".

import { storage } from "./storage";
import { DEFAULT_SETTINGS, DEFAULT_TAX_STATE } from "./defaults";
import type {
  Account,
  Asset,
  AssetTransaction,
  CalendarItem,
  Debt,
  Expense,
  Goal,
  Income,
  RecurringTransaction,
  Settings,
  Snapshot,
  Subscription,
} from "./types";
import { uid } from "./types";

const MONTHS_BACK = 9;

/** rng deterministico (mulberry32): stessa demo per tutti */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Elenca i mesi (anno, mese0) dagli ultimi MONTHS_BACK fino a oggi incluso. */
function monthRange(today: Date): { y: number; m0: number }[] {
  const out: { y: number; m0: number }[] = [];
  const cursor = new Date(today.getFullYear(), today.getMonth() - MONTHS_BACK, 1);
  while (cursor <= today) {
    out.push({ y: cursor.getFullYear(), m0: cursor.getMonth() });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

/** Data nel mese, mai nel futuro; null se il giorno non è ancora arrivato. */
function dayInMonth(y: number, m0: number, day: number, today: Date): string | null {
  const d = new Date(y, m0, day);
  if (d > today) return null;
  return iso(d);
}

export interface DemoData {
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
}

/** Generazione pura (testabile): nessun accesso allo storage. */
export function generateDemoData(today: Date = new Date()): DemoData {
  const rand = rng(20260713);
  const months = monthRange(today);
  const startISO = `${months[0].y}-${String(months[0].m0 + 1).padStart(2, "0")}-01`;

  // ── conti ──
  const contoPrincipale: Account = {
    id: uid(),
    name: "Conto principale",
    type: "conto corrente",
    balance: 6420,
  };
  const deposito: Account = {
    id: uid(),
    name: "Conto deposito",
    type: "altro",
    balance: 5000,
  };
  const contanti: Account = { id: uid(), name: "Contanti", type: "contanti", balance: 140 };

  // ── ricorrenti (storia pre-generata con sourceRef idempotenti) ──
  const recStipendio: RecurringTransaction = {
    id: uid(),
    description: "Stipendio",
    category: "Stipendio",
    amount: 2150,
    type: "entrata",
    cadence: "mensile",
    day: 27,
    active: true,
    startDate: startISO,
  };
  const recAffitto: RecurringTransaction = {
    id: uid(),
    description: "Affitto",
    category: "Casa",
    amount: 780,
    type: "uscita",
    cadence: "mensile",
    day: 3,
    active: true,
    startDate: startISO,
  };
  const recBollette: RecurringTransaction = {
    id: uid(),
    description: "Bollette luce e gas",
    category: "Casa",
    amount: 95,
    type: "uscita",
    cadence: "mensile",
    day: 12,
    active: true,
    startDate: startISO,
  };

  // ── abbonamenti ──
  const subs: Subscription[] = [
    { id: uid(), name: "Netflix", amount: 13.99, cadence: "mensile", active: true, chargeDay: 8, startDate: startISO },
    { id: uid(), name: "Spotify", amount: 10.99, cadence: "mensile", active: true, chargeDay: 15, startDate: startISO },
    { id: uid(), name: "Palestra", amount: 39, cadence: "mensile", active: true, chargeDay: 2, startDate: startISO },
  ];

  // ── debito con rata ──
  const prestito: Debt = {
    id: uid(),
    name: "Prestito auto",
    type: "prestito",
    residual: 4800,
    tan: 5.9,
    monthlyPayment: 210,
    paymentDay: 5,
    amortize: false, // residuo fisso nella demo: numeri stabili e leggibili
  };

  const incomes: Income[] = [];
  const expenses: Expense[] = [];

  for (const { y, m0 } of months) {
    const period = `${y}-${String(m0 + 1).padStart(2, "0")}`;

    // ricorrenti (stesso formato del motore: rec:<id>:<YYYY-MM>)
    const stipDate = dayInMonth(y, m0, recStipendio.day, today);
    if (stipDate)
      incomes.push({
        id: uid(),
        description: "Stipendio",
        category: "Stipendio",
        amount: 2150,
        date: stipDate,
        source: "ricorrente",
        sourceRef: `rec:${recStipendio.id}:${period}`,
      });
    const affDate = dayInMonth(y, m0, recAffitto.day, today);
    if (affDate)
      expenses.push({
        id: uid(),
        description: "Affitto",
        category: "Casa",
        amount: 780,
        date: affDate,
        source: "ricorrente",
        sourceRef: `rec:${recAffitto.id}:${period}`,
      });
    const bolDate = dayInMonth(y, m0, recBollette.day, today);
    if (bolDate)
      expenses.push({
        id: uid(),
        description: "Bollette luce e gas",
        category: "Casa",
        amount: round2(95 + (rand() - 0.5) * 30),
        date: bolDate,
        source: "ricorrente",
        sourceRef: `rec:${recBollette.id}:${period}`,
      });

    // abbonamenti (sub:<id>:<YYYY-MM>)
    for (const s of subs) {
      const d = dayInMonth(y, m0, s.chargeDay, today);
      if (d)
        expenses.push({
          id: uid(),
          description: s.name,
          category: "Abbonamenti",
          amount: s.amount,
          date: d,
          source: "auto",
          sourceRef: `sub:${s.id}:${period}`,
        });
    }

    // rata del prestito (debt:<id>:<YYYY-MM>)
    const rataDate = dayInMonth(y, m0, prestito.paymentDay, today);
    if (rataDate)
      expenses.push({
        id: uid(),
        description: `Rata ${prestito.name}`,
        category: "Altro",
        amount: 210,
        date: rataDate,
        source: "auto",
        sourceRef: `debt:${prestito.id}:${period}`,
      });

    // spese variabili (deterministiche col seed)
    const spesa = (day: number, description: string, category: string, min: number, max: number) => {
      const d = dayInMonth(y, m0, day, today);
      if (d)
        expenses.push({
          id: uid(),
          description,
          category,
          amount: round2(min + rand() * (max - min)),
          date: d,
          source: "manuale",
        });
    };
    spesa(4, "Spesa Esselunga", "Cibo", 62, 105);
    spesa(11, "Spesa Lidl", "Cibo", 48, 85);
    spesa(18, "Spesa Esselunga", "Cibo", 62, 105);
    spesa(25, "Spesa Lidl", "Cibo", 48, 85);
    spesa(7, "Benzina", "Auto", 55, 75);
    spesa(21, "Benzina", "Auto", 55, 75);
    spesa(9, "Pizzeria con amici", "Tempo libero", 24, 42);
    spesa(23, "Cinema", "Tempo libero", 16, 28);
    spesa(14, "Ricarica trasporti", "Trasporti", 22, 22);
    if (m0 % 2 === 0) spesa(16, "Farmacia", "Salute", 18, 55);
    spesa(20, "Amazon", "Altro", 15, 85);

    // entrate extra occasionali
    if (m0 % 3 === 1) {
      const d = dayInMonth(y, m0, 19, today);
      if (d)
        incomes.push({
          id: uid(),
          description: "Vendita usato Vinted",
          category: "Altro",
          amount: round2(20 + rand() * 60),
          date: d,
          source: "manuale",
        });
    }
  }

  // ── investimenti: base + operazioni (numeri coerenti col motore PMC) ──
  const dISO = (monthsAgo: number, day: number) => {
    const d = new Date(today.getFullYear(), today.getMonth() - monthsAgo, day);
    return iso(d > today ? new Date(today.getFullYear(), today.getMonth() - monthsAgo - 1, day) : d);
  };

  const vwce: Asset = {
    id: uid(),
    name: "Vanguard FTSE All-World (Acc)",
    ticker: "VWCE",
    assetClass: "ETF",
    quantity: 45, // 40 base + 10 acquisto − 5 vendita
    avgCost: 107.6, // (40×105 + 10×118) / 50
    baseQuantity: 40,
    baseAvgCost: 105,
    baseDate: dISO(MONTHS_BACK, 15),
    currentPrice: 131.4,
    priceSource: "yahoo",
    symbol: "VWCE.MI",
    taxRegime: "standard",
    exchange: "Milan",
    ter: 0.22,
  };
  const btc: Asset = {
    id: uid(),
    name: "Bitcoin",
    ticker: "BTC",
    assetClass: "Crypto",
    quantity: 0.12, // 0,08 base + 0,04 acquisto
    avgCost: 68000, // (0,08×61000 + 0,04×82000) / 0,12
    baseQuantity: 0.08,
    baseAvgCost: 61000,
    baseDate: dISO(MONTHS_BACK - 1, 3),
    currentPrice: 91000,
    priceSource: "coingecko",
    symbol: "bitcoin",
    taxRegime: "standard",
  };
  const oro: Asset = {
    id: uid(),
    name: "Xetra-Gold",
    ticker: "4GLD",
    assetClass: "Oro & metalli",
    quantity: 30,
    avgCost: 78,
    baseQuantity: 30,
    baseAvgCost: 78,
    baseDate: dISO(MONTHS_BACK - 2, 1),
    currentPrice: 86,
    priceSource: "manuale",
    taxRegime: "standard",
  };

  const assetTxs: AssetTransaction[] = [
    {
      id: uid(),
      assetId: vwce.id,
      type: "acquisto",
      date: dISO(5, 10),
      quantity: 10,
      unitPrice: 118,
      fees: 0,
      createdAt: new Date().toISOString(),
    },
    {
      id: uid(),
      assetId: vwce.id,
      type: "vendita",
      date: dISO(1, 18),
      quantity: 5,
      unitPrice: 128,
      fees: 0,
      createdAt: new Date().toISOString(),
    },
    {
      id: uid(),
      assetId: btc.id,
      type: "acquisto",
      date: dISO(4, 20),
      quantity: 0.04,
      unitPrice: 82000,
      fees: 0,
      createdAt: new Date().toISOString(),
    },
  ];

  // ── obiettivi, scadenze ──
  const goals: Goal[] = [
    {
      id: uid(),
      name: "Fondo emergenza",
      target: 10000,
      saved: 0,
      deadline: iso(new Date(today.getFullYear() + 1, today.getMonth(), 1)),
      plannedMonthly: 300,
      linkedAccountId: deposito.id,
    },
    {
      id: uid(),
      name: "Viaggio in Giappone",
      target: 3500,
      saved: 1200,
      deadline: iso(new Date(today.getFullYear() + 1, today.getMonth() + 4, 1)),
      plannedMonthly: 150,
    },
  ];
  const calendarItems: CalendarItem[] = [
    {
      id: uid(),
      title: "Bollo auto",
      amount: -210,
      date: iso(new Date(today.getFullYear(), today.getMonth() + 2, 28)),
      recurrence: "annuale",
      origin: "manuale",
    },
    {
      id: uid(),
      title: "Assicurazione auto",
      amount: -420,
      date: iso(new Date(today.getFullYear(), today.getMonth() + 4, 15)),
      recurrence: "annuale",
      origin: "manuale",
    },
  ];

  // ── snapshot: 9 mesi di crescita plausibile fino al valore attuale ──
  const liquidity = contoPrincipale.balance + deposito.balance + contanti.balance;
  const investments = round2(
    vwce.quantity * vwce.currentPrice + btc.quantity * btc.currentPrice + oro.quantity * oro.currentPrice
  );
  const netNow = round2(liquidity + investments - prestito.residual);
  const snapshots: Snapshot[] = [];
  const steps = months.length;
  for (let i = 0; i < steps; i++) {
    const d = new Date(months[i].y, months[i].m0, 28);
    if (d > today) break;
    const progress = (i + 1) / steps;
    const noise = (rand() - 0.5) * 600;
    const net = round2(netNow - (1 - progress) * 4200 + noise);
    const inv = round2(investments - (1 - progress) * 2600 + noise / 2);
    snapshots.push({
      id: iso(d),
      date: iso(d),
      netWorth: net,
      gross: round2(net + prestito.residual),
      liquidity: round2(net + prestito.residual - inv),
      investments: inv,
      debts: prestito.residual,
    });
  }
  // ultimo snapshot: ieri, coerente coi numeri attuali
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (!snapshots.some((s) => s.id === iso(yesterday))) {
    snapshots.push({
      id: iso(yesterday),
      date: iso(yesterday),
      netWorth: netNow,
      gross: round2(liquidity + investments),
      liquidity,
      investments,
      debts: prestito.residual,
    });
  }

  // ── settings ──
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    onboardingDone: true,
    demoMode: true,
    targetAllocation: { ETF: 55, Crypto: 15, "Oro & metalli": 10, Obbligazioni: 20 },
  };

  return {
    settings,
    accounts: [contoPrincipale, deposito, contanti],
    assets: [vwce, btc, oro],
    assetTransactions: assetTxs,
    debts: [prestito],
    incomes,
    expenses,
    subscriptions: subs,
    recurring: [recStipendio, recAffitto, recBollette],
    goals,
    calendarItems,
    snapshots,
  };
}

/** Genera e scrive i dati d'esempio nello storage locale. */
export async function loadDemoData(): Promise<void> {
  const demo = generateDemoData();
  await storage.put("settings", demo.settings);
  await storage.put("taxState", { ...DEFAULT_TAX_STATE });
  await storage.bulkPut("accounts", demo.accounts);
  await storage.bulkPut("assets", demo.assets);
  await storage.bulkPut("assetTransactions", demo.assetTransactions);
  await storage.bulkPut("debts", demo.debts);
  await storage.bulkPut("incomes", demo.incomes);
  await storage.bulkPut("expenses", demo.expenses);
  await storage.bulkPut("subscriptions", demo.subscriptions);
  await storage.bulkPut("recurringTransactions", demo.recurring);
  await storage.bulkPut("goals", demo.goals);
  await storage.bulkPut("calendarItems", demo.calendarItems);
  await storage.bulkPut("snapshots", demo.snapshots);
}
