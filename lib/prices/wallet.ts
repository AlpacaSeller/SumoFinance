// ── Saldi on-chain da indirizzo pubblico ────────────────────────────────────
// Solo lettura, solo public key: la quantità dell'asset si sincronizza dalla
// chain, il prezzo resta al provider (CoinGecko). Chiamate dirette dal browser
// verso endpoint pubblici senza chiave. Nota privacy (dichiarata in UI):
// il provider interrogato può associare l'indirizzo al tuo IP.

import type { HDKey as HDKeyType } from "@scure/bip32";
import type { WalletChain } from "../types";

const ETH_RPCS = ["https://cloudflare-eth.com", "https://eth.llamarpc.com"];
const SOL_RPC = "https://api.mainnet-beta.solana.com";

// ── Derivazione indirizzi da chiave estesa pubblica (xpub/ypub/zpub) ────────
// Solo lettura: dalla chiave pubblica estesa si derivano gli indirizzi e se ne
// legge il saldo on-chain. Nessuna chiave privata è mai coinvolta.
// Le librerie crittografiche (@scure/@noble) si caricano on-demand: pesano nel
// bundle e servono solo a chi traccia un wallet HD.

type ScriptType = "p2pkh" | "p2sh-p2wpkh" | "p2wpkh";

interface BtcCrypto {
  HDKey: typeof HDKeyType;
  encodeAddress: (pubkey: Uint8Array, script: ScriptType) => string;
}

let btcCryptoPromise: Promise<BtcCrypto> | null = null;

function loadBtcCrypto(): Promise<BtcCrypto> {
  btcCryptoPromise ??= (async () => {
    const [{ HDKey }, { base58check: b58Factory, bech32 }, { sha256 }, { ripemd160 }] =
      await Promise.all([
        import("@scure/bip32"),
        import("@scure/base"),
        import("@noble/hashes/sha256"),
        import("@noble/hashes/ripemd160"),
      ]);
    const base58check = b58Factory(sha256);
    const hash160 = (data: Uint8Array) => ripemd160(sha256(data));
    const encodeAddress = (pubkey: Uint8Array, script: ScriptType): string => {
      const h = hash160(pubkey);
      if (script === "p2wpkh") {
        // SegWit nativo: bech32(hrp="bc", [witnessVersion=0, ...program])
        return bech32.encode("bc", [0, ...bech32.toWords(h)]);
      }
      if (script === "p2sh-p2wpkh") {
        // redeemScript = OP_0 <20-byte hash>; indirizzo P2SH del suo hash160
        const redeem = new Uint8Array([0x00, 0x14, ...h]);
        return base58check.encode(new Uint8Array([0x05, ...hash160(redeem)]));
      }
      // legacy P2PKH
      return base58check.encode(new Uint8Array([0x00, ...h]));
    };
    return { HDKey, encodeAddress };
  })();
  return btcCryptoPromise;
}

// version bytes (public) per prefisso della chiave estesa
const XPUB_VERSIONS: Record<string, { version: number; script: ScriptType }> = {
  xpub: { version: 0x0488b21e, script: "p2pkh" },
  ypub: { version: 0x049d7cb2, script: "p2sh-p2wpkh" },
  zpub: { version: 0x04b24746, script: "p2wpkh" },
};

export function isExtendedKey(s: string): boolean {
  const p = s.trim().slice(0, 4).toLowerCase();
  return p === "xpub" || p === "ypub" || p === "zpub";
}

async function parseExtendedKey(
  extendedKey: string
): Promise<{ node: HDKeyType; script: ScriptType; encodeAddress: BtcCrypto["encodeAddress"] }> {
  const prefix = extendedKey.trim().slice(0, 4).toLowerCase();
  const info = XPUB_VERSIONS[prefix];
  if (!info) throw new Error("Chiave estesa non riconosciuta (attese xpub/ypub/zpub)");
  const { HDKey, encodeAddress } = await loadBtcCrypto();
  // le version bytes ypub/zpub non sono standard per la libreria: le dichiariamo
  const node = HDKey.fromExtendedKey(extendedKey.trim(), {
    public: info.version,
    private: 0x0, // non usata: solo chiave pubblica
  });
  return { node, script: info.script, encodeAddress };
}

/** Deriva `count` indirizzi (external=0 o change=1) da una chiave estesa. */
export async function deriveXpubAddresses(
  extendedKey: string,
  change: 0 | 1,
  count: number
): Promise<{ addresses: string[]; script: ScriptType }> {
  const { node, script, encodeAddress } = await parseExtendedKey(extendedKey);
  const branch = node.deriveChild(change);
  const addresses: string[] = [];
  for (let i = 0; i < count; i++) {
    const child = branch.deriveChild(i);
    if (!child.publicKey) throw new Error("Derivazione fallita");
    addresses.push(encodeAddress(child.publicKey, script));
  }
  return { addresses, script };
}

interface AddressStats {
  balanceSat: number;
  used: boolean;
}

async function fetchAddressStats(address: string): Promise<AddressStats> {
  const res = await fetch(`https://mempool.space/api/address/${encodeURIComponent(address)}`, {
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`mempool.space: HTTP ${res.status}`);
  const json = await res.json();
  const c = json?.chain_stats ?? {};
  const m = json?.mempool_stats ?? {};
  const balanceSat = (c.funded_txo_sum ?? 0) - (c.spent_txo_sum ?? 0) + (m.funded_txo_sum ?? 0) - (m.spent_txo_sum ?? 0);
  const used = (c.tx_count ?? 0) > 0 || (m.tx_count ?? 0) > 0;
  return { balanceSat, used };
}

const GAP_LIMIT = 20;
const MAX_ADDRESSES = 60; // tetto di sicurezza sulle chiamate a mempool.space

/** Somma il saldo (BTC) di tutti gli indirizzi derivati da una chiave estesa,
 *  scandendo external (0) e change (1) fino al gap limit. */
export async function fetchXpubBalance(extendedKey: string): Promise<number> {
  const { node, script, encodeAddress } = await parseExtendedKey(extendedKey);
  let totalSat = 0;
  let scanned = 0;
  for (const change of [0, 1] as const) {
    const branch = node.deriveChild(change);
    let consecutiveUnused = 0;
    let index = 0;
    while (consecutiveUnused < GAP_LIMIT && scanned < MAX_ADDRESSES) {
      const child = branch.deriveChild(index);
      if (!child.publicKey) break;
      const address = encodeAddress(child.publicKey, script);
      const stats = await fetchAddressStats(address);
      scanned++;
      totalSat += stats.balanceSat;
      consecutiveUnused = stats.used ? 0 : consecutiveUnused + 1;
      index++;
    }
  }
  return totalSat / 1e8;
}

/** hex (wei/unità minime) → numero in unità intere del token */
export function hexToUnits(hex: string, decimals: number): number {
  const clean = hex?.startsWith("0x") ? hex.slice(2) : hex;
  if (!clean || !/^[0-9a-fA-F]+$/.test(clean)) return 0;
  const value = BigInt("0x" + clean);
  // divisione in BigInt con 6 cifre di precisione per evitare overflow di Number
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = Number((value % base) * 1_000_000n / base) / 1_000_000;
  return Number(whole) + frac;
}

/** calldata di balanceOf(address) per gli ERC-20 */
export function erc20BalanceOfData(address: string): string {
  const clean = address.toLowerCase().replace(/^0x/, "");
  return "0x70a08231" + clean.padStart(64, "0");
}

async function ethRpc(method: string, params: unknown[]): Promise<string> {
  let lastError: Error | null = null;
  for (const url of ETH_RPCS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`RPC ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error.message || "errore RPC");
      return json.result as string;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error("errore RPC");
    }
  }
  throw lastError ?? new Error("RPC non raggiungibile");
}

export async function fetchWalletBalance(
  chain: WalletChain,
  address: string,
  tokenContract?: string,
  tokenDecimals = 18
): Promise<number> {
  const addr = address.trim();
  if (!addr) throw new Error("Indirizzo mancante");

  if (chain === "bitcoin") {
    // chiave estesa (xpub/ypub/zpub): somma tutti gli indirizzi derivati
    if (isExtendedKey(addr)) {
      return fetchXpubBalance(addr);
    }
    // indirizzo singolo
    const res = await fetch(`https://mempool.space/api/address/${encodeURIComponent(addr)}`, {
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`mempool.space: HTTP ${res.status}`);
    const json = await res.json();
    const funded = json?.chain_stats?.funded_txo_sum ?? 0;
    const spent = json?.chain_stats?.spent_txo_sum ?? 0;
    return (funded - spent) / 1e8;
  }

  if (chain === "ethereum") {
    if (tokenContract?.trim()) {
      const result = await ethRpc("eth_call", [
        { to: tokenContract.trim(), data: erc20BalanceOfData(addr) },
        "latest",
      ]);
      return hexToUnits(result, tokenDecimals);
    }
    const result = await ethRpc("eth_getBalance", [addr, "latest"]);
    return hexToUnits(result, 18);
  }

  // solana
  const res = await fetch(SOL_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [addr] }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Solana RPC: HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || "errore Solana RPC");
  return (json.result?.value ?? 0) / 1e9;
}
