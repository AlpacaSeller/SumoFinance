// ── Cache condivisa dei dati di mercato (Supabase, solo lato server) ────────
// I proxy /api/* girano su serverless: la cache in-memory vive solo dentro la
// singola istanza. Questa cache L2 su Supabase è condivisa da TUTTE le istanze
// e da tutti gli utenti: una sola richiesta upstream per chiave per finestra
// di TTL, chiunque la chieda. Contiene solo payload pubblici di mercato.
//
// Robustezza: se le env mancano (sviluppo locale senza Supabase) o Supabase
// non risponde entro 3 s, le funzioni degradano in silenzio (null / no-op) e
// il proxy si comporta come prima. Mai bloccare una quotazione per la cache.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

export interface SharedCacheHit {
  payload: unknown;
  /** età della voce in millisecondi */
  ageMs: number;
}

function headers(): Record<string, string> {
  return {
    apikey: SUPABASE_KEY as string,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
  };
}

export function sharedCacheEnabled(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

export async function sharedCacheGet(key: string): Promise<SharedCacheHit | null> {
  if (!sharedCacheEnabled()) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/price_cache?key=eq.${encodeURIComponent(key)}&select=payload,fetched_at`,
      { headers: headers(), signal: AbortSignal.timeout(3000), cache: "no-store" }
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as { payload: unknown; fetched_at: string }[];
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const ageMs = Date.now() - new Date(rows[0].fetched_at).getTime();
    return { payload: rows[0].payload, ageMs: Number.isFinite(ageMs) ? ageMs : Infinity };
  } catch {
    return null;
  }
}

export async function sharedCacheSet(key: string, payload: unknown): Promise<void> {
  if (!sharedCacheEnabled()) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/price_cache?on_conflict=key`, {
      method: "POST",
      headers: { ...headers(), Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify([{ key, payload, fetched_at: new Date().toISOString() }]),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // best effort: la cache condivisa non deve mai far fallire il proxy
  }
}
