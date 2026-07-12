// ── Proxy di sola lettura verso la ricerca simboli di Yahoo Finance ─────────
// Stateless: transita solo il testo cercato, nessun dato personale. Come
// /api/quote, l'endpoint Yahoo è non ufficiale e non consente CORS.

import { NextRequest, NextResponse } from "next/server";

interface CacheEntry {
  at: number;
  body: unknown;
}
const cache = new Map<string, CacheEntry>();
const TTL = 60 * 60 * 1000; // 1 ora: i simboli cambiano di rado
const MAX_CACHE = 300;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 1 || q.length > 48) {
    return NextResponse.json({ results: [] });
  }
  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) {
    return NextResponse.json(hit.body);
  }

  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
    q
  )}&quotesCount=10&newsCount=0&enableFuzzyQuery=false`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error();
    const json = await res.json();
    const results = (json?.quotes ?? [])
      .filter((qt: Record<string, unknown>) => qt.symbol && qt.quoteType !== "OPTION")
      .map((qt: Record<string, unknown>) => ({
        symbol: String(qt.symbol),
        name: String(qt.longname || qt.shortname || qt.symbol),
        exchange: String(qt.exchDisp || qt.exchange || ""),
        type: String(qt.quoteType || ""), // EQUITY | ETF | INDEX | CRYPTOCURRENCY | CURRENCY | FUTURE
      }))
      .slice(0, 10);
    const body = { results };
    if (cache.size > MAX_CACHE) cache.clear();
    cache.set(key, { at: Date.now(), body });
    return NextResponse.json(body);
  } catch {
    return NextResponse.json({ results: [] });
  }
}
