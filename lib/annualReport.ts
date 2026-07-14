// ── Report annuale stampabile ───────────────────────────────────────────────
// HTML autonomo (stesso stile sobrio del report fiscale) da aprire in una
// finestra e stampare/salvare in PDF: il consuntivo dell'anno in una pagina.

import type { FinancialData } from "./types";
import { computeTwr, investmentFlows } from "./engine/twr";

const eur = (n: number) =>
  `${n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const eur0 = (n: number) => `${Math.round(n).toLocaleString("it-IT")} €`;
const pct = (n: number) => `${n.toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`;
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function byCategory(rows: { category: string; amount: number }[]): [string, number][] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.category, (m.get(r.category) || 0) + r.amount);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export function buildAnnualReportHtml(data: FinancialData, year: number): string {
  const inYear = (date: string) => date.startsWith(String(year));
  const incomes = data.incomes.filter((i) => inYear(i.date));
  const expenses = data.expenses.filter((e) => inYear(e.date));
  const totIn = incomes.reduce((s, i) => s + i.amount, 0);
  const totOut = expenses.reduce((s, e) => s + e.amount, 0);
  const saved = totIn - totOut;
  const savingsRate = totIn > 0 ? (saved / totIn) * 100 : 0;
  const monthsWithData = new Set([...incomes, ...expenses].map((m) => m.date.slice(0, 7))).size;

  const snaps = data.snapshots
    .filter((s) => inYear(s.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  const first = snaps[0];
  const last = snaps[snaps.length - 1];

  const flows = investmentFlows(data.assets, data.assetTransactions);
  const investedYear = flows
    .filter((f) => inYear(f.date))
    .reduce((s, f) => s + f.amount, 0);
  const twr = computeTwr(snaps, flows, `${year}-01-01`);

  const inCat = byCategory(incomes);
  const outCat = byCategory(expenses);
  const topExpenses = [...expenses].sort((a, b) => b.amount - a.amount).slice(0, 10);
  const activeSubs = data.subscriptions.filter((s) => s.active);
  const subsAnnual = activeSubs.reduce(
    (s, x) => s + (x.cadence === "mensile" ? x.amount * 12 : x.amount),
    0
  );

  const catRows = (rows: [string, number][], tot: number) =>
    rows
      .map(
        ([cat, v]) =>
          `<tr><td>${esc(cat)}</td><td class="num">${eur(v)}</td><td class="num">${
            tot > 0 ? pct((v / tot) * 100) : "—"
          }</td><td class="num">${monthsWithData > 0 ? eur0(v / monthsWithData) : "—"}</td></tr>`
      )
      .join("");

  return `<!doctype html>
<html lang="it"><head><meta charset="utf-8">
<title>Sumo Finance — Report annuale ${year}</title>
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
</style></head><body>
  <h1>Sumo Finance — Report annuale ${year}</h1>
  <p class="sub">Generato il ${new Date().toLocaleDateString("it-IT")} · ${monthsWithData} mes${monthsWithData === 1 ? "e" : "i"} con movimenti</p>

  <div class="kpis">
    <div class="kpi"><div class="l">Entrate ${year}</div><div class="v pos">${eur(totIn)}</div></div>
    <div class="kpi"><div class="l">Uscite ${year}</div><div class="v neg">${eur(totOut)}</div></div>
    <div class="kpi"><div class="l">Risparmiato</div><div class="v ${saved >= 0 ? "pos" : "neg"}">${eur(saved)} (${pct(savingsRate)})</div></div>
    ${
      first && last && first.date !== last.date
        ? `<div class="kpi"><div class="l">Patrimonio netto</div><div class="v">${eur0(first.netWorth)} → ${eur0(last.netWorth)}</div></div>
    <div class="kpi"><div class="l">Variazione patrimonio</div><div class="v ${last.netWorth - first.netWorth >= 0 ? "pos" : "neg"}">${eur0(last.netWorth - first.netWorth)}</div></div>`
        : ""
    }
    ${
      twr.computable
        ? `<div class="kpi"><div class="l">TWR investimenti</div><div class="v ${(twr.cumulative ?? 0) >= 0 ? "pos" : "neg"}">${pct((twr.cumulative ?? 0) * 100)}</div></div>`
        : ""
    }
  </div>

  <h2>Entrate per categoria</h2>
  <table><thead><tr><th>Categoria</th><th class="num">Totale</th><th class="num">Quota</th><th class="num">Media/mese</th></tr></thead>
  <tbody>${catRows(inCat, totIn) || '<tr><td colspan="4">Nessuna entrata registrata.</td></tr>'}</tbody></table>

  <h2>Uscite per categoria</h2>
  <table><thead><tr><th>Categoria</th><th class="num">Totale</th><th class="num">Quota</th><th class="num">Media/mese</th></tr></thead>
  <tbody>${catRows(outCat, totOut) || '<tr><td colspan="4">Nessuna uscita registrata.</td></tr>'}</tbody></table>

  <h2>Le 10 spese più grandi</h2>
  <table><thead><tr><th>Data</th><th>Descrizione</th><th>Categoria</th><th class="num">Importo</th></tr></thead>
  <tbody>${
    topExpenses
      .map(
        (e) =>
          `<tr><td>${e.date.split("-").reverse().join("/")}</td><td>${esc(e.description)}</td><td>${esc(e.category)}</td><td class="num neg">${eur(e.amount)}</td></tr>`
      )
      .join("") || '<tr><td colspan="4">Nessuna spesa registrata.</td></tr>'
  }</tbody></table>

  <h2>Investimenti</h2>
  <table><tbody>
    <tr><td>Capitale netto investito nell'anno (acquisti − vendite)</td><td class="num">${eur(investedYear)}</td></tr>
    ${first && last ? `<tr><td>Valore investimenti (primo → ultimo snapshot ${year})</td><td class="num">${eur0(first.investments)} → ${eur0(last.investments)}</td></tr>` : ""}
    ${twr.computable ? `<tr><td>Rendimento time-weighted del periodo coperto</td><td class="num">${pct((twr.cumulative ?? 0) * 100)}${twr.annualized != null ? ` (${pct(twr.annualized * 100)} annualizzato)` : ""}</td></tr>` : ""}
  </tbody></table>

  ${
    activeSubs.length > 0
      ? `<h2>Abbonamenti attivi</h2>
  <table><thead><tr><th>Nome</th><th class="num">Costo</th><th class="num">Annuo</th></tr></thead>
  <tbody>${activeSubs
    .map(
      (x) =>
        `<tr><td>${esc(x.name)}</td><td class="num">${eur(x.amount)} ${x.cadence === "mensile" ? "/mese" : "/anno"}</td><td class="num">${eur(x.cadence === "mensile" ? x.amount * 12 : x.amount)}</td></tr>`
    )
    .join("")}
  <tr><td><strong>Totale</strong></td><td></td><td class="num"><strong>${eur(subsAnnual)}</strong></td></tr></tbody></table>`
      : ""
  }

  <p class="note">Documento generato da Sumo Finance, app locale: i dati non lasciano il tuo
  dispositivo. Il consuntivo si basa sui movimenti registrati nell'app; le percentuali di
  rendimento derivano dagli snapshot giornalieri. Non è un documento fiscale.</p>
  <script>window.print()</script>
</body></html>`;
}
