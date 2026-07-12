import { describe, expect, it } from "vitest";
import { decryptBackup, encryptBackup, isEncryptedBackup } from "../cryptoBackup";
import type { BackupFile } from "../types";

const backup: BackupFile = {
  app: "PFOS",
  version: 1,
  exportedAt: "2026-07-12T10:00:00Z",
  data: {
    accounts: [{ id: "c1", name: "Conto è ✓", type: "conto corrente", balance: 1234.56 }],
    incomes: [],
  },
};

describe("backup cifrato", () => {
  it("roundtrip: cifra e decifra con la stessa passphrase", async () => {
    const enc = await encryptBackup(backup, "passphrase-super-segreta");
    expect(isEncryptedBackup(enc)).toBe(true);
    expect(JSON.stringify(enc)).not.toContain("Conto è"); // niente dati in chiaro
    const dec = await decryptBackup(enc, "passphrase-super-segreta");
    expect(dec).toEqual(backup);
  });

  it("passphrase sbagliata → errore pulito", async () => {
    const enc = await encryptBackup(backup, "quella-giusta!");
    await expect(decryptBackup(enc, "quella-sbagliata")).rejects.toThrow(/Passphrase errata/);
  });

  it("file manomesso → errore (AES-GCM autenticato)", async () => {
    const enc = await encryptBackup(backup, "passphrase-ok88");
    const tampered = { ...enc, data: enc.data.slice(0, -4) + "AAAA" };
    await expect(decryptBackup(tampered, "passphrase-ok88")).rejects.toThrow();
  });

  it("salt e IV casuali: due export dello stesso contenuto differiscono", async () => {
    const a = await encryptBackup(backup, "stessa-passphrase");
    const b = await encryptBackup(backup, "stessa-passphrase");
    expect(a.data).not.toBe(b.data);
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
  });

  it("isEncryptedBackup rifiuta i backup in chiaro", () => {
    expect(isEncryptedBackup(backup)).toBe(false);
  });
});
