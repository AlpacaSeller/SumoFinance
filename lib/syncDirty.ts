// ── Flag "dati modificati" per il sync tra dispositivi ──────────────────────
// Modulo minuscolo e senza dipendenze (lo importa DexieAdapter: attenzione ai
// cicli). Ogni scrittura utente marca il timestamp in localStorage; il sync lo
// legge per decidere se spingere e lo azzera dopo un push riuscito. Durante
// l'import di un blob remoto la marcatura è sospesa (non è una modifica
// locale).

const KEY = "pfos-sync-dirty";
let suppressed = false;

export function markSyncDirty(): void {
  if (suppressed || typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, String(Date.now()));
  } catch {
    // storage pieno o negato: il sync spingerà comunque al prossimo open
  }
}

/** Timestamp (ms) dell'ultima modifica locale non ancora sincronizzata, o 0. */
export function syncDirtyAt(): number {
  if (typeof window === "undefined") return 0;
  try {
    return Number(localStorage.getItem(KEY) || 0);
  } catch {
    return 0;
  }
}

export function clearSyncDirty(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* niente */
  }
}

/** Esegue fn senza marcare dirty (usato dall'import del blob remoto). */
export async function withSyncDirtySuppressed<T>(fn: () => Promise<T>): Promise<T> {
  suppressed = true;
  try {
    return await fn();
  } finally {
    suppressed = false;
  }
}
