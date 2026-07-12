// ── Indice di salute finanziaria (0–100) ────────────────────────────────────
// Media a pesi uguali di 5 sotto-punteggi. Formule documentate nei tooltip UI.

export interface HealthInput {
  coverageMonths: number | null; // liquidità / spesa media mensile
  avgSavingsRate3m: number; // 0–1
  assetClassCount: number; // classi di attivo presenti
  debtToGross: number | null; // debiti / lordo (rapporto, es. 0.3)
  maxAssetWeightPct: number | null; // peso % del singolo asset più pesante
}

export interface HealthSubscore {
  key: string;
  label: string;
  score: number; // 0–100
  detail: string; // sottotitolo con i numeri reali
  formula: string; // spiegazione per il tooltip
}

export interface HealthResult {
  total: number;
  subscores: HealthSubscore[];
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

export function computeHealth(input: HealthInput, fmt: {
  months: (n: number) => string;
  pct: (n: number) => string;
}): HealthResult {
  const cov = input.coverageMonths ?? 0;
  const fondoEmergenza = clamp((cov / 6) * 100);

  const rate = input.avgSavingsRate3m;
  const risparmio = clamp((rate / 0.2) * 100);

  const diversificazione = clamp(input.assetClassCount * 20);

  let debito = 100;
  if (input.debtToGross != null) {
    const r = input.debtToGross;
    if (r <= 0.3) debito = 100;
    else if (r >= 2) debito = 0;
    else debito = clamp(100 * (1 - (r - 0.3) / 1.7));
  }

  let concentrazione = 100;
  if (input.maxAssetWeightPct != null) {
    const w = input.maxAssetWeightPct;
    if (w <= 15) concentrazione = 100;
    else if (w >= 50) concentrazione = 0;
    else concentrazione = clamp(100 * (1 - (w - 15) / 35));
  }

  const subscores: HealthSubscore[] = [
    {
      key: "emergenza",
      label: "Fondo emergenza",
      score: fondoEmergenza,
      detail:
        input.coverageMonths == null
          ? "Nessuna spesa registrata: copertura non calcolabile"
          : `Copri ${fmt.months(cov)} di spese (target: 6 mesi)`,
      formula: "min(100, mesi di copertura ÷ 6 × 100). Copertura = liquidità ÷ spesa media mensile.",
    },
    {
      key: "risparmio",
      label: "Tasso di risparmio",
      score: risparmio,
      detail: `Media ultimi 3 mesi: ${fmt.pct(rate * 100)} (target: 20%)`,
      formula: "min(100, tasso medio 3 mesi ÷ 20% × 100). Tasso = (entrate − uscite) ÷ entrate.",
    },
    {
      key: "diversificazione",
      label: "Diversificazione",
      score: diversificazione,
      detail: `${input.assetClassCount} class${input.assetClassCount === 1 ? "e" : "i"} di attivo presenti (20 punti l'una)`,
      formula: "20 punti per ogni classe di attivo presente in portafoglio, massimo 100.",
    },
    {
      key: "debito",
      label: "Debito contenuto",
      score: debito,
      detail:
        input.debtToGross == null
          ? "Nessun patrimonio lordo: rapporto non calcolabile"
          : `Debiti al ${fmt.pct(input.debtToGross * 100)} del lordo (ottimo ≤ 30%)`,
      formula: "100 se debiti/lordo ≤ 30%, 0 se ≥ 200%, lineare in mezzo.",
    },
    {
      key: "concentrazione",
      label: "Concentrazione",
      score: concentrazione,
      detail:
        input.maxAssetWeightPct == null
          ? "Nessun investimento: concentrazione non calcolabile"
          : `L'asset più pesante è il ${fmt.pct(input.maxAssetWeightPct)} del lordo (ottimo ≤ 15%)`,
      formula: "100 se il singolo asset più pesante è ≤ 15% del lordo, 0 se ≥ 50%, lineare in mezzo.",
    },
  ];

  const total = Math.round(subscores.reduce((s, x) => s + x.score, 0) / subscores.length);
  return { total, subscores };
}
