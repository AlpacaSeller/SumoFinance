// ── LlmAdvisor: l'analisi del sumo (AI, opzionale) ──────────────────────────
// BYOK (bring-your-own-key): ogni utente configura il SUO provider e la SUA
// chiave in Impostazioni; la chiamata parte dal browser dell'utente e la
// chiave non passa mai dai nostri server. Chi non configura nulla continua ad
// avere i consigli a regole: l'IA è un'aggiunta, non un requisito.
//
// Al provider viene inviato SOLO un riepilogo numerico aggregato (patrimonio,
// allocazioni, medie di flusso, obiettivi, fisco): mai descrizioni dei
// movimenti, nomi dei conti, ticker dei wallet o chiavi. Dichiarato nella
// pagina privacy.
//
// Cache: un'analisi al giorno per "impronta" dei dati (localStorage); il
// pulsante Aggiorna forza la rigenerazione.

import type { Advice, FinancialData, Settings } from "../types";
import type { DerivedState } from "./state";
import { allocationByClass, goalEffectiveSaved } from "./aggregates";
import { goalProbability } from "./montecarlo";

export type AiProvider = "gemini" | "anthropic";

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  gemini: "Google Gemini (free tier disponibile)",
  anthropic: "Anthropic Claude (pochi centesimi/analisi)",
};

// modelli provati in ordine: il primo che risponde vince (gli alias "latest"
// sopravvivono ai rinnovi di listino meglio degli id puntuali)
const GEMINI_MODELS = ["gemini-flash-latest", "gemini-2.5-flash", "gemini-2.0-flash"];
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";

/** Riepilogo numerico aggregato: l'UNICA cosa che il provider AI vede. */
export function buildFinancialSummary(data: FinancialData, derived: DerivedState): object {
  const d = derived;
  const byClass = allocationByClass(data.assets);
  const allocBase = Math.max(1, d.agg.investments + d.agg.liquidity);
  const allocazionePct: Record<string, number> = {};
  for (const [cls, value] of byClass) {
    if (value > 0) allocazionePct[cls] = Number(((value / allocBase) * 100).toFixed(1));
  }
  if (d.agg.liquidity > 0) {
    allocazionePct["Liquidità"] = Number(((d.agg.liquidity / allocBase) * 100).toFixed(1));
  }
  const topAsset = [...data.assets]
    .map((a) => ({ class: a.assetClass, value: a.quantity * a.currentPrice }))
    .sort((a, b) => b.value - a.value)[0];
  return {
    profiloRischio: data.settings.riskProfile,
    patrimonio: {
      netto: Math.round(d.agg.netWorth),
      liquidita: Math.round(d.agg.liquidity),
      investimenti: Math.round(d.agg.investments),
      debiti: Math.round(d.agg.debts),
      variazione30gPct: d.change30d ? Number(d.change30d.pct.toFixed(1)) : null,
    },
    allocazionePct,
    allocazioneTargetPct: data.settings.targetAllocation ?? null,
    assetPiuPesante: topAsset
      ? { classe: topAsset.class, quotaLordoPct: Number(((topAsset.value / Math.max(1, d.agg.gross)) * 100).toFixed(1)) }
      : null,
    flussiMensili: {
      entrateMeseCorrente: Math.round(d.incomeMonth),
      usciteMeseCorrente: Math.round(d.expenseMonth),
      spesaMedia6m: Math.round(d.avgExpense6m),
      tassoRisparmio3mPct: Number((d.avgSavingsRate3m * 100).toFixed(1)),
      abbonamentiMensili: Math.round(d.subscriptionsMonthly),
      renditePassive12m: Math.round(d.passive12M),
    },
    fondoEmergenza: {
      mesiCoperti: d.coverageMonths != null ? Number(d.coverageMonths.toFixed(1)) : null,
      target: 6,
    },
    indiceSalute0a100: d.health.total,
    obiettivi: data.goals.map((g) => {
      const saved = goalEffectiveSaved(g, data.accounts);
      const monthsLeft = Math.max(
        0,
        Math.round((new Date(g.deadline).getTime() - Date.now()) / (30.44 * 24 * 3600 * 1000))
      );
      return {
        nome: g.name,
        target: g.target,
        versato: Math.round(saved),
        scadenza: g.deadline,
        pianoMensile: g.plannedMonthly,
        probabilitaPct: Math.round(
          goalProbability(saved, g.target, g.plannedMonthly, monthsLeft, d.portfolio.mu, d.portfolio.sigma)
        ),
      };
    }),
    debiti: data.debts.map((x) => ({
      tipo: x.type,
      residuo: Math.round(x.residual),
      tanPct: x.tan,
      rataMensile: x.monthlyPayment,
    })),
    fisco: {
      realizzatoAnno: Math.round(d.realizedYear.gains - d.realizedYear.losses),
      tasseLatenti: Math.round(d.latentTax),
      zainettoResiduo: Math.round(
        (data.taxState.lossPots || []).reduce((s, p) => s + p.amount, 0)
      ),
    },
    fire: {
      obiettivo: d.fireTarget != null ? Math.round(d.fireTarget) : null,
      tassoPrelievoPct: data.settings.fireWithdrawalRate,
    },
  };
}

const PROMPT_INTRO = `Sei "il Sumo", il consulente di un'app italiana di finanza personale local-first. Ricevi un riepilogo numerico aggregato della situazione dell'utente. Scrivi da 2 a 4 analisi brevi, concrete e personalizzate in italiano.

Regole ferree:
- NON fare previsioni di mercato e NON suggerire singoli titoli o crypto specifiche.
- Basati SOLO sui numeri forniti; cita i numeri rilevanti nel testo racchiudendoli tra ** (es. **12.500 €**, **35%**).
- Tono: calmo, solido, diretto — come un maestro di sumo: poche parole ben piantate. Niente allarmismo, niente promesse.
- Ogni analisi deve avere un'azione concreta e realizzabile dentro l'app (rivedere un budget, aumentare un versamento, diversificare i prossimi acquisti, usare lo zainetto fiscale entro scadenza, ecc.).
- severity: "alert" solo per rischi concreti e urgenti, "warn" per cose da valutare, "ok" per rinforzi positivi.

Rispondi SOLO con un array JSON (nessun testo attorno, niente markdown) di oggetti:
[{"title": "...", "body": "...", "action": "...", "severity": "alert|warn|ok"}]`;

export interface LlmAdviceResult {
  advice: Advice[];
  generatedAt: string;
  provider: AiProvider;
}

/** Estrae l'array JSON anche se il modello lo avvolge in testo o fence. */
export function parseLlmAdvice(text: string): Advice[] {
  let raw = text.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Il modello non ha restituito un array JSON");
  }
  const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Risposta non valida");
  return parsed
    .filter(
      (x): x is { title: string; body: string; action?: string; severity?: string } =>
        typeof x === "object" && x !== null &&
        typeof (x as { title?: unknown }).title === "string" &&
        typeof (x as { body?: unknown }).body === "string"
    )
    .slice(0, 4)
    .map((x, i) => ({
      id: `ai-${i}`,
      severity: x.severity === "alert" ? "alert" : x.severity === "ok" ? "ok" : "warn",
      priority: 100 + i,
      title: x.title.slice(0, 120),
      body: x.body.slice(0, 900),
      action: typeof x.action === "string" ? x.action.slice(0, 300) : undefined,
    }));
}

async function callGemini(apiKey: string, promptText: string): Promise<string> {
  let lastErr = "";
  for (const model of GEMINI_MODELS) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: promptText }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 1500 },
        }),
        signal: AbortSignal.timeout(45000),
      }
    );
    if (res.status === 404) continue; // modello ritirato: prova il prossimo
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      throw new Error("Chiave Gemini non valida o senza permessi");
    }
    if (res.status === 429) throw new Error("Limite gratuito Gemini raggiunto: riprova più tardi");
    if (!res.ok) {
      lastErr = `Gemini ha risposto ${res.status}`;
      continue;
    }
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (text) return text;
    lastErr = "Risposta vuota da Gemini";
  }
  throw new Error(lastErr || "Nessun modello Gemini disponibile");
}

async function callAnthropic(apiKey: string, promptText: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      // consapevole: BYOK, la chiave è dell'utente e resta sul suo dispositivo
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1500,
      messages: [{ role: "user", content: promptText }],
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("Chiave Anthropic non valida");
  }
  if (res.status === 429) throw new Error("Rate limit Anthropic: riprova tra poco");
  if (!res.ok) throw new Error(`Anthropic ha risposto ${res.status}`);
  const json = (await res.json()) as { content?: { type: string; text?: string }[] };
  return (json.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
}

export async function generateLlmAdvice(
  settings: Settings,
  data: FinancialData,
  derived: DerivedState
): Promise<LlmAdviceResult> {
  const provider = settings.aiProvider;
  const apiKey = settings.aiApiKey?.trim();
  if (!provider || !apiKey) throw new Error("Configura provider e chiave in Impostazioni");
  const summary = buildFinancialSummary(data, derived);
  const promptText = `${PROMPT_INTRO}\n\nRiepilogo:\n${JSON.stringify(summary)}`;
  const text =
    provider === "gemini"
      ? await callGemini(apiKey, promptText)
      : await callAnthropic(apiKey, promptText);
  return { advice: parseLlmAdvice(text), generatedAt: new Date().toISOString(), provider };
}

const ASK_INTRO = `Sei "il Sumo", il consulente di un'app italiana di finanza personale local-first. Ricevi un riepilogo numerico aggregato della situazione dell'utente e UNA sua domanda.

Regole ferree:
- Rispondi SOLO sulla base dei numeri del riepilogo; se la domanda richiede dati che non hai, dillo chiaramente e suggerisci dove inserirli nell'app.
- NON fare previsioni di mercato e NON suggerire singoli titoli o crypto specifiche.
- Massimo 180 parole, tono calmo e concreto, in italiano. Racchiudi i numeri chiave tra ** (es. **1.200 €**).
- Se la domanda non riguarda le finanze personali dell'utente, riportala con gentilezza sul tema.
- Chiudi con un'azione concreta fattibile nell'app quando ha senso.

Rispondi in testo semplice (niente markdown a parte i **grassetti**).`;

/** Domanda libera al sumo sui propri numeri. Restituisce testo semplice. */
export async function askSumo(
  settings: Settings,
  data: FinancialData,
  derived: DerivedState,
  question: string
): Promise<string> {
  const provider = settings.aiProvider;
  const apiKey = settings.aiApiKey?.trim();
  if (!provider || !apiKey) throw new Error("Configura provider e chiave in Impostazioni");
  const q = question.trim().slice(0, 500);
  if (q.length < 3) throw new Error("Scrivi una domanda");
  const summary = buildFinancialSummary(data, derived);
  const promptText = `${ASK_INTRO}\n\nRiepilogo:\n${JSON.stringify(summary)}\n\nDomanda dell'utente: ${q}`;
  const text =
    provider === "gemini"
      ? await callGemini(apiKey, promptText)
      : await callAnthropic(apiKey, promptText);
  const cleaned = text.trim();
  if (!cleaned) throw new Error("Risposta vuota dal modello: riprova");
  return cleaned;
}

// ── Categorizzazione batch delle descrizioni (import CSV) ───────────────────

/** Propone una categoria per ogni descrizione (una sola chiamata batch).
 *  All'AI vanno SOLO le descrizioni, mai importi o date. */
export async function categorizeDescriptions(
  settings: Settings,
  descriptions: string[],
  categories: string[]
): Promise<Record<string, string>> {
  const provider = settings.aiProvider;
  const apiKey = settings.aiApiKey?.trim();
  if (!provider || !apiKey) throw new Error("Configura provider e chiave in Impostazioni");
  const unique = [...new Set(descriptions.map((d) => d.trim()).filter(Boolean))].slice(0, 120);
  if (unique.length === 0) return {};
  const prompt = `Sei il classificatore di un'app italiana di finanza personale. Per OGNI descrizione di movimento bancario nell'array, scegli la categoria più adatta tra: [${categories.map((c) => `"${c}"`).join(", ")}].
Rispondi SOLO con un oggetto JSON {"descrizione esatta": "categoria", ...} — usa le descrizioni ESATTAMENTE come fornite come chiavi. Se davvero non riesci a classificare, usa "Altro".
Descrizioni:
${JSON.stringify(unique)}`;
  const text =
    provider === "gemini" ? await callGemini(apiKey, prompt) : await callAnthropic(apiKey, prompt);
  const obj = parseJsonObject(text);
  const out: Record<string, string> = {};
  for (const d of unique) {
    const cat = obj[d];
    if (typeof cat === "string" && categories.includes(cat)) out[d] = cat;
  }
  return out;
}

// ── Scontrino → movimento (vision) ──────────────────────────────────────────

export interface ReceiptDraft {
  date?: string;
  description?: string;
  amount?: number;
  category?: string;
}

function receiptPrompt(categories: string[]): string {
  return `Leggi la foto di questo scontrino/ricevuta italiana ed estrai i dati della spesa.
Rispondi SOLO con un oggetto JSON (niente testo attorno, niente markdown):
{"data": "YYYY-MM-DD" | null, "esercente": "nome breve del negozio/servizio" | null, "importo": numero totale in euro (usa il TOTALE, punto come separatore decimale) | null, "categoria": una tra [${categories.map((c) => `"${c}"`).join(", ")}] | null}
Se un campo non è leggibile usa null. Non inventare.`;
}

/** Estrae un oggetto JSON anche se avvolto in testo o fence. */
export function parseJsonObject(text: string): Record<string, unknown> {
  let raw = text.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Il modello non ha restituito un oggetto JSON");
  }
  return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
}

/** Foto di uno scontrino → bozza di uscita da confermare. BYOK vision. */
export async function extractReceipt(
  settings: Settings,
  imageDataUrl: string,
  categories: string[]
): Promise<ReceiptDraft> {
  const provider = settings.aiProvider;
  const apiKey = settings.aiApiKey?.trim();
  if (!provider || !apiKey) throw new Error("Configura provider e chiave in Impostazioni");
  const match = imageDataUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
  if (!match) throw new Error("Immagine non valida");
  const [, mime, b64] = match;
  const prompt = receiptPrompt(categories);

  let text = "";
  if (provider === "gemini") {
    let lastErr = "";
    for (const model of GEMINI_MODELS) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: b64 } }],
              },
            ],
            generationConfig: { temperature: 0.1, maxOutputTokens: 400 },
          }),
          signal: AbortSignal.timeout(45000),
        }
      );
      if (res.status === 404) continue;
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        throw new Error("Chiave Gemini non valida o senza permessi");
      }
      if (res.status === 429) throw new Error("Limite gratuito Gemini raggiunto: riprova più tardi");
      if (!res.ok) {
        lastErr = `Gemini ha risposto ${res.status}`;
        continue;
      }
      const json = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      if (text) break;
      lastErr = "Risposta vuota da Gemini";
    }
    if (!text) throw new Error(lastErr || "Nessun modello Gemini disponibile");
  } else {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 400,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mime, data: b64 } },
              { type: "text", text: prompt },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (res.status === 401 || res.status === 403) throw new Error("Chiave Anthropic non valida");
    if (res.status === 429) throw new Error("Rate limit Anthropic: riprova tra poco");
    if (!res.ok) throw new Error(`Anthropic ha risposto ${res.status}`);
    const json = (await res.json()) as { content?: { type: string; text?: string }[] };
    text = (json.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  }

  const obj = parseJsonObject(text);
  const draft: ReceiptDraft = {};
  if (typeof obj.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(obj.data)) draft.date = obj.data;
  if (typeof obj.esercente === "string" && obj.esercente.trim()) {
    draft.description = obj.esercente.trim().slice(0, 80);
  }
  if (typeof obj.importo === "number" && Number.isFinite(obj.importo) && obj.importo > 0) {
    draft.amount = Math.round(obj.importo * 100) / 100;
  }
  if (typeof obj.categoria === "string" && categories.includes(obj.categoria)) {
    draft.category = obj.categoria;
  }
  if (!draft.amount && !draft.description) {
    throw new Error("Non sono riuscito a leggere lo scontrino: riprova con una foto più nitida");
  }
  return draft;
}

// ── cache: un'analisi al giorno per impronta dei dati ───────────────────────

const CACHE_KEY = "pfos-ai-advice";

interface CachedAdvice extends LlmAdviceResult {
  day: string; // YYYY-MM-DD
  fingerprint: string;
}

function fingerprint(summary: object): string {
  const s = JSON.stringify(summary);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return String(h);
}

export function readCachedAdvice(data: FinancialData, derived: DerivedState): LlmAdviceResult | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedAdvice;
    const today = new Date().toISOString().slice(0, 10);
    if (cached.day !== today) return null;
    if (cached.fingerprint !== fingerprint(buildFinancialSummary(data, derived))) return null;
    return cached;
  } catch {
    return null;
  }
}

export function writeCachedAdvice(
  result: LlmAdviceResult,
  data: FinancialData,
  derived: DerivedState
): void {
  try {
    const cached: CachedAdvice = {
      ...result,
      day: new Date().toISOString().slice(0, 10),
      fingerprint: fingerprint(buildFinancialSummary(data, derived)),
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cached));
  } catch {
    /* niente */
  }
}
