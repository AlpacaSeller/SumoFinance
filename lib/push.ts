// ── Web Push lato client: iscrizione e promemoria ───────────────────────────
// Opt-in da Impostazioni. Il client deposita la subscription del browser e i
// promemoria dei prossimi 45 giorni (titolo, data, importo arrotondato di
// scadenze del calendario e rate): il cron del server manda la notifica la
// mattina del giorno giusto. Su iPhone funziona SOLO con l'app installata
// da "Aggiungi a Home" (limite di iOS).

import { storage } from "./storage";
import { upcomingItems } from "./engine/calendar";
import { todayISO } from "./format";
import type { Asset, CalendarItem, Debt, RecurringTransaction } from "./types";

const ENABLED_KEY = "pfos-push-enabled";
const HORIZON_DAYS = 45;

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** iOS senza PWA installata: il push non è disponibile (limite di Safari). */
export function pushNeedsInstall(): boolean {
  if (typeof window === "undefined") return false;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true;
  return isIos && !standalone;
}

export function pushLocallyEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

function vapidKeyBytes(): Uint8Array {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  if (!key) throw new Error("Chiave push non configurata sul server");
  const pad = "=".repeat((4 - (key.length % 4)) % 4);
  const raw = atob((key + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function buildReminders(): Promise<{ date: string; title: string; amount?: number }[]> {
  const [calendarItems, debts, recurring] = await Promise.all([
    storage.list<CalendarItem>("calendarItems"),
    storage.list<Debt>("debts"),
    storage.list<RecurringTransaction>("recurringTransactions"),
  ]);
  return upcomingItems(calendarItems, debts, recurring, HORIZON_DAYS, todayISO()).map((x) => ({
    date: x.date,
    title: x.title,
    amount: Math.round(x.amount),
  }));
}

/** Soglie di prezzo per il controllo mattutino del server: solo nome asset,
 *  simbolo del provider e soglie — mai quantità o valori di posizione. */
async function buildAlerts(): Promise<
  { name: string; symbol: string; source: string; above?: number; below?: number }[]
> {
  const assets = await storage.list<Asset>("assets");
  return assets
    .filter(
      (a) =>
        (a.alertAbove != null || a.alertBelow != null) &&
        a.symbol &&
        (a.priceSource === "yahoo" || a.priceSource === "coingecko")
    )
    .slice(0, 20)
    .map((a) => ({
      name: a.name.slice(0, 60),
      symbol: a.symbol as string,
      source: a.priceSource,
      above: a.alertAbove ?? undefined,
      below: a.alertBelow ?? undefined,
    }));
}

async function getSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/** Chiede il permesso, iscrive il browser e deposita i promemoria. */
export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error("Questo browser non supporta le notifiche push");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Permesso notifiche negato: puoi riabilitarlo dalle impostazioni del browser");
  }
  const reg = await navigator.serviceWorker.ready;
  const subscription =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidKeyBytes() as BufferSource,
    }));
  await postSubscription(subscription);
  try {
    localStorage.setItem(ENABLED_KEY, "1");
  } catch {
    /* niente */
  }
}

async function postSubscription(subscription: PushSubscription): Promise<void> {
  const [reminders, alerts] = await Promise.all([buildReminders(), buildAlerts()]);
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: subscription.toJSON(), reminders, alerts }),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error || "Registrazione push non riuscita");
  }
}

/** Aggiorna i promemoria depositati (chiamata silenziosa all'apertura). */
export async function refreshPushReminders(): Promise<void> {
  if (!pushSupported() || !pushLocallyEnabled()) return;
  const subscription = await getSubscription();
  if (!subscription) return;
  await postSubscription(subscription).catch(() => undefined);
}

export async function disablePush(): Promise<void> {
  try {
    localStorage.removeItem(ENABLED_KEY);
  } catch {
    /* niente */
  }
  if (!pushSupported()) return;
  const subscription = await getSubscription();
  if (subscription) {
    await fetch(`/api/push/subscribe?endpoint=${encodeURIComponent(subscription.endpoint)}`, {
      method: "DELETE",
    }).catch(() => undefined);
    await subscription.unsubscribe().catch(() => undefined);
  }
}
