// ── Invio giornaliero delle notifiche push ──────────────────────────────────
// Invocato dal cron Vercel (vercel.json) una volta al giorno la mattina.
// Per ogni subscription: se ha promemoria con data = oggi (Europe/Rome) e non
// ha già ricevuto la notifica di oggi, invia un push con i titoli del giorno.
// Subscription scadute (404/410 dal push service) vengono eliminate.
// Protetto: richiede l'Authorization Bearer che Vercel Cron allega quando è
// definita l'env CRON_SECRET (evita che chiunque possa far scattare invii).

import { NextRequest, NextResponse } from "next/server";
import webpush from "web-push";
import { sharedCacheGet, sharedCacheSet } from "@/lib/server/sharedCache";

const SUPABASE_URL = process.env.SUPABASE_URL?.trim();
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY?.trim();
const CRON_SECRET = process.env.CRON_SECRET?.trim();

function sb(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY as string,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
}

function todayRome(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date());
}

interface AlertRule {
  name: string;
  symbol: string;
  source: string;
  above?: number;
  below?: number;
}

interface Row {
  endpoint: string;
  subscription: webpush.PushSubscription;
  reminders: { date: string; title: string; amount?: number }[];
  alerts: AlertRule[] | null;
  last_sent: string | null;
}

/** Prezzo corrente per un alert, con cache condivisa (una richiesta per
 *  simbolo per giro anche con molti utenti). Yahoo passa dal proxy interno
 *  (che ha già la sua cache); CoinGecko è interrogato in EUR. */
async function getAlertPrice(
  origin: string,
  rule: AlertRule,
  runCache: Map<string, number | null>
): Promise<number | null> {
  const key = `${rule.source}:${rule.symbol}`;
  if (runCache.has(key)) return runCache.get(key) ?? null;
  let price: number | null = null;
  try {
    if (rule.source === "yahoo") {
      const res = await fetch(
        `${origin}/api/quote?symbol=${encodeURIComponent(rule.symbol)}`,
        { signal: AbortSignal.timeout(12000), cache: "no-store" }
      );
      if (res.ok) price = ((await res.json()) as { price?: number }).price ?? null;
    } else {
      const cacheKey = `cg-price:${rule.symbol}`;
      const cached = await sharedCacheGet(cacheKey);
      if (cached && cached.ageMs < 30 * 60 * 1000) {
        price = (cached.payload as { eur?: number }).eur ?? null;
      } else {
        const res = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(rule.symbol)}&vs_currencies=eur`,
          { signal: AbortSignal.timeout(12000), cache: "no-store" }
        );
        if (res.ok) {
          const json = (await res.json()) as Record<string, { eur?: number }>;
          price = json[rule.symbol]?.eur ?? null;
          if (price != null) await sharedCacheSet(cacheKey, { eur: price });
        }
      }
    }
  } catch {
    price = null;
  }
  runCache.set(key, price);
  return price;
}

function fmtNum(n: number): string {
  return n.toLocaleString("it-IT", { maximumFractionDigits: 2 });
}

export async function GET(req: NextRequest) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !VAPID_PUBLIC || !VAPID_PRIVATE) {
    return NextResponse.json({ error: "Push non configurato" }, { status: 503 });
  }
  if (CRON_SECRET && req.headers.get("authorization") !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT?.trim() || "mailto:simonenero00@gmail.com",
    VAPID_PUBLIC,
    VAPID_PRIVATE
  );

  const today = todayRome();
  const res = await sb("push_subscriptions?select=endpoint,subscription,reminders,alerts,last_sent");
  if (!res.ok) {
    return NextResponse.json({ error: "Deposito non raggiungibile" }, { status: 502 });
  }
  const rows = (await res.json()) as Row[];
  const priceRunCache = new Map<string, number | null>();
  const origin = req.nextUrl.origin;

  let sent = 0;
  let removed = 0;
  for (const row of rows) {
    if (row.last_sent === today) continue; // già notificato oggi (cron ri-eseguito)
    const due = (row.reminders || []).filter((r) => r.date === today);

    // alert di prezzo: soglie superate al momento del controllo
    const triggered: string[] = [];
    for (const rule of row.alerts || []) {
      const price = await getAlertPrice(origin, rule, priceRunCache);
      if (price == null) continue;
      if (rule.above != null && price >= rule.above) {
        triggered.push(`${rule.name}: ${fmtNum(price)} — sopra la soglia di ${fmtNum(rule.above)}`);
      } else if (rule.below != null && price <= rule.below) {
        triggered.push(`${rule.name}: ${fmtNum(price)} — sotto la soglia di ${fmtNum(rule.below)}`);
      }
    }

    if (due.length === 0 && triggered.length === 0) continue;

    const lines = [
      ...due.map(
        (r) => `${r.title}${r.amount != null ? ` (${Math.abs(r.amount).toLocaleString("it-IT")} €)` : ""}`
      ),
      ...triggered,
    ];
    const title =
      due.length > 0 && triggered.length > 0
        ? "Scadenze e alert di oggi"
        : triggered.length > 0
          ? triggered.length === 1
            ? "Alert di prezzo"
            : `${triggered.length} alert di prezzo`
          : due.length === 1
            ? "Scadenza di oggi"
            : `${due.length} scadenze oggi`;
    const payload = JSON.stringify({
      title,
      body: lines.join("\n"),
      url: triggered.length > 0 && due.length === 0 ? "/investimenti" : "/calendario",
    });
    try {
      await webpush.sendNotification(row.subscription, payload, { TTL: 12 * 3600 });
      sent++;
      await sb(`push_subscriptions?endpoint=eq.${encodeURIComponent(row.endpoint)}`, {
        method: "PATCH",
        body: JSON.stringify({ last_sent: today }),
      });
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        // subscription revocata o scaduta: pulizia
        await sb(`push_subscriptions?endpoint=eq.${encodeURIComponent(row.endpoint)}`, {
          method: "DELETE",
        }).catch(() => undefined);
        removed++;
      }
    }
  }
  return NextResponse.json({ ok: true, today, subscriptions: rows.length, sent, removed });
}
