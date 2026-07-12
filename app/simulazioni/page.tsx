"use client";

// ── Simulazioni & FIRE (Monte Carlo) ────────────────────────────────────────

import { useDeferredValue, useMemo, useState } from "react";
import { useFinancial } from "@/lib/useFinancial";
import { simulate } from "@/lib/engine/montecarlo";
import { fmtEUR0, fmtNum, fmtPct, parseItAmount } from "@/lib/format";
import {
  Card,
  Field,
  Input,
  Kpi,
  LoadingState,
  PageHeader,
  ProgressBar,
} from "@/components/ui";
import { FanChart } from "@/components/lazyCharts";

export default function SimulazioniPage() {
  const { ready, data, derived } = useFinancial();
  const [monthlyRaw, setMonthlyRaw] = useState("500");
  const [years, setYears] = useState(20);
  // scenario B (what-if)
  const [monthlyBRaw, setMonthlyBRaw] = useState("");
  const [oneOffRaw, setOneOffRaw] = useState("");
  const [oneOffYear, setOneOffYear] = useState(5);
  const deferredMonthly = useDeferredValue(monthlyRaw);
  const deferredYears = useDeferredValue(years);
  const deferredMonthlyB = useDeferredValue(monthlyBRaw);
  const deferredOneOff = useDeferredValue(oneOffRaw);
  const deferredOneOffYear = useDeferredValue(oneOffYear);

  const monthly = parseItAmount(deferredMonthly) ?? 0;
  const start = derived.agg.liquidWealth;
  const { mu, sigma } = derived.portfolio;
  const fireTarget = derived.fireTarget;

  const result = useMemo(() => {
    if (!ready) return null;
    return simulate({
      start,
      monthly,
      years: deferredYears,
      mu,
      sigma,
      runs: 400,
      target: fireTarget ?? undefined,
    });
  }, [ready, start, monthly, deferredYears, mu, sigma, fireTarget]);

  const monthlyB = parseItAmount(deferredMonthlyB);
  const oneOff = parseItAmount(deferredOneOff) ?? 0;
  const scenarioBActive = (monthlyB != null && monthlyB !== monthly) || oneOff > 0;

  const resultB = useMemo(() => {
    if (!ready || !scenarioBActive) return null;
    return simulate({
      start,
      monthly: monthlyB ?? monthly,
      years: deferredYears,
      mu,
      sigma,
      runs: 400,
      target: fireTarget ?? undefined,
      oneOffs:
        oneOff > 0
          ? [
              {
                month: Math.min(deferredYears, Math.max(1, deferredOneOffYear)) * 12,
                amount: oneOff,
              },
            ]
          : undefined,
    });
  }, [
    ready,
    scenarioBActive,
    start,
    monthlyB,
    monthly,
    deferredYears,
    mu,
    sigma,
    fireTarget,
    oneOff,
    deferredOneOffYear,
  ]);

  const chartData = useMemo(
    () =>
      (result?.points ?? []).map((p, i) => ({
        ...p,
        band: [p.p10, p.p90] as [number, number],
        p50b: resultB?.points[i]?.p50,
      })),
    [result, resultB]
  );

  if (!ready || !result) return <LoadingState />;

  const fireProgress =
    fireTarget != null && fireTarget > 0 ? Math.min(100, (start / fireTarget) * 100) : null;

  return (
    <div>
      <PageHeader
        title="Simulazioni & FIRE"
        subtitle="400 simulazioni Monte Carlo a passo mensile sul tuo patrimonio liquido"
      />

      <div className="mb-6 grid gap-4 rounded-2xl border border-line bg-surface p-5 sm:grid-cols-2">
        <Field label="Versamento mensile (€)">
          <Input
            inputMode="decimal"
            value={monthlyRaw}
            onChange={(e) => setMonthlyRaw(e.target.value)}
            placeholder="500"
          />
        </Field>
        <Field label={`Orizzonte: ${years} ann${years === 1 ? "o" : "i"}`}>
          <input
            type="range"
            min={1}
            max={40}
            value={years}
            onChange={(e) => setYears(Number(e.target.value))}
            className="mt-3 w-full accent-brand"
            aria-label="Orizzonte in anni"
          />
        </Field>
        <p className="text-xs text-faint sm:col-span-2">
          Parametri usati: partenza <span className="tnum">{fmtEUR0(start)}</span> (liquidità +
          investimenti, immobili esclusi) · rendimento atteso{" "}
          <span className="tnum">{fmtPct(mu * 100)}</span> · volatilità{" "}
          <span className="tnum">{fmtPct(sigma * 100)}</span> — media pesata della tua
          allocazione reale.
        </p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label={`Pessimistico (10°) a ${years} anni`}
          value={fmtEUR0(result.finals.p10)}
          tone="neg"
        />
        <Kpi label="Mediano (50°)" value={fmtEUR0(result.finals.p50)} />
        <Kpi label="Ottimistico (90°)" value={fmtEUR0(result.finals.p90)} tone="pos" />
        <Kpi
          label="Probabilità FIRE"
          value={result.targetProbability != null ? fmtPct(result.targetProbability, 0) : "—"}
          sub={
            result.targetMedianYear != null
              ? `anno stimato: ~${result.targetMedianYear}`
              : result.targetProbability != null
                ? "anno stimato: > orizzonte"
                : "servono spese registrate"
          }
        />
      </div>

      <Card
        title="Proiezione del patrimonio"
        subtitle="Fascia tra il 10° e il 90° percentile delle 400 simulazioni"
        className="mb-6"
      >
        <FanChart data={chartData} target={fireTarget} />
      </Card>

      {/* ── What-if: scenario B ── */}
      <Card
        title="E se…? — scenario alternativo"
        subtitle="Confronta un versamento diverso e/o una spesa importante (es. acquisto casa): la mediana tratteggiata appare sul grafico"
        className="mb-6"
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Versamento mensile alternativo (€)">
            <Input
              inputMode="decimal"
              value={monthlyBRaw}
              onChange={(e) => setMonthlyBRaw(e.target.value)}
              placeholder={`come ora (${fmtEUR0(monthly)})`}
            />
          </Field>
          <Field label="Spesa una tantum (€)">
            <Input
              inputMode="decimal"
              value={oneOffRaw}
              onChange={(e) => setOneOffRaw(e.target.value)}
              placeholder="es. 50.000"
            />
          </Field>
          <Field label={`Tra quanti anni: ${Math.min(oneOffYear, years)}`}>
            <input
              type="range"
              min={1}
              max={years}
              value={Math.min(oneOffYear, years)}
              onChange={(e) => setOneOffYear(Number(e.target.value))}
              className="mt-3 w-full accent-brand"
              aria-label="Anno della spesa una tantum"
            />
          </Field>
        </div>
        {scenarioBActive && resultB ? (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Kpi label={`Mediana scenario B a ${years} anni`} value={fmtEUR0(resultB.finals.p50)} />
            <Kpi
              label="Differenza vs scenario attuale"
              value={
                <span className={resultB.finals.p50 >= result.finals.p50 ? "text-pos" : "text-neg"}>
                  {fmtEUR0(resultB.finals.p50 - result.finals.p50)}
                </span>
              }
              sub="sulla mediana"
            />
            <Kpi
              label="Probabilità FIRE scenario B"
              value={
                resultB.targetProbability != null ? fmtPct(resultB.targetProbability, 0) : "—"
              }
              sub={
                result.targetProbability != null && resultB.targetProbability != null
                  ? `scenario attuale: ${fmtPct(result.targetProbability, 0)}`
                  : undefined
              }
            />
          </div>
        ) : (
          <p className="mt-4 text-xs text-faint">
            Inserisci un versamento diverso o una spesa una tantum per vedere il confronto.
          </p>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Obiettivo FIRE">
          {fireTarget != null ? (
            <div className="flex flex-col gap-3 text-sm">
              <p className="text-soft">
                Spese annue stimate:{" "}
                <strong className="tnum text-ink">{fmtEUR0(derived.avgExpense6m * 12)}</strong>{" "}
                (media mensile × 12). Con un tasso di prelievo del{" "}
                <strong className="tnum text-ink">
                  {fmtNum(data.settings.fireWithdrawalRate, 1)}%
                </strong>{" "}
                servono:
              </p>
              <div className="tnum font-display text-3xl font-semibold text-brand-ink">
                {fmtEUR0(fireTarget)}
              </div>
              {fireProgress != null && (
                <div>
                  <div className="mb-1 flex justify-between text-xs text-soft">
                    <span>Progresso verso FIRE</span>
                    <span className="tnum">{fmtPct(fireProgress)}</span>
                  </div>
                  <ProgressBar value={fireProgress} tone="brand" />
                  <p className="mt-2 text-xs text-faint">
                    Hai {fmtEUR0(start)} di patrimonio liquido su {fmtEUR0(fireTarget)} necessari.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-faint">
              Registra qualche mese di spese: il capitale FIRE si calcola dalla tua spesa media
              mensile.
            </p>
          )}
        </Card>

        <Card title="Regole del modello" subtitle="Cosa può e cosa non può dirti questa simulazione">
          <ul className="flex list-disc flex-col gap-2 pl-4 text-sm text-soft">
            <li>
              Rendimenti e volatilità per classe sono <strong>medie storiche statiche</strong>{" "}
              (es. ETF/Azioni 6%/15%, Obbligazioni 2,5%/5%, Crypto 20%/70%, Oro 3%/15%, Liquidità
              1%/0,5%): il futuro può essere diverso.
            </li>
            <li>
              Le <strong>correlazioni tra classi sono ignorate</strong>: μ e σ del portafoglio
              sono medie pesate semplici.
            </li>
            <li>
              I rendimenti mensili sono gaussiani: le code estreme dei mercati reali sono più
              grasse.
            </li>
            <li>
              L&apos;<strong>inflazione non è sottratta</strong> dal grafico: i valori sono
              nominali.
            </li>
            <li>
              Non è una previsione né una consulenza finanziaria: è uno strumento per ragionare
              sugli ordini di grandezza.
            </li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
