// ── Backup cifrato con passphrase ───────────────────────────────────────────
// WebCrypto: chiave derivata con PBKDF2 (SHA-256, 310k iterazioni, salt
// casuale) e cifratura AES-GCM 256 (IV casuale, autenticata: una passphrase
// sbagliata o un file manomesso falliscono in modo pulito).
// ATTENZIONE (dichiarata in UI): senza passphrase il backup è irrecuperabile.

import type { BackupFile } from "./types";

const KDF_ITERATIONS = 310_000;

export interface EncryptedBackupFile {
  app: "PFOS";
  format: "encrypted-backup";
  version: 1;
  exportedAt: string;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  cipher: { name: "AES-GCM"; iv: string };
  data: string; // ciphertext base64
}

export function isEncryptedBackup(json: unknown): json is EncryptedBackupFile {
  const j = json as EncryptedBackupFile;
  return (
    !!j &&
    j.app === "PFOS" &&
    j.format === "encrypted-backup" &&
    j.version === 1 &&
    typeof j.data === "string" &&
    !!j.kdf?.salt &&
    !!j.cipher?.iv
  );
}

function toBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptBackup(
  backup: BackupFile,
  passphrase: string
): Promise<EncryptedBackupFile> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, KDF_ITERATIONS);
  const plaintext = new TextEncoder().encode(JSON.stringify(backup));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    plaintext
  );
  return {
    app: "PFOS",
    format: "encrypted-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: KDF_ITERATIONS, salt: toBase64(salt) },
    cipher: { name: "AES-GCM", iv: toBase64(iv) },
    data: toBase64(ciphertext),
  };
}

/** Lancia un errore se la passphrase è sbagliata o il file è manomesso. */
export async function decryptBackup(
  file: EncryptedBackupFile,
  passphrase: string
): Promise<BackupFile> {
  const key = await deriveKey(
    passphrase,
    fromBase64(file.kdf.salt),
    file.kdf.iterations || KDF_ITERATIONS
  );
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(file.cipher.iv) as BufferSource },
      key,
      fromBase64(file.data) as BufferSource
    );
  } catch {
    throw new Error("Passphrase errata o file danneggiato.");
  }
  const backup = JSON.parse(new TextDecoder().decode(plaintext)) as BackupFile;
  if (backup.app !== "PFOS" || backup.version !== 1) {
    throw new Error("Il contenuto decifrato non è un backup valido dell'app.");
  }
  return backup;
}
