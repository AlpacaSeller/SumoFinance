import { describe, expect, it } from "vitest";
import { deriveXpubAddresses, isExtendedKey } from "../prices/wallet";

// Vettori di test ufficiali BIP84 (native SegWit, zpub)
const ZPUB =
  "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";

describe("chiavi estese", () => {
  it("riconosce xpub/ypub/zpub", () => {
    expect(isExtendedKey(ZPUB)).toBe(true);
    expect(isExtendedKey("xpub6C…")).toBe(true);
    expect(isExtendedKey("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu")).toBe(false);
    expect(isExtendedKey("0xabc")).toBe(false);
  });

  it("zpub → indirizzi native SegWit (vettori BIP84)", async () => {
    const { addresses, script } = await deriveXpubAddresses(ZPUB, 0, 2);
    expect(script).toBe("p2wpkh");
    // m/84'/0'/0'/0/0 e /0/1
    expect(addresses[0]).toBe("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu");
    expect(addresses[1]).toBe("bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g");
  });

  it("zpub → primo indirizzo di change (BIP84 m/84'/0'/0'/1/0)", async () => {
    const { addresses } = await deriveXpubAddresses(ZPUB, 1, 1);
    expect(addresses[0]).toBe("bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el");
  });

  it("prefisso non valido → errore chiaro", async () => {
    await expect(deriveXpubAddresses("tpubABC", 0, 1)).rejects.toThrow(/non riconosciuta/);
  });
});
