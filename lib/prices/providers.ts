// ── Provider prezzi ─────────────────────────────────────────────────────────
// Interfaccia PriceProvider + implementazioni CoinGecko (diretta), Yahoo
// (via proxy /api/quote), Twelve Data (diretta con chiave), Frankfurter
// (cambi BCE per la conversione in EUR).

export interface Quote {
  price: number; // nella valuta `currency`
  currency: string; // es. "EUR", "USD"
  timestamp: string; // ISO
}

export interface PriceProvider {
  getQuote(symbol: string): Promise<Quote>;
}

export class CoinGeckoProvider implements PriceProvider {
  async getQuote(symbol: string): Promise<Quote> {
    const id = symbol.trim().toLowerCase();
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=eur`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) throw new Error(`CoinGecko: HTTP ${res.status}`);
    const json = await res.json();
    const price = json?.[id]?.eur;
    if (typeof price !== "number") throw new Error(`CoinGecko: id "${id}" non trovato`);
    return { price, currency: "EUR", timestamp: new Date().toISOString() };
  }
}

/** Yahoo Finance via proxy /api/quote (l'endpoint Yahoo non consente CORS) */
export class YahooProvider implements PriceProvider {
  async getQuote(symbol: string): Promise<Quote> {
    const res = await fetch(`/api/quote?symbol=${encodeURIComponent(symbol.trim())}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error || `Yahoo: HTTP ${res.status}`);
    }
    const json = await res.json();
    if (typeof json.price !== "number") throw new Error("Yahoo: prezzo non disponibile");
    return { price: json.price, currency: json.currency || "EUR", timestamp: json.timestamp };
  }
}

export class TwelveDataProvider implements PriceProvider {
  constructor(
    private apiKey: string,
    private declaredCurrency: string = "EUR"
  ) {}
  async getQuote(symbol: string): Promise<Quote> {
    const res = await fetch(
      `https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbol.trim())}&apikey=${encodeURIComponent(this.apiKey)}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) throw new Error(`Twelve Data: HTTP ${res.status}`);
    const json = await res.json();
    if (json.status === "error") throw new Error(`Twelve Data: ${json.message}`);
    const price = Number(json.price);
    if (!Number.isFinite(price)) throw new Error("Twelve Data: prezzo non valido");
    // /price non restituisce la valuta: si usa quella dichiarata sull'asset
    return { price, currency: this.declaredCurrency, timestamp: new Date().toISOString() };
  }
}

// ── Frankfurter: cambi ufficiali BCE, cache in memoria per sessione ─────────

const rateCache = new Map<string, { rate: number; at: number }>();
const RATE_TTL = 6 * 60 * 60 * 1000;

/** Tasso di conversione `from` → EUR (1 se from è già EUR) */
export async function eurRate(from: string): Promise<number> {
  const cur = from.toUpperCase();
  if (cur === "EUR") return 1;
  const cached = rateCache.get(cur);
  if (cached && Date.now() - cached.at < RATE_TTL) return cached.rate;
  const res = await fetch(
    `https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(cur)}&symbols=EUR`,
    { signal: AbortSignal.timeout(10000) }
  );
  if (!res.ok) throw new Error(`Frankfurter: HTTP ${res.status}`);
  const json = await res.json();
  const rate = json?.rates?.EUR;
  if (typeof rate !== "number") throw new Error(`Frankfurter: cambio ${cur}→EUR non disponibile`);
  rateCache.set(cur, { rate, at: Date.now() });
  return rate;
}

/** GBp (pence) → GBP: Yahoo quota i titoli LSE in pence */
export function normalizeCurrency(price: number, currency: string): { price: number; currency: string } {
  if (currency === "GBp") return { price: price / 100, currency: "GBP" };
  return { price, currency };
}
