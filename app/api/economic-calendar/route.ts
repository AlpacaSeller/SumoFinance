// ── Proxy di sola lettura verso il feed pubblico di Forex Factory ──────────
// Stateless: nessun dato personale transita. Il feed è rate-limitato
// (~2 richieste/5 minuti) e cambia poco: cache lato server di 4 ore.

import { NextRequest, NextResponse } from "next/server";

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
    return NextResponse.json(hit.body);
  }

  try {
    const res = await fetch(FEEDS[week], {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
      cache: "no-store",
    });
    if (!res.ok) {
      // se il feed rifiuta (rate limit), riusa la cache scaduta se esiste
      if (hit) return NextResponse.json(hit.body);
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
    return NextResponse.json(body);
  } catch {
    if (hit) return NextResponse.json(hit.body);
    return NextResponse.json({ error: "Feed non raggiungibile" }, { status: 502 });
  }
}
