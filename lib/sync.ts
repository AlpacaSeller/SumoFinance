// ── Sync E2E tra dispositivi ────────────────────────────────────────────────
// Modello senza account: un "codice sync" ad alta entropia (~100 bit) più una
// passphrase collegano i dispositivi. Il backup completo viene cifrato SUL
// dispositivo (PBKDF2 310k + AES-GCM 256, riuso di cryptoBackup) e depositato
// come blob via /api/sync: il server non può leggere nulla.
//
// Strategia di merge: last-write-wins sull'intero dataset. All'apertura si
// confronta l'orologio del blob remoto con l'ultima modifica locale non
// spinta: vince il più recente. Per un singolo utente che alterna i
// dispositivi è il comportamento atteso; niente merge riga per riga (v1).
//
// La passphrase vive SOLO in localStorage di ciascun dispositivo (mai nei
// backup, mai sul server): il dispositivo è considerato fidato, come per il
// PIN. Il codice sync invece sta nelle Settings (viaggia col dataset: gli
// altri dispositivi del gruppo lo conoscono già).

import { storage } from "./storage";
import { decryptBackup, encryptBackup, isEncryptedBackup } from "./cryptoBackup";
import { clearSyncDirty, syncDirtyAt, withSyncDirtySuppressed } from "./syncDirty";
import type { Settings } from "./types";

const PASS_KEY = "pfos-sync-pass";
const REMOTE_MARK_KEY = "pfos-sync-remote-updated";
const LAST_SYNC_KEY = "pfos-sync-last";

// base32 Crockford minuscolo senza caratteri ambigui (0/O, 1/I/L)
const ALPHABET = "abcdefghjkmnpqrstvwxyz23456789";

export function generateSyncCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let out = "";
  for (let i = 0; i < 20; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** "abcd-efgh-…" → "abcdefgh…" (accetta input incollato con trattini/spazi) */
export function normalizeSyncCode(input: string): string {
  return input.toLowerCase().replace(/[^a-z2-9]/g, "");
}

export function formatSyncCode(code: string): string {
  return code.replace(/(.{5})(?=.)/g, "$1-");
}

function getPass(): string | null {
  try {
    return localStorage.getItem(PASS_KEY);
  } catch {
    return null;
  }
}

export function lastSyncAt(): string | null {
  try {
    return localStorage.getItem(LAST_SYNC_KEY);
  } catch {
    return null;
  }
}

async function getSettings(): Promise<Settings | undefined> {
  return storage.get<Settings>("settings", "main");
}

/** Il sync è attivo su questo dispositivo (codice + passphrase presenti). */
export async function syncEnabled(): Promise<boolean> {
  const s = await getSettings();
  return Boolean(s?.syncId && getPass());
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* niente */
  }
}

/** Cifra e deposita il dataset corrente. Lancia in caso di errore di rete. */
export async function pushSync(): Promise<void> {
  const s = await getSettings();
  const pass = getPass();
  if (!s?.syncId || !pass) return;
  const backup = await storage.exportAll();
  const envelope = await encryptBackup(backup, pass);
  const res = await fetch("/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: s.syncId, blob: JSON.stringify(envelope) }),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error || "Push del sync fallito");
  }
  const { updatedAt } = (await res.json()) as { updatedAt: string };
  remember(REMOTE_MARK_KEY, updatedAt);
  remember(LAST_SYNC_KEY, new Date().toISOString());
  clearSyncDirty();
}

export type SyncResult =
  | "disattivo"
  | "aggiornato" // niente da fare
  | "importato" // dati remoti più recenti importati
  | "spinto" // modifiche locali spinte
  | "errore";

/** Sincronizzazione all'apertura: decide da sola la direzione (LWW). */
export async function syncOnOpen(): Promise<SyncResult> {
  const s = await getSettings();
  const pass = getPass();
  if (!s?.syncId || !pass) return "disattivo";
  try {
    const res = await fetch(`/api/sync?id=${s.syncId}`, { cache: "no-store" });
    if (res.status === 404) {
      // deposito vuoto (primo push mai riuscito?): spingi il locale
      await pushSync();
      return "spinto";
    }
    if (!res.ok) return "errore";
    const { blob, updatedAt } = (await res.json()) as { blob: string; updatedAt: string };

    const knownRemote = localStorage.getItem(REMOTE_MARK_KEY);
    const dirtyAt = syncDirtyAt();

    if (updatedAt === knownRemote) {
      // il remoto è quello che conosciamo: spingi solo se c'è roba nuova locale
      if (dirtyAt > 0) {
        await pushSync();
        return "spinto";
      }
      return "aggiornato";
    }

    // il remoto è cambiato (un altro dispositivo ha spinto)
    const remoteMs = new Date(updatedAt).getTime();
    if (dirtyAt > remoteMs) {
      // modifiche locali più recenti del blob remoto: vince il locale
      await pushSync();
      return "spinto";
    }
    // vince il remoto: importa (senza marcare dirty)
    const parsed = JSON.parse(blob) as unknown;
    if (!isEncryptedBackup(parsed)) return "errore";
    const backup = await decryptBackup(parsed, pass);
    await withSyncDirtySuppressed(() => storage.importAll(backup));
    clearSyncDirty();
    remember(REMOTE_MARK_KEY, updatedAt);
    remember(LAST_SYNC_KEY, new Date().toISOString());
    return "importato";
  } catch {
    return "errore";
  }
}

/** Attiva il sync su questo dispositivo creando un nuovo gruppo. */
export async function createSync(passphrase: string): Promise<string> {
  const s = await getSettings();
  if (!s) throw new Error("Impostazioni non pronte");
  const code = generateSyncCode();
  remember(PASS_KEY, passphrase);
  await storage.put("settings", { ...s, syncId: code });
  await pushSync();
  return code;
}

/** Collega questo dispositivo a un sync esistente (importa il dataset). */
export async function connectSync(codeInput: string, passphrase: string): Promise<void> {
  const code = normalizeSyncCode(codeInput);
  if (code.length !== 20) throw new Error("Il codice sync deve avere 20 caratteri");
  const res = await fetch(`/api/sync?id=${code}`, { cache: "no-store" });
  if (res.status === 404) throw new Error("Nessun sync trovato con questo codice");
  if (!res.ok) throw new Error("Deposito non raggiungibile: riprova");
  const { blob, updatedAt } = (await res.json()) as { blob: string; updatedAt: string };
  const parsed = JSON.parse(blob) as unknown;
  if (!isEncryptedBackup(parsed)) throw new Error("Blob remoto non riconosciuto");
  const backup = await decryptBackup(parsed, passphrase); // lancia se passphrase errata
  await withSyncDirtySuppressed(() => storage.importAll(backup));
  clearSyncDirty();
  // il dataset importato porta già syncId nelle settings; assicura coerenza
  const s = await getSettings();
  if (s && s.syncId !== code) await storage.put("settings", { ...s, syncId: code });
  remember(PASS_KEY, passphrase);
  remember(REMOTE_MARK_KEY, updatedAt);
  remember(LAST_SYNC_KEY, new Date().toISOString());
}

/** Scollega questo dispositivo; opzionalmente elimina il blob dal cloud. */
export async function disconnectSync(deleteRemote: boolean): Promise<void> {
  const s = await getSettings();
  if (deleteRemote && s?.syncId) {
    await fetch(`/api/sync?id=${s.syncId}`, { method: "DELETE" }).catch(() => undefined);
  }
  if (s?.syncId) {
    const rest = { ...s };
    delete rest.syncId;
    await storage.put("settings", rest);
  }
  try {
    localStorage.removeItem(PASS_KEY);
    localStorage.removeItem(REMOTE_MARK_KEY);
    localStorage.removeItem(LAST_SYNC_KEY);
  } catch {
    /* niente */
  }
}
