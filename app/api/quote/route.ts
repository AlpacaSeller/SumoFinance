// ── Proxy di sola lettura verso Yahoo Finance ───────────────────────────────
// Stateless: transita solo il ticker richiesto, nessun dato personale viene
// ricevuto, registrato o inoltrato. L'endpoint Yahoo è non ufficiale e non
// consente CORS: questo proxy aggiunge lo User-Agent e una cache di 15 minuti
// (24 ore per lo storico a 1 anno).

import { NextRequest, NextResponse } from "next/server";

interface CacheEntry {
  at: number;
  body: unknown;
}

const cache = new Map<string, CacheEntry>();
const TTL_QUOTE = 15 * 60 * 1000;
const TTL_HISTORY = 24 * 60 * 60 * 1000;
const MAX_CACHE = 500;

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol")?.trim();
  const range = req.nextUrl.searchParams.get("range")?.trim() || "1d";
  if (!symbol || symbol.length > 32 || !/^[A-Za-z0-9.^=:\-]+$/.test(symbol)) {
    return NextResponse.json({ error: "Simbolo non valido" }, { status: 400 });
  }
  if (!["1d", "1y", "5y", "max"].includes(range)) {
    return NextResponse.json(
      { error: "Range non supportato (1d | 1y | 5y | max)" },
      { status: 400 }
    );
  }

  const key = `${symbol}:${range}`;
  const ttl = range === "1d" ? TTL_QUOTE : TTL_HISTORY;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) {
    return NextResponse.json(hit.body);
  }

  const interval =
    range === "1y" ? "1d" : range === "5y" ? "1wk" : range === "max" ? "1mo" : "5m";
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(12000),
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Yahoo ha risposto ${res.status} per "${symbol}"` },
        { status: res.status === 404 ? 404 : 502 }
      );
    }
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    const meta = result?.meta;
    if (!meta || typeof meta.regularMarketPrice !== "number") {
      return NextResponse.json(
        { error: `Nessuna quotazione per "${symbol}"` },
        { status: 404 }
      );
    }

    const body: Record<string, unknown> = {
      symbol,
      price: meta.regularMarketPrice,
      currency: meta.currency || "EUR",
      timestamp: new Date((meta.regularMarketTime || Date.now() / 1000) * 1000).toISOString(),
    };

    if (range !== "1d") {
      const ts: number[] = result.timestamp || [];
      const closes: (number | null)[] = result.indicators?.quote?.[0]?.close || [];
      body.points = ts
        .map((t, i) => ({ t: t * 1000, p: closes[i] }))
        .filter((x): x is { t: number; p: number } => typeof x.p === "number");
    }

    if (cache.size > MAX_CACHE) cache.clear();
    cache.set(key, { at: Date.now(), body });
    return NextResponse.json(body);
  } catch {
    return NextResponse.json(
      { error: "Yahoo Finance non raggiungibile" },
      { status: 502 }
    );
  }
}
