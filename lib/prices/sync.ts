// ── Orchestrazione della sincronizzazione prezzi ────────────────────────────
// Sync automatica all'apertura se sono passate > 6 ore (throttling per i
// limiti gratuiti), sync manuale globale o per singolo asset. In caso di
// errore l'ultimo prezzo resta valido: mai bloccare l'app per la rete.

import { storage } from "../storage";
import type { Account, Asset, Settings } from "../types";
import {
  CoinGeckoProvider,
  TwelveDataProvider,
  YahooProvider,
  eurRate,
  normalizeCurrency,
  type Quote,
} from "./providers";
import { fetchWalletBalance } from "./wallet";

export interface SyncResult {
  assetId: string;
  name: string;
  ok: boolean;
  error?: string;
  price?: number;
}

const coingecko = new CoinGeckoProvider();
const yahoo = new YahooProvider();

async function fetchQuote(asset: Asset, settings: Settings): Promise<Quote> {
  const symbol = asset.symbol?.trim();
  if (!symbol) throw new Error("Nessun simbolo impostato");

  if (asset.priceSource === "coingecko") return coingecko.getQuote(symbol);

  if (asset.priceSource === "twelvedata") {
    if (!settings.twelveDataApiKey) throw new Error("Chiave Twelve Data non configurata");
    return new TwelveDataProvider(settings.twelveDataApiKey, asset.quoteCurrency || "EUR").getQuote(symbol);
  }

  // yahoo (default universale) con fallback automatico su Twelve Data
  try {
    return await yahoo.getQuote(symbol);
  } catch (err) {
    if (settings.twelveDataApiKey) {
      const tdSymbol = symbol.includes(":") ? symbol : symbol.replace(".", ":");
      return new TwelveDataProvider(settings.twelveDataApiKey, asset.quoteCurrency || "EUR").getQuote(tdSymbol);
    }
    throw err;
  }
}

/** Sincronizza un singolo asset: quantità dal wallet on-chain (se collegato)
 *  e prezzo dal provider (convertito in EUR). */
export async function syncAsset(asset: Asset, settings: Settings): Promise<SyncResult> {
  let current = asset;

  // 1. quantità dal wallet (indipendente dalla fonte prezzo)
  if (asset.walletChain && asset.walletAddress) {
    try {
      const quantity = await fetchWalletBalance(
        asset.walletChain,
        asset.walletAddress,
        asset.tokenContract,
        asset.tokenDecimals ?? 18
      );
      // la chain è la fonte di verità della posizione: base = on-chain
      current = {
        ...current,
        quantity,
        baseQuantity: quantity,
        lastSyncAt: new Date().toISOString(),
      };
      await storage.put("assets", current);
    } catch (err) {
      return {
        assetId: asset.id,
        name: asset.name,
        ok: false,
        error: `wallet: ${err instanceof Error ? err.message : "errore"}`,
      };
    }
  }

  // 2. prezzo dal provider
  if (current.priceSource === "manuale") {
    return { assetId: current.id, name: current.name, ok: true, price: current.currentPrice };
  }
  try {
    const raw = await fetchQuote(current, settings);
    const { price, currency } = normalizeCurrency(raw.price, raw.currency);
    const rate = await eurRate(currency);
    const eurPrice = price * rate;
    const updated: Asset = {
      ...current,
      currentPrice: eurPrice,
      quoteCurrency: currency,
      lastSyncAt: new Date().toISOString(),
    };
    await storage.put("assets", updated);
    return { assetId: asset.id, name: asset.name, ok: true, price: eurPrice };
  } catch (err) {
    return {
      assetId: asset.id,
      name: asset.name,
      ok: false,
      error: err instanceof Error ? err.message : "Errore sconosciuto",
    };
  }
}

/** Sincronizza tutti gli asset non manuali, in sequenza (rate limit friendly). */
export async function syncAllAssets(): Promise<SyncResult[]> {
  const [assets, settings] = await Promise.all([
    storage.list<Asset>("assets"),
    storage.get<Settings>("settings", "main"),
  ]);
  if (!settings) return [];
  const results: SyncResult[] = [];
  for (const asset of assets) {
    const hasWallet = Boolean(asset.walletChain && asset.walletAddress);
    if (asset.priceSource === "manuale" && !hasWallet) continue;
    results.push(await syncAsset(asset, settings));
  }
  if (results.length > 0) {
    await storage.put("settings", { ...settings, lastPriceSyncAt: new Date().toISOString() });
  }
  return results;
}

/** Aggiorna i cambi verso EUR dei conti in valuta estera (cache in Account). */
export async function refreshAccountRates(): Promise<void> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  const accounts = await storage.list<Account>("accounts");
  for (const a of accounts) {
    if (!a.currency || a.currency === "EUR") continue;
    try {
      const rate = await eurRate(a.currency);
      if (rate !== a.eurRate) await storage.put("accounts", { ...a, eurRate: rate });
    } catch {
      // offline o cambio non disponibile: resta l'ultimo cambio noto
    }
  }
}

/** Sync all'apertura: solo se abilitata, online e > 6 ore dall'ultima. */
export async function autoSyncIfDue(): Promise<SyncResult[] | null> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return null;
  const settings = await storage.get<Settings>("settings", "main");
  if (!settings || !settings.syncOnOpen) return null;
  if (settings.lastPriceSyncAt) {
    const elapsed = Date.now() - new Date(settings.lastPriceSyncAt).getTime();
    if (elapsed < 6 * 60 * 60 * 1000) return null;
  }
  return syncAllAssets();
}
