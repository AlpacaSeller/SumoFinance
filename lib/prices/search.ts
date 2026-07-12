// ── Ricerca asset unificata (azioni/ETF via Yahoo + crypto via CoinGecko) ───
// Un solo campo di ricerca: selezionando un risultato l'app conosce già nome,
// ticker, simbolo, provider prezzo e classe. La tassazione si assegna poi in
// base alla classe (vedi form asset).

import type { AssetClass, PriceSource } from "../types";

export interface AssetSearchResult {
  id: string; // chiave univoca per la lista
  name: string;
  ticker: string; // ticker visibile
  symbol: string; // simbolo per la sync (Yahoo: "AAPL", CoinGecko: "bitcoin")
  exchange?: string;
  assetClass: AssetClass;
  priceSource: PriceSource;
  rank?: number; // market cap rank (solo crypto): più basso = più rilevante
}

function yahooClass(type: string): AssetClass | null {
  switch (type.toUpperCase()) {
    case "EQUITY":
      return "Azioni";
    case "ETF":
    case "MUTUALFUND":
      return "ETF";
    case "CRYPTOCURRENCY":
      return null; // le crypto le gestisce CoinGecko
    case "INDEX":
    case "CURRENCY":
    case "FUTURE":
    default:
      return "Altro";
  }
}

async function searchYahoo(query: string, signal?: AbortSignal): Promise<AssetSearchResult[]> {
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal });
    if (!res.ok) return [];
    const json = await res.json();
    const out: AssetSearchResult[] = [];
    for (const r of json.results ?? []) {
      const cls = yahooClass(r.type);
      if (!cls) continue;
      out.push({
        id: `y:${r.symbol}`,
        name: r.name,
        ticker: String(r.symbol).split(".")[0],
        symbol: r.symbol,
        exchange: r.exchange,
        assetClass: cls,
        priceSource: "yahoo",
      });
    }
    return out;
  } catch {
    return [];
  }
}

async function searchCoinGecko(query: string, signal?: AbortSignal): Promise<AssetSearchResult[]> {
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`,
      { signal }
    );
    if (!res.ok) return [];
    const json = await res.json();
    return (json.coins ?? []).slice(0, 8).map((c: Record<string, unknown>) => ({
      id: `c:${c.id}`,
      name: String(c.name),
      ticker: String(c.symbol ?? "").toUpperCase(),
      symbol: String(c.id),
      exchange: "CoinGecko",
      assetClass: "Crypto" as AssetClass,
      priceSource: "coingecko" as PriceSource,
      rank: typeof c.market_cap_rank === "number" ? c.market_cap_rank : undefined,
    }));
  } catch {
    return [];
  }
}

/** Ricerca combinata; ordina mettendo davanti chi ha il ticker esatto. */
export async function searchAssets(
  query: string,
  signal?: AbortSignal
): Promise<AssetSearchResult[]> {
  const q = query.trim();
  if (q.length < 1) return [];
  const [yahoo, coingecko] = await Promise.all([
    searchYahoo(q, signal),
    searchCoinGecko(q, signal),
  ]);
  const merged = [...yahoo, ...coingecko];
  const ql = q.toLowerCase();
  return merged
    .map((r, i) => {
      let score = i;
      // una crypto poco capitalizzata (o senza ranking) non deve scavalcare le
      // azioni/ETF note solo perché ha il ticker uguale al testo cercato
      const obscureCrypto = r.assetClass === "Crypto" && (r.rank == null || r.rank > 100);
      if (r.ticker.toLowerCase() === ql) score -= obscureCrypto ? 10 : 100;
      else if (r.name.toLowerCase() === ql) score -= 50;
      else if (r.ticker.toLowerCase().startsWith(ql)) score -= 20;
      if (obscureCrypto) score += 40;
      return { r, score };
    })
    .sort((a, b) => a.score - b.score)
    .map((x) => x.r)
    .slice(0, 12);
}
