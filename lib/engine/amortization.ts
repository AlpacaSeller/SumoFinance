// ── Ammortamento debiti (piano francese, rata costante) ─────────────────────
// interessi del mese = residuo × TAN/12; quota capitale = rata − interessi.
// L'ultima rata è ridotta a residuo + interessi.

export interface RataSplit {
  interest: number;
  principal: number;
  /** importo effettivo della rata (può essere < rata piena sull'ultima) */
  payment: number;
  /** true se la rata non copre nemmeno gli interessi (ammortamento negativo) */
  underwater: boolean;
}

export function rataSplit(residual: number, tanPct: number, monthlyPayment: number): RataSplit {
  const interest = Math.max(0, residual) * (tanPct / 100) / 12;
  if (monthlyPayment <= interest) {
    return { interest, principal: 0, payment: monthlyPayment, underwater: true };
  }
  const principal = Math.min(monthlyPayment - interest, residual);
  return {
    interest,
    principal,
    payment: principal + interest,
    underwater: false,
  };
}

/** Numero di rate mensili per estinguere il debito; null se la rata non basta. */
export function monthsToPayoff(residual: number, tanPct: number, monthlyPayment: number): number | null {
  if (residual <= 0) return 0;
  if (monthlyPayment <= 0) return null;
  const i = tanPct / 100 / 12;
  if (i === 0) return Math.ceil(residual / monthlyPayment);
  if (monthlyPayment <= residual * i) return null; // la rata non copre gli interessi
  return Math.ceil(Math.log(monthlyPayment / (monthlyPayment - residual * i)) / Math.log(1 + i));
}

/** "YYYY-MM" stimato di estinzione a partire da oggi. */
export function payoffMonth(
  residual: number,
  tanPct: number,
  monthlyPayment: number,
  from: Date = new Date()
): string | null {
  const n = monthsToPayoff(residual, tanPct, monthlyPayment);
  if (n == null) return null;
  const d = new Date(from.getFullYear(), from.getMonth() + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
