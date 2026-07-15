// ── Registrazione delle subscription Web Push ───────────────────────────────
// Il client deposita la subscription del browser e i promemoria dei prossimi
// ~45 giorni (titolo, data, importo arrotondato): il cron giornaliero li usa
// per inviare le notifiche del giorno. Opt-in esplicito, revocabile (DELETE).

import { NextRequest, NextResponse } from "next/server";

const SUPABASE_URL = process.env.SUPABASE_URL?.trim();
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
const MAX_REMINDERS = 60;

function sb(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY as string,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
  });
}

interface Reminder {
  date: string;
  title: string;
  amount?: number;
}

function sanitizeReminders(input: unknown): Reminder[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter(
      (r): r is { date: string; title: string; amount?: unknown } =>
        typeof r === "object" && r !== null &&
        typeof (r as { date?: unknown }).date === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test((r as { date: string }).date) &&
        typeof (r as { title?: unknown }).title === "string"
    )
    .slice(0, MAX_REMINDERS)
    .map((r) => ({
      date: r.date,
      title: String(r.title).slice(0, 120),
      amount: typeof r.amount === "number" && Number.isFinite(r.amount) ? Math.round(r.amount) : undefined,
    }));
}

interface AlertRule {
  name: string;
  symbol: string;
  source: string;
  above?: number;
  below?: number;
}

function sanitizeAlerts(input: unknown): AlertRule[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter(
      (a): a is { name: unknown; symbol: unknown; source: unknown; above?: unknown; below?: unknown } =>
        typeof a === "object" && a !== null &&
        typeof (a as { symbol?: unknown }).symbol === "string" &&
        typeof (a as { source?: unknown }).source === "string" &&
        ["yahoo", "coingecko"].includes((a as { source: string }).source)
    )
    .slice(0, 20)
    .map((a) => ({
      name: String(a.name ?? "").slice(0, 60),
      symbol: String(a.symbol).slice(0, 40),
      source: String(a.source),
      above: typeof a.above === "number" && Number.isFinite(a.above) ? a.above : undefined,
      below: typeof a.below === "number" && Number.isFinite(a.below) ? a.below : undefined,
    }))
    .filter((a) => a.above != null || a.below != null);
}

export async function POST(req: NextRequest) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return NextResponse.json({ error: "Push non configurato sul server" }, { status: 503 });
  }
  let body: { subscription?: { endpoint?: unknown }; reminders?: unknown; alerts?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  }
  const sub = body.subscription;
  const endpoint = typeof sub?.endpoint === "string" ? sub.endpoint : "";
  if (!endpoint.startsWith("https://") || endpoint.length > 1000) {
    return NextResponse.json({ error: "Subscription non valida" }, { status: 400 });
  }
  try {
    // quota anti-griefing: endpoint NUOVI rifiutati oltre soglia
    const existing = await sb(
      `push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}&select=endpoint`
    );
    const isNew = existing.ok && ((await existing.json()) as unknown[]).length === 0;
    if (isNew) {
      const head = await sb("push_subscriptions?select=endpoint&limit=1", {
        headers: { Prefer: "count=exact" },
      });
      const total = Number(head.headers.get("content-range")?.split("/")[1] ?? 0);
      if (total >= 2000) {
        return NextResponse.json(
          { error: "Registro notifiche al completo: riprova più avanti" },
          { status: 503 }
        );
      }
    }
    const res = await sb("push_subscriptions?on_conflict=endpoint", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify([
        {
          endpoint,
          subscription: sub,
          reminders: sanitizeReminders(body.reminders),
          alerts: sanitizeAlerts(body.alerts),
          updated_at: new Date().toISOString(),
        },
      ]),
    });
    if (!res.ok) {
      return NextResponse.json({ error: "Deposito non raggiungibile" }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Deposito non raggiungibile" }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return NextResponse.json({ error: "Push non configurato sul server" }, { status: 503 });
  }
  const endpoint = req.nextUrl.searchParams.get("endpoint") || "";
  if (!endpoint.startsWith("https://")) {
    return NextResponse.json({ error: "Endpoint non valido" }, { status: 400 });
  }
  try {
    const res = await sb(`push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      return NextResponse.json({ error: "Deposito non raggiungibile" }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Deposito non raggiungibile" }, { status: 502 });
  }
}
