// ── Import CSV: parsing, regole di categorizzazione, dedupe ─────────────────

import Papa from "papaparse";
import type { ImportColumnMapping, ImportRule } from "./types";
import { parseItAmount, parseItDate } from "./format";

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  detectedSeparator: string;
}

/** Legge un File come testo provando UTF-8 e ripiegando su Latin-1 se compaiono
 *  caratteri di sostituzione (tipico degli estratti conto italiani). */
export async function readCsvFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  if (utf8.includes("�")) {
    return new TextDecoder("iso-8859-1").decode(buf);
  }
  return utf8;
}

export function parseCsv(text: string, separator?: string): ParsedCsv {
  const result = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: true,
    delimiter: separator || "", // "" = auto-detect (gestisce ; e ,)
    transformHeader: (h) => h.trim(),
  });
  const headers = result.meta.fields || [];
  return {
    headers,
    rows: result.data,
    detectedSeparator: result.meta.delimiter || ";",
  };
}

export interface MappedMovement {
  date: string; // ISO
  description: string;
  amount: number; // con segno: positivo = entrata, negativo = uscita
  category?: string;
  valid: boolean;
  error?: string;
}

export function mapRows(
  rows: Record<string, string>[],
  mapping: ImportColumnMapping,
  amountConvention: "signed" | "debitCredit"
): MappedMovement[] {
  return rows.map((row) => {
    const rawDate = row[mapping.dateCol] ?? "";
    const description = (row[mapping.descCol] ?? "").trim();
    const date = parseItDate(rawDate);
    let amount: number | null = null;

    if (amountConvention === "signed") {
      amount = parseItAmount(row[mapping.amountCol || ""] ?? "");
    } else {
      const debit = parseItAmount(row[mapping.debitCol || ""] ?? "");
      const credit = parseItAmount(row[mapping.creditCol || ""] ?? "");
      if (credit != null && credit !== 0) amount = Math.abs(credit);
      else if (debit != null && debit !== 0) amount = -Math.abs(debit);
      else if (credit != null || debit != null) amount = 0;
    }

    if (!date) {
      return { date: "", description, amount: 0, valid: false, error: "Data non valida" };
    }
    if (amount == null) {
      return { date, description, amount: 0, valid: false, error: "Importo non valido" };
    }
    if (amount === 0) {
      return { date, description, amount: 0, valid: false, error: "Importo nullo" };
    }
    const category = mapping.categoryCol ? (row[mapping.categoryCol] ?? "").trim() : undefined;
    return { date, description, amount, category: category || undefined, valid: true };
  });
}

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
