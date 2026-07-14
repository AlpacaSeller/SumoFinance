// ── Proxy di sola lettura verso il feed pubblico di Forex Factory ──────────
// Stateless: nessun dato personale transita. Il feed è rate-limitato
// (~2 richieste/5 minuti) e cambia poco: cache di 4 ore su due livelli,
// in-memory (per istanza) + condivisa su Supabase (per tutti gli utenti).

import { NextRequest, NextResponse } from "next/server";
import { sharedCacheGet, sharedCacheSet } from "@/lib/server/sharedCache";

const FEEDS: Record<string, string> = {
  this: "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
  next: "https://nfs.faireconomy.media/ff_calendar_nextweek.json",
};

interface CacheEntry {
  at: number;
  body: unknown;
}

const cache = new Map<string, CacheEntry>();
const TTL = 4 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const week = req.nextUrl.searchParams.get("week") === "next" ? "next" : "this";
  const hit = cache.get(week);
  if (hit && Date.now() - hit.at < TTL) {
    return NextResponse.json(hit.body, { headers: { "X-Cache": "l1" } });
  }

  const shared = await sharedCacheGet(`ecocal:${week}`);
  if (shared && shared.ageMs < TTL) {
    cache.set(week, { at: Date.now() - shared.ageMs, body: shared.payload });
    return NextResponse.json(shared.payload, { headers: { "X-Cache": "l2" } });
  }

  try {
    const res = await fetch(FEEDS[week], {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
      cache: "no-store",
    });
    if (!res.ok) {
      // se il feed rifiuta (rate limit), riusa la cache scaduta se esiste
      if (shared) return NextResponse.json(shared.payload, { headers: { "X-Cache": "stale" } });
      if (hit) return NextResponse.json(hit.body, { headers: { "X-Cache": "stale" } });
      return NextResponse.json(
        { error: `Il feed ha risposto ${res.status}` },
        { status: 502 }
      );
    }
    const raw = (await res.json()) as Record<string, unknown>[];
    const events = (Array.isArray(raw) ? raw : []).map((e) => ({
      title: String(e.title ?? ""),
      country: String(e.country ?? ""),
      date: String(e.date ?? ""),
      impact: String(e.impact ?? ""),
      forecast: String(e.forecast ?? ""),
      previous: String(e.previous ?? ""),
      actual: e.actual != null ? String(e.actual) : undefined,
    }));
    const body = { week, fetchedAt: new Date().toISOString(), events };
    cache.set(week, { at: Date.now(), body });
    await sharedCacheSet(`ecocal:${week}`, body);
    return NextResponse.json(body, { headers: { "X-Cache": "miss" } });
  } catch {
    if (shared) return NextResponse.json(shared.payload, { headers: { "X-Cache": "stale" } });
    if (hit) return NextResponse.json(hit.body, { headers: { "X-Cache": "stale" } });
    return NextResponse.json({ error: "Feed non raggiungibile" }, { status: 502 });
  }
}
