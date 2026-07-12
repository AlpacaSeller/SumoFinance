// ── Storico prezzi unificato (Yahoo per azioni/ETF, CoinGecko per crypto) ───
// Serie a 1 anno in EUR, cache 24h in IndexedDB. Usato dalla ricostruzione del
// valore investimenti e dal mini-grafico del dettaglio asset.

import { storage } from "../storage";
import type { Asset, PriceHistoryCache } from "../types";
import type { PricePoint } from "../engine/benchmark";

const TTL = 24 * 60 * 60 * 1000;

/** Storico crypto (EUR, ~1 anno, punti giornalieri) da CoinGecko. */
export async function fetchCryptoHistory(id: string): Promise<PricePoint[]> {
  const res = await fetch(
    `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(
      id
    )}/market_chart?vs_currency=eur&days=365&interval=daily`,
    { signal: AbortSignal.timeout(12000) }
  );
  if (!res.ok) throw new Error(`CoinGecko history: HTTP ${res.status}`);
  const json = await res.json();
  return (json.prices ?? [])
    .map((pair: [number, number]) => ({ t: pair[0], p: pair[1] }))
    .filter((x: PricePoint) => typeof x.p === "number");
}

/** Chiave di cache per lo storico di un asset (namespaced per provider). */
export function historyCacheKey(asset: Asset): string | null {
  if (!asset.symbol) return null;
  if (asset.priceSource === "coingecko") return `cg:${asset.symbol}`;
  if (asset.priceSource === "yahoo") return asset.symbol;
  return null;
}

/** Assicura (fetch + cache) lo storico 1 anno di un asset; null se non supportato. */
export async function ensureAssetHistory(asset: Asset): Promise<PricePoint[] | null> {
  const key = historyCacheKey(asset);
  if (!key || !asset.symbol) return null;
  const cached = await storage.get<PriceHistoryCache>("priceHistoryCache", key);
  if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < TTL) {
    return cached.points;
  }
  try {
    let points: PricePoint[] = [];
    if (asset.priceSource === "coingecko") {
      points = await fetchCryptoHistory(asset.symbol);
    } else {
      const res = await fetch(`/api/quote?symbol=${encodeURIComponent(asset.symbol)}&range=1y`);
      if (res.ok) {
        const json = await res.json();
        points = json.points ?? [];
      }
    }
    if (points.length > 0) {
      await storage.put("priceHistoryCache", {
        id: key,
        fetchedAt: new Date().toISOString(),
        currency: "EUR",
        points,
      });
      return points;
    }
    return cached?.points ?? null;
  } catch {
    return cached?.points ?? null;
  }
}
