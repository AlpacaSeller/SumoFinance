// ── Formattazione it-IT centralizzata ───────────────────────────────────────

const eur = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const eur0 = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const num = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });

/** 1.234,56 € */
export function fmtEUR(n: number): string {
  return eur.format(safe(n));
}

/** 1.235 € (senza decimali, per numeri grandi) */
export function fmtEUR0(n: number): string {
  return eur0.format(safe(n));
}

/** +1.234,56 € / −1.234,56 € */
export function fmtEURSigned(n: number): string {
  const v = safe(n);
  return (v > 0 ? "+" : v < 0 ? "−" : "") + eur.format(Math.abs(v));
}

export function fmtNum(n: number, decimals = 2): string {
  return new Intl.NumberFormat("it-IT", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(safe(n));
}

export function fmtPct(n: number, decimals = 1): string {
  return (
    new Intl.NumberFormat("it-IT", {
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals,
    }).format(safe(n)) + "%"
  );
}

export function fmtPctSigned(n: number, decimals = 1): string {
  const v = safe(n);
  return (v > 0 ? "+" : v < 0 ? "−" : "") + fmtPct(Math.abs(v), decimals);
}

export { num as numberFormatter };

function safe(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

// ── Date ────────────────────────────────────────────────────────────────────

/** "YYYY-MM-DD" di oggi (fuso locale) */
export function todayISO(): string {
  return toISODate(new Date());
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** "YYYY-MM" del mese di una data ISO */
export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export function currentMonthKey(): string {
  return todayISO().slice(0, 7);
}

/** Chiave mese spostata di `delta` mesi rispetto a oggi (delta negativo = passato) */
export function shiftedMonthKey(delta: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + delta);
  return toISODate(d).slice(0, 7);
}

/** "luglio 2026" da "2026-07" */
export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("it-IT", {
    month: "long",
    year: "numeric",
  });
}

/** "lug 26" da "2026-07" (per assi dei grafici) */
export function monthLabelShort(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1)
    .toLocaleDateString("it-IT", { month: "short", year: "2-digit" })
    .replace(" ", " ");
}

/** "10 lug 2026" da "2026-07-10" */
export function fmtDate(isoDate: string): string {
  return parseISODate(isoDate).toLocaleDateString("it-IT", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function fmtDateLong(isoDate: string): string {
  return parseISODate(isoDate).toLocaleDateString("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("it-IT", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

/** Giorni rimanenti nel mese corrente, incluso oggi */
export function daysLeftInMonth(): number {
  const now = new Date();
  return daysInMonth(now.getFullYear(), now.getMonth()) - now.getDate() + 1;
}

export function addMonths(isoDate: string, n: number): string {
  const d = parseISODate(isoDate);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth())));
  return toISODate(d);
}

/** Mesi (interi, arrotondati per difetto) tra oggi e una data futura; min 0 */
export function monthsUntil(isoDate: string): number {
  const now = new Date();
  const d = parseISODate(isoDate);
  const months =
    (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth());
  return Math.max(0, months);
}

/** Parsing importo it-IT: "1.234,56" → 1234.56; accetta anche "1234.56" */
export function parseItAmount(raw: string): number | null {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/\s|€/g, "");
  if (!s) return null;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // il separatore più a destra è il decimale
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (hasComma) {
    s = s.replace(",", ".");
  } else if (hasDot && /^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    // solo punti in gruppi di 3: separatori delle migliaia all'italiana ("220.000")
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Parsing data italiana "gg/mm/aaaa" (o "gg-mm-aaaa") → "YYYY-MM-DD"; null se invalida */
export function parseItDate(raw: string): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) {
    const [, d, mo, yRaw] = m;
    const y = yRaw.length === 2 ? "20" + yRaw : yRaw;
    const day = Number(d), month = Number(mo);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}
