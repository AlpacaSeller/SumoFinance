// ── Regole di categorizzazione e deduplica ──────────────────────────────────
// Modulo LEGGERO separato da lib/csv.ts di proposito: queste due funzioni
// servono in tutte le pagine movimenti, mentre csv.ts porta con sé papaparse
// (~45 KB) che deve entrare solo nel chunk dell'import wizard.

import type { ImportRule } from "./types";

/** Applica le regole di categorizzazione: prima regola attiva che matcha. */
export function applyRules(
  description: string,
  isIncome: boolean,
  rules: ImportRule[]
): string | null {
  const desc = description.toLowerCase();
  for (const rule of rules) {
    if (!rule.active || !rule.pattern.trim()) continue;
    if (rule.type === "entrata" && !isIncome) continue;
    if (rule.type === "uscita" && isIncome) continue;
    if (desc.includes(rule.pattern.trim().toLowerCase())) return rule.category;
  }
  return null;
}

/** Impronta per la deduplica: data + importo + descrizione normalizzata */
export function fingerprint(date: string, amount: number, description: string): string {
  const desc = description.toLowerCase().replace(/\s+/g, " ").trim();
  return `${date}|${amount.toFixed(2)}|${desc}`;
}
