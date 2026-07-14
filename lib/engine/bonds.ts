// ── Obbligazioni/BTP ────────────────────────────────────────────────────────
// Convenzione dell'app: prezzi quotati per 100 di nominale e quantity = lotti
// da 100 (es. 10.000 € nominali = quantity 100). Da cui:
//   nominale € = quantity × 100
//   cedola annua LORDA € = quantity × couponRate
// Le date delle cedole si ancorano alla scadenza andando a ritroso (le cedole
// dei titoli di Stato cadono a intervalli fissi dalla data di rimborso).

import type { Asset } from "../types";

export interface CouponEvent {
  date: string; // YYYY-MM-DD
  amount: number; // € lordi
  /** true per la data di scadenza (rimborso del nominale, cedola inclusa) */
  isMaturity: boolean;
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function isBondWithSchedule(a: Asset): boolean {
  return (
    a.assetClass === "Obbligazioni" &&
    Boolean(a.maturityDate) &&
    (a.couponRate ?? 0) > 0 &&
    a.quantity > 0
  );
}

/** Cedole (e rimborso) che cadono in [from, to]. */
export function bondEvents(asset: Asset, fromISO: string, toISO: string): CouponEvent[] {
  if (!isBondWithSchedule(asset) || !asset.maturityDate) return [];
  const stepMonths = asset.couponFrequency === "annuale" ? 12 : 6;
  const annualCoupon = asset.quantity * (asset.couponRate ?? 0);
  const perCoupon = Math.round((annualCoupon / (12 / stepMonths)) * 100) / 100;

  const out: CouponEvent[] = [];
  const maturity = new Date(asset.maturityDate);
  // a ritroso dalla scadenza fino a coprire l'inizio finestra (max 100 cedole)
  for (let i = 0; i < 100; i++) {
    const d = new Date(maturity);
    d.setMonth(d.getMonth() - stepMonths * i);
    const dateStr = iso(d);
    if (dateStr < fromISO) break;
    if (dateStr <= toISO) {
      out.push({
        date: dateStr,
        amount: i === 0 ? perCoupon + asset.quantity * 100 : perCoupon,
        isMaturity: i === 0,
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Rendimento a scadenza LORDO approssimato (formula del rendimento medio):
 *  ytm ≈ (cedola + (100 − P) / anni) / ((100 + P) / 2), con P = prezzo. */
export function approxYtm(asset: Asset, todayISO: string): number | null {
  if (!isBondWithSchedule(asset) || !asset.maturityDate) return null;
  const price = asset.currentPrice;
  if (price <= 0) return null;
  const years =
    (new Date(asset.maturityDate).getTime() - new Date(todayISO).getTime()) /
    (365.25 * 86400000);
  if (years <= 0.02) return null; // in scadenza: il rendimento non è significativo
  const coupon = asset.couponRate ?? 0;
  return (coupon + (100 - price) / years) / ((100 + price) / 2);
}
