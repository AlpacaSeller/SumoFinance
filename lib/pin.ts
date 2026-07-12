// ── PIN: solo hash SHA-256 con salt, mai in chiaro ──────────────────────────
// Protegge da occhi indiscreti sul dispositivo; NON è crittografia dei dati.

export function randomSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashPin(pin: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyPin(pin: string, salt: string, expectedHash: string): Promise<boolean> {
  return (await hashPin(pin, salt)) === expectedHash;
}

const UNLOCK_KEY = "pfos-unlocked";
const listeners = new Set<() => void>();

export function isUnlocked(): boolean {
  try {
    return sessionStorage.getItem(UNLOCK_KEY) === "1";
  } catch {
    return true;
  }
}

export function setUnlocked(v: boolean): void {
  try {
    if (v) sessionStorage.setItem(UNLOCK_KEY, "1");
    else sessionStorage.removeItem(UNLOCK_KEY);
  } catch {
    // storage non disponibile: nessun blocco
  }
  for (const l of listeners) l();
}

/** Sottoscrizione allo stato di sblocco (per useSyncExternalStore) */
export function subscribeUnlock(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
