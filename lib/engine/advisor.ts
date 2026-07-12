// ── Motore consigli ─────────────────────────────────────────────────────────
// AdvisorProvider è l'interfaccia astratta; RulesAdvisor l'implementazione
// deterministica offline. Un futuro LlmAdvisor implementerà la stessa
// interfaccia a partire dallo stesso FinancialState (vedi DECISIONS.md).

import type { Advice, FinancialData, RiskProfile } from "../types";
import { fmtEUR0, fmtNum, fmtPct, monthsUntil } from "../format";
import { allocationByClass, assetValue, goalEffectiveSaved, maxAssetWeight } from "./aggregates";
import { goalMonthlyNeeded, goalProbability } from "./montecarlo";
import { computeDerived, type DerivedState } from "./state";
import { futureValueMonthly } from "./montecarlo";

export interface FinancialState {
  data: FinancialData;
  derived: DerivedState;
}

export interface AdvisorProvider {
  analyze(state: FinancialState): Advice[];
}

/** Soglie modulate dal profilo di rischio */
const CRYPTO_THRESHOLD: Record<RiskProfile, number> = {
  prudente: 5,
  bilanciato: 12,
  dinamico: 25,
};
const CONCENTRATION_THRESHOLD: Record<RiskProfile, number> = {
  prudente: 20,
  bilanciato: 25,
  dinamico: 30,
};

export class RulesAdvisor implements AdvisorProvider {
  analyze(state: FinancialState): Advice[] {
    const { data, derived } = state;
    const { settings, assets, goals } = data;
    const d = derived;
    const advice: Advice[] = [];
    const profile = settings.riskProfile;

    // 1. Concentrazione (con stress test)
    const maxW = maxAssetWeight(assets, d.agg.gross);
    const concThreshold = CONCENTRATION_THRESHOLD[profile];
    if (maxW && maxW.weight > concThreshold) {
      const loss = assetValue(maxW.asset) * 0.2;
      const lossPct = d.agg.gross > 0 ? (loss / d.agg.gross) * 100 : 0;
      advice.push({
        id: "concentrazione",
        severity: "alert",
        priority: 1,
        title: "Portafoglio concentrato",
        body: `**${maxW.asset.name}** pesa il **${fmtPct(maxW.weight)}** del tuo patrimonio lordo (soglia per il profilo ${profile}: ${fmtPct(concThreshold, 0)}). Stress test: se perdesse il 20%, il lordo scenderebbe di **${fmtEUR0(loss)}** (**−${fmtPct(lossPct)}**).`,
        action: "Valuta di diversificare i prossimi versamenti su altri asset.",
      });
    }

    // 2. Leva
    if (d.agg.gross > 0 && d.agg.debts / d.agg.gross > 1) {
      advice.push({
        id: "leva",
        severity: "alert",
        priority: 2,
        title: "Leva elevata",
        body: `I tuoi debiti sono il **${fmtPct((d.agg.debts / d.agg.gross) * 100)}** del patrimonio lordo: stai operando a leva. Un calo del valore degli attivi si amplifica sul tuo patrimonio netto.`,
        action: "Dai priorità alla riduzione del debito più costoso (TAN più alto).",
      });
    }

    // 3. Quota crypto
    const alloc = allocationByClass(assets);
    const cryptoValue = alloc.get("Crypto") || 0;
    const cryptoPct = d.agg.gross > 0 ? (cryptoValue / d.agg.gross) * 100 : 0;
    const cryptoThreshold = CRYPTO_THRESHOLD[profile];
    if (cryptoPct > cryptoThreshold) {
      advice.push({
        id: "crypto",
        severity: "warn",
        priority: 3,
        title: "Quota crypto sopra soglia",
        body: `Le crypto sono il **${fmtPct(cryptoPct)}** del lordo, sopra la soglia del **${fmtPct(cryptoThreshold, 0)}** per il profilo ${profile}. La volatilità stimata del tuo portafoglio è **${fmtPct(d.portfolio.sigma * 100)}** annua: in un anno negativo tipico potresti vedere oscillazioni di quest'ordine.`,
        action: "Riduci gradualmente l'esposizione o rivedi il profilo di rischio.",
      });
    }

    // 4. Tasso di risparmio
    const rate = d.avgSavingsRate3m * 100;
    const savedMonthly = d.incomeMonth - d.expenseMonth;
    if (rate >= 20) {
      advice.push({
        id: "risparmio-ok",
        severity: "ok",
        priority: 8,
        title: "Ottimo tasso di risparmio",
        body: `Negli ultimi 3 mesi hai risparmiato in media il **${fmtPct(rate)}** delle entrate${savedMonthly > 0 ? ` (questo mese: **${fmtEUR0(savedMonthly)}**)` : ""}. Metterlo al lavoro con versamenti regolari può fare una grande differenza nel lungo periodo.`,
        action: "Valuta di investire la quota risparmiata con un piano di accumulo.",
      });
    } else if (rate < 10) {
      advice.push({
        id: "risparmio-basso",
        severity: "warn",
        priority: 4,
        title: "Tasso di risparmio basso",
        body: `Negli ultimi 3 mesi hai risparmiato in media solo il **${fmtPct(rate)}** delle entrate (obiettivo consigliato: 20%). Piccoli tagli alle categorie più pesanti possono liberare margine.`,
        action: "Controlla i budget per categoria nella pagina Uscite & budget.",
      });
    }

    // 5. Fondo emergenza
    if (d.coverageMonths != null) {
      const cov = d.coverageMonths;
      if (cov < 3) {
        advice.push({
          id: "emergenza-basso",
          severity: "alert",
          priority: 1,
          title: "Fondo emergenza insufficiente",
          body: `La tua liquidità copre **${fmtNum(cov, 1)} mesi** di spese: sotto i 3 mesi un imprevisto può costringerti a vendere investimenti nel momento sbagliato. Target consigliato: **6 mesi** (${fmtEUR0(d.avgExpense6m * 6)}).`,
          action: "Accantona liquidità prima di nuovi investimenti.",
        });
      } else if (cov > 12) {
        advice.push({
          id: "emergenza-troppo",
          severity: "warn",
          priority: 6,
          title: "Troppa liquidità ferma",
          body: `La tua liquidità copre **${fmtNum(cov, 1)} mesi** di spese, ben oltre i 12 consigliati. Con un'inflazione attesa del ${fmtPct(data.settings.expectedInflation)} l'eccesso perde potere d'acquisto ogni anno.`,
          action: "Valuta di investire la parte eccedente i 6–12 mesi di copertura.",
        });
      } else {
        advice.push({
          id: "emergenza-ok",
          severity: "ok",
          priority: 9,
          title: "Fondo emergenza solido",
          body: `La tua liquidità copre **${fmtNum(cov, 1)} mesi** di spese: sei nella fascia consigliata (3–12 mesi). Ottima base per investire con serenità.`,
        });
      }
    }

    // 6. Abbonamenti
    if (d.expenseMonth > 0 && d.subscriptionsMonthly > 0) {
      const subPct = (d.subscriptionsMonthly / d.expenseMonth) * 100;
      if (subPct > 5) {
        const opportunity = futureValueMonthly(d.subscriptionsMonthly, 0.06, 10);
        advice.push({
          id: "abbonamenti",
          severity: "warn",
          priority: 5,
          title: "Abbonamenti pesanti",
          body: `Gli abbonamenti costano **${fmtEUR0(d.subscriptionsMonthly)}/mese**, il **${fmtPct(subPct)}** delle tue uscite mensili. Costo opportunità: investiti al 6% per 10 anni varrebbero **${fmtEUR0(opportunity)}**.`,
          action: "Passa in rassegna gli abbonamenti e disdici quelli che non usi.",
        });
      }
    }

    // 7. Obiettivi a rischio (versato effettivo: segue il conto se collegato)
    for (const g of goals) {
      const saved = goalEffectiveSaved(g, data.accounts);
      const monthsLeft = monthsUntil(g.deadline);
      const prob = goalProbability(
        saved,
        g.target,
        g.plannedMonthly,
        monthsLeft,
        d.portfolio.mu,
        d.portfolio.sigma
      );
      if (prob < 50 && saved < g.target) {
        const needed = goalMonthlyNeeded(saved, g.target, monthsLeft);
        const extra = Math.max(0, needed - g.plannedMonthly);
        advice.push({
          id: `obiettivo-${g.id}`,
          severity: "warn",
          priority: 4,
          title: `Obiettivo a rischio: ${g.name}`,
          body: `Al ritmo attuale (**${fmtEUR0(g.plannedMonthly)}/mese**) la probabilità di raggiungere **${fmtEUR0(g.target)}** entro la scadenza è **${fmtPct(prob, 0)}**.`,
          action:
            extra > 0
              ? `Aumenta il versamento di ${fmtEUR0(extra)}/mese oppure sposta la scadenza più avanti.`
              : `Rivedi la scadenza o l'importo target.`,
        });
      }
    }

    // 8. Ribilanciamento vs allocazione target
    const target = settings.targetAllocation;
    if (target && d.agg.investments > 0) {
      const deviations: { cls: string; targetPct: number; actualPct: number; diff: number }[] = [];
      const classes = new Set([...Object.keys(target), ...alloc.keys()]);
      for (const cls of classes) {
        const t = (target as Record<string, number>)[cls] || 0;
        const actual = ((alloc.get(cls as never) || 0) / d.agg.investments) * 100;
        const diff = actual - t;
        if (Math.abs(diff) > 5 && t > 0) {
          deviations.push({ cls, targetPct: t, actualPct: actual, diff });
        }
      }
      if (deviations.length > 0) {
        const worst = deviations.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))[0];
        const under = deviations.filter((x) => x.diff < 0);
        const moveAmount = (Math.abs(worst.diff) / 100) * d.agg.investments;
        advice.push({
          id: "ribilanciamento",
          severity: "warn",
          priority: 5,
          title: "Portafoglio da ribilanciare",
          body: `**${worst.cls}** è al **${fmtPct(worst.actualPct)}** contro un target del **${fmtPct(worst.targetPct, 0)}** (${worst.diff > 0 ? "sovrappeso" : "sottopeso"} di **${fmtPct(Math.abs(worst.diff))}**, circa **${fmtEUR0(moveAmount)}**).`,
          action:
            under.length > 0
              ? `Destina i prossimi versamenti a ${under.map((x) => x.cls).join(", ")} per riallineare senza vendere.`
              : `Valuta di spostare circa ${fmtEUR0(moveAmount)} da ${worst.cls} verso le classi sottopeso.`,
        });
      }
    }

    // 9. Zainetto fiscale in scadenza + plusvalenze latenti da compensare
    const year = new Date().getFullYear();
    const expiringAmount = [
      ...d.taxComputed.autoPots,
      ...data.taxState.lossPots,
    ]
      .filter((p) => p.amount > 0 && p.year + 4 <= year)
      .reduce((s, p) => s + p.amount, 0);
    const latentGains = assets.reduce((s, a) => s + Math.max(0, assetValue(a) - a.quantity * a.avgCost), 0);
    if (expiringAmount > 0 && latentGains > 0) {
      const month = new Date().getMonth(); // 0=gen
      const seasonal = month >= 9; // ottobre–dicembre: urgenza
      const usable = Math.min(expiringAmount, latentGains);
      advice.push({
        id: "zainetto-scadenza",
        severity: seasonal ? "alert" : "warn",
        priority: seasonal ? 2 : 6,
        title: "Zainetto fiscale in scadenza",
        body: `Hai **${fmtEUR0(expiringAmount)}** di minusvalenze che scadono il **31/12/${year}** e **${fmtEUR0(latentGains)}** di plusvalenze latenti: realizzandone fino a **${fmtEUR0(usable)}** compenseresti le imposte prima che lo zainetto vada perso.`,
        action:
          "Valuta di vendere (ed eventualmente ricomprare) asset in utile entro fine anno per usare lo zainetto.",
      });
    }

    const order = { alert: 0, warn: 1, ok: 2 };
    return advice.sort(
      (a, b) => order[a.severity] - order[b.severity] || a.priority - b.priority
    );
  }
}

export const advisor: AdvisorProvider = new RulesAdvisor();

export function buildFinancialState(data: FinancialData): FinancialState {
  return { data, derived: computeDerived(data) };
}
