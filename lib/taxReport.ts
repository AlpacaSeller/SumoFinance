// ── Report fiscale per il commercialista ────────────────────────────────────
// CSV delle vendite realizzate (separatore ";", numeri it-IT, BOM per Excel)
// e report HTML stampabile (→ PDF con la stampa del browser).
// Stime semplificate: non sostituiscono la dichiarazione.

import type { Asset, LossPot, TaxState } from "./types";
import type { RealizedEvent, TaxComputation } from "./engine/transactions";
import { potExpiryYear } from "./engine/tax";
import { fmtDate, fmtEUR, fmtNum, fmtPct } from "./format";

function csvNum(n: number): string {
  return n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function esc(s: string): string {
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV di tutte le vendite realizzate registrate in app (tutti gli anni). */
export function buildTaxCsv(events: RealizedEvent[], assets: Asset[]): string {
  const nameOf = new Map(assets.map((a) => [a.id, a.name]));
  const rows = [
    ["Data", "Asset", "Quantità venduta", "Risultato (€)", "Tipo", "Aliquota (%)", "Anno"].join(";"),
  ];
  for (const e of events) {
    rows.push(
      [
        fmtDate(e.date),
        esc(nameOf.get(e.assetId) ?? e.assetId),
        csvNum(e.quantity),
        csvNum(e.gain),
        e.gain >= 0 ? "plusvalenza" : "minusvalenza",
        csvNum(e.taxRate * 100),
        String(e.year),
      ].join(";")
    );
  }
  return "﻿" + rows.join("\r\n");
}

/** Stima annua dell'imposta di bollo (0,20% sul valore dei prodotti finanziari). */
export function bolloEstimate(assets: Asset[]): number {
  return (
    assets
      .filter((a) => a.assetClass !== "Immobili")
      .reduce((s, a) => s + a.quantity * a.currentPrice, 0) * 0.002
  );
}

export interface TaxReportInput {
  year: number;
  events: RealizedEvent[]; // tutti gli anni, per il dettaglio
  assets: Asset[];
  computed: TaxComputation;
  taxState: TaxState;
  latentTax: number;
  realizedYear: { gains: number; losses: number };
}

/** HTML autonomo e stampabile del riepilogo fiscale. */
export function buildTaxReportHtml(input: TaxReportInput): string {
  const { year, events, assets, computed, taxState, latentTax, realizedYear } = input;
  const nameOf = new Map(assets.map((a) => [a.id, a.name]));
  const yearEvents = events.filter((e) => e.year === year);
  const bollo = bolloEstimate(assets);
  const pots: { pot: LossPot; source: string }[] = [
    ...computed.autoPots.map((pot) => ({ pot, source: "da operazioni in app" })),
    ...taxState.lossPots.map((pot) => ({ pot, source: "rettifica manuale" })),
  ].sort((a, b) => a.pot.year - b.pot.year);

  const rows = yearEvents
    .map(
      (e) => `<tr>
        <td>${fmtDate(e.date)}</td>
        <td>${escapeHtml(nameOf.get(e.assetId) ?? e.assetId)}</td>
        <td class="num">${fmtNum(e.quantity, 6)}</td>
        <td class="num ${e.gain >= 0 ? "pos" : "neg"}">${fmtEUR(e.gain)}</td>
        <td class="num">${fmtPct(e.taxRate * 100)}</td>
      </tr>`
    )
    .join("");

  const potRows = pots
    .map(
      ({ pot, source }) => `<tr>
        <td>${pot.year}</td>
        <td>31/12/${potExpiryYear(pot)}</td>
        <td>${source}</td>
        <td class="num">${fmtEUR(pot.amount)}</td>
      </tr>`
    )
    .join("");

  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<title>Sumo Finance — Report fiscale ${year}</title>
<style>
  body { font-family: Georgia, "Times New Roman", serif; color: #16282a; margin: 40px auto; max-width: 760px; padding: 0 16px; }
  h1 { font-size: 22px; margin-bottom: 2px; }
  h2 { font-size: 15px; margin: 26px 0 8px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  .sub { color: #666; font-size: 12px; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #e5e5e5; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #666; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .pos { color: #177347; } .neg { color: #b03a3a; }
  .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 14px 0; }
  .kpi { border: 1px solid #ddd; border-radius: 8px; padding: 10px 12px; }
  .kpi .l { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; color: #666; }
  .kpi .v { font-size: 17px; font-weight: 600; margin-top: 3px; font-variant-numeric: tabular-nums; }
  .note { font-size: 11px; color: #666; margin-top: 26px; border-top: 1px solid #ccc; padding-top: 10px; }
  @media print { body { margin: 0 auto; } }
</style>
</head>
<body>
  <h1>Sumo Finance — Report fiscale ${year}</h1>
  <div class="sub">Generato il ${fmtDate(new Date().toISOString().slice(0, 10))} · stime semplificate a supporto del commercialista, non sostituiscono la dichiarazione</div>

  <div class="kpis">
    <div class="kpi"><div class="l">Plusvalenze realizzate ${year}</div><div class="v">${fmtEUR(realizedYear.gains)}</div></div>
    <div class="kpi"><div class="l">Minusvalenze realizzate ${year}</div><div class="v">${fmtEUR(realizedYear.losses)}</div></div>
    <div class="kpi"><div class="l">Compensato con zainetto</div><div class="v">${fmtEUR(computed.compensatedThisYear)}</div></div>
    <div class="kpi"><div class="l">Imposta stimata dovuta ${year}</div><div class="v">${fmtEUR(computed.estimatedTaxDue)}</div></div>
    <div class="kpi"><div class="l">Tasse latenti (se vendessi tutto)</div><div class="v">${fmtEUR(latentTax)}</div></div>
    <div class="kpi"><div class="l">Bollo stimato (0,20% annuo)</div><div class="v">${fmtEUR(bollo)}</div></div>
  </div>

  <h2>Vendite realizzate nel ${year} (registrate in app)</h2>
  ${
    yearEvents.length > 0
      ? `<table><thead><tr><th>Data</th><th>Asset</th><th class="num">Quantità</th><th class="num">Risultato</th><th class="num">Aliquota</th></tr></thead><tbody>${rows}</tbody></table>`
      : `<p style="font-size:13px;color:#666">Nessuna vendita registrata nell'anno.</p>`
  }
  ${
    realizedYear.gains !== computed.currentYear.gains || realizedYear.losses !== computed.currentYear.losses
      ? `<p style="font-size:12px;color:#666">Include rettifiche manuali extra-app: plusvalenze ${fmtEUR(taxState.realizedGainsYear)}, minusvalenze ${fmtEUR(taxState.realizedLossesYear)}.</p>`
      : ""
  }

  <h2>Zainetto fiscale residuo</h2>
  ${
    pots.length > 0
      ? `<table><thead><tr><th>Anno formazione</th><th>Scadenza</th><th>Origine</th><th class="num">Residuo</th></tr></thead><tbody>${potRows}</tbody></table>`
      : `<p style="font-size:13px;color:#666">Nessuna minusvalenza compensabile residua.</p>`
  }

  <div class="note">
    Metodo: costo medio ponderato (PMC), commissioni incluse; compensazione cronologica al valore
    nominale, scadenza al 31/12 del 4° anno successivo alla formazione. Aliquote: 26% standard,
    12,5% titoli whitelist, 33% cripto-attività per realizzi dal 2026 (26% fino al 2025).
    Non considerati: IVAFE, regimi esteri, distinzione redditi
    diversi/da capitale, dividendi e cedole. Bollo stimato come 0,20% del valore attuale dei
    prodotti finanziari (immobili esclusi). Documento generato da Sumo Finance, app locale: i dati non
    hanno lasciato il dispositivo dell'utente.
  </div>
  <script>window.addEventListener("load", () => setTimeout(() => window.print(), 300));</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
