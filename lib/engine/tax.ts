// ── Tasse (regime italiano, semplificato) ───────────────────────────────────
// 26% standard, 12,5% titoli di Stato whitelist, 33% crypto dal 2026
// (legge di bilancio 2025: 26% fino al 31/12/2025, 33% dal 1/1/2026).
// Stime indicative: non considerano bollo 0,20%, IVAFE, regimi esteri.

import type { Asset, LossPot, TaxState } from "../types";
import { assetCost, assetValue } from "./aggregates";

export const TAX_RATE_STANDARD = 0.26;
export const TAX_RATE_WHITELIST = 0.125;
export const TAX_RATE_CRYPTO_2026 = 0.33;

/** Aliquota per asset e anno di realizzo (default: anno corrente). */
export function taxRate(asset: Asset, year: number = new Date().getFullYear()): number {
  if (asset.taxRegime === "whitelist") return TAX_RATE_WHITELIST;
  if (asset.assetClass === "Crypto") {
    return year >= 2026 ? TAX_RATE_CRYPTO_2026 : TAX_RATE_STANDARD;
  }
  return TAX_RATE_STANDARD;
}

/** Plusvalenza non realizzata (può essere negativa) */
export function unrealizedGain(asset: Asset): number {
  return assetValue(asset) - assetCost(asset);
}

/** Tasse latenti = max(0, plusvalenza non realizzata) × aliquota */
export function latentTax(asset: Asset): number {
  return Math.max(0, unrealizedGain(asset)) * taxRate(asset);
}

export function totalLatentTax(assets: Asset[]): number {
  return assets.reduce((s, a) => s + latentTax(a), 0);
}

export function totalUnrealizedGain(assets: Asset[]): number {
  return assets.reduce((s, a) => s + unrealizedGain(a), 0);
}

/** Scadenza dello zainetto: 31/12 del 4° anno successivo alla formazione */
export function potExpiryYear(pot: LossPot): number {
  return pot.year + 4;
}

export function totalLossPot(tax: TaxState): number {
  return tax.lossPots.reduce((s, p) => s + p.amount, 0);
}

/** Minusvalenze che scadono entro fine dell'anno corrente */
export function expiringPots(tax: TaxState, currentYear: number): LossPot[] {
  return tax.lossPots.filter((p) => p.amount > 0 && potExpiryYear(p) <= currentYear);
}

/** Rimuove le minusvalenze ormai scadute (formazione > 4 anni fa) */
export function prunePots(pots: LossPot[], currentYear: number): LossPot[] {
  return pots.filter((p) => potExpiryYear(p) >= currentYear);
}

export interface TaxOptimizationHint {
  kind: "zainetto-scadenza" | "compensazione";
  text: string;
}

/** Suggerimenti di ottimizzazione fiscale (zainetto in scadenza vs plusvalenze latenti) */
export function taxOptimizationHints(
  tax: TaxState,
  assets: Asset[],
  currentYear: number,
  fmtEUR: (n: number) => string
): TaxOptimizationHint[] {
  const hints: TaxOptimizationHint[] = [];
  const expiring = expiringPots(tax, currentYear);
  const expiringTotal = expiring.reduce((s, p) => s + p.amount, 0);
  // Nota: in Italia lo zainetto compensa i "redditi diversi" (plusvalenze da
  // cessione), non i dividendi. Semplificazione dichiarata.
  const latentGains = assets
    .map((a) => ({ a, g: unrealizedGain(a) }))
    .filter((x) => x.g > 0)
    .sort((x, y) => y.g - x.g);
  const totalLatentGains = latentGains.reduce((s, x) => s + x.g, 0);

  if (expiringTotal > 0) {
    if (totalLatentGains > 0) {
      const usable = Math.min(expiringTotal, totalLatentGains);
      hints.push({
        kind: "zainetto-scadenza",
        text: `Hai ${fmtEUR(expiringTotal)} di minusvalenze che scadono il 31/12/${currentYear}. Realizzando plusvalenze latenti (ne hai ${fmtEUR(totalLatentGains)}) potresti compensarne fino a ${fmtEUR(usable)} senza pagare imposte, prima che lo zainetto vada perso.`,
      });
    } else {
      hints.push({
        kind: "zainetto-scadenza",
        text: `Hai ${fmtEUR(expiringTotal)} di minusvalenze che scadono il 31/12/${currentYear}, ma nessuna plusvalenza latente da compensare: se prevedi vendite in utile, valutale entro fine anno.`,
      });
    }
  } else if (totalLossPot(tax) > 0 && totalLatentGains > 0) {
    hints.push({
      kind: "compensazione",
      text: `Il tuo zainetto fiscale vale ${fmtEUR(totalLossPot(tax))}: vendendo asset in utile entro le scadenze puoi compensare le plusvalenze e ridurre le imposte dovute.`,
    });
  }
  return hints;
}
