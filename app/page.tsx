"use client";

// ── Dashboard ───────────────────────────────────────────────────────────────

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, Compass } from "lucide-react";
import { useFinancial } from "@/lib/useFinancial";
import { advisor } from "@/lib/engine/advisor";
import { allocationByClass, sumInMonth } from "@/lib/engine/aggregates";
import { totalUnrealizedGain } from "@/lib/engine/tax";
import {
  fmtEUR,
  fmtEUR0,
  fmtEURSigned,
  fmtNum,
  fmtPct,
  fmtPctSigned,
  monthLabelShort,
  shiftedMonthKey,
  todayISO,
} from "@/lib/format";
import {
  Button,
  Card,
  EmptyState,
  InfoTip,
  Kpi,
  LoadingState,
  ProgressBar,
  Segmented,
} from "@/components/ui";
import {
  AllocationDonut,
  CashflowChart,
  HealthRadar,
  NetWorthChart,
} from "@/components/lazyCharts";
import { useChartTheme } from "@/components/chartTheme";
import { AdviceCard } from "@/components/AdviceCard";
import { MonthlyReportCard } from "@/components/MonthlyReportCard";

type Range = "7g" | "30g" | "6m" | "1a" | "5a" | "10a";
const RANGE_DAYS: Record<Range, number> = {
  "7g": 7,
  "30g": 30,
  "6m": 183,
  "1a": 365,
  "5a": 1826,
  "10a": 3652,
};

export default function DashboardPage() {
  const { ready, data, derived } = useFinancial();
  const [range, setRange] = useState<Range>("6m");
  const chartTheme = useChartTheme();

  const advice = useMemo(
    () => (ready ? advisor.analyze({ data, derived }) : []),
    [ready, data, derived]
  );

  const chart = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RANGE_DAYS[range]);
    const cutoffISO = cutoff.toISOString().slice(0, 10);
    const sorted = [...data.snapshots].sort((a, b) => a.date.localeCompare(b.date));
    let points = sorted
      .filter((s) => s.date >= cutoffISO)
      .map((s) => ({
        date: s.date,
        label: new Date(s.date).toLocaleDateString("it-IT", { day: "numeric", month: "short" }),
        value: s.netWorth,
      }));
    // aggiungi il valore live di oggi se manca
    if (points.length === 0 || points[points.length - 1].date !== todayISO()) {
      points = [
        ...points,
        {
          date: todayISO(),
          label: new Date().toLocaleDateString("it-IT", { day: "numeric", month: "short" }),
          value: derived.agg.netWorth,
        },
      ];
    }
    let maxPoint = points[0];
    for (const p of points) if (p.value > maxPoint.value) maxPoint = p;
    return { points, maxPoint };
  }, [data.snapshots, range, derived.agg.netWorth]);

  const cashflow = useMemo(() => {
    const rows = [];
    for (let i = 5; i >= 0; i--) {
      const key = shiftedMonthKey(-i);
      const entrate = sumInMonth(data.incomes, key);
      const uscite = sumInMonth(data.expenses, key);
      rows.push({
        label: monthLabelShort(key),
        entrate,
        uscite,
        risparmio: entrate - uscite,
      });
    }
    return rows;
  }, [data.incomes, data.expenses]);

  const donutData = useMemo(() => {
    const alloc = allocationByClass(data.assets);
    const rows = [...alloc.entries()]
      .filter(([, v]) => v > 0)
      .map(([cls, v]) => ({ name: cls as string, value: v, color: chartTheme.classColors[cls] }));
    if (derived.agg.liquidity > 0) {
      rows.push({ name: "Liquidità", value: derived.agg.liquidity, color: chartTheme.liquidity });
    }
    return rows;
  }, [data.assets, derived.agg.liquidity, chartTheme]);

  if (!ready) return <LoadingState />;

  const hasAnyData =
    data.accounts.length +
      data.assets.length +
      data.debts.length +
      data.incomes.length +
      data.expenses.length >
    0;

  if (!hasAnyData) {
    return (
      <EmptyState
        icon={<Compass />}
        title="Benvenuto in PFOS"
        text="La tua dashboard prende vita con i primi dati: aggiungi un conto, un'entrata ricorrente e le spese principali. Bastano 5 minuti."
        action={
          <Link href="/onboarding">
            <Button>Inizia la configurazione</Button>
          </Link>
        }
      />
    );
  }

  const d = derived;
  const perf = {
    unrealized: totalUnrealizedGain(data.assets),
    realized: derived.realizedYear.gains - derived.realizedYear.losses,
  };
  const invested = data.assets.reduce((s, a) => s + a.quantity * a.avgCost, 0);
  const important = advice.filter((a) => a.severity !== "ok").slice(0, 3);
  const topAdvice = important.length > 0 ? important : advice.slice(0, 3);

  return (
    <div className="flex flex-col gap-6">
      {/* ── Hero patrimonio (elemento firma) ── */}
      <section className="rounded-3xl bg-brand p-6 text-white md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <div className="text-xs font-medium uppercase tracking-[0.14em] text-white/60">
              Patrimonio netto
            </div>
            <div className="tnum font-display mt-2 text-4xl font-semibold md:text-6xl">
              {fmtEUR(d.agg.netWorth)}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              {d.change30d ? (
                <span
                  className={`tnum inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold ${
                    d.change30d.abs >= 0 ? "text-emerald-200" : "text-red-200"
                  }`}
                >
                  {fmtEURSigned(d.change30d.abs)} ({fmtPctSigned(d.change30d.pct)}) in 30 giorni
                </span>
              ) : (
                <span className="text-xs text-white/50">
                  Lo storico si costruisce giorno per giorno con gli snapshot automatici
                </span>
              )}
              {d.agg.hasRealEstate && (
                <span className="tnum rounded-full bg-white/15 px-2.5 py-1 text-xs">
                  Netto finanziario (senza immobili): {fmtEUR0(d.agg.netFinancial)}
                </span>
              )}
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm md:grid-cols-4">
            {[
              { label: "Lordo", value: d.agg.gross },
              { label: "Liquidità", value: d.agg.liquidity },
              { label: "Investimenti", value: d.agg.investments },
              { label: "Debiti", value: d.agg.debts },
            ].map((x) => (
              <div key={x.label}>
                <dt className="text-xs text-white/60">{x.label}</dt>
                <dd className="tnum mt-0.5 font-semibold">{fmtEUR0(x.value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── 4 KPI ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Oggi puoi spendere"
          value={fmtEUR0(d.todayCanSpend)}
          sub="(budget mese − speso) ÷ giorni rimanenti"
        />
        <Kpi
          label="Tasso di risparmio"
          value={fmtPct(d.savingsRateMonth * 100)}
          sub="di questo mese"
          tone={d.savingsRateMonth >= 0.2 ? "pos" : d.savingsRateMonth < 0 ? "neg" : "default"}
        />
        <Kpi
          label="Autonomia"
          value={d.autonomyYears != null ? `${fmtNum(d.autonomyYears, 1)} anni` : "—"}
          sub="patrimonio liquido ÷ spesa media"
        />
        <Kpi
          label="Rendite passive 12M"
          value={fmtEUR0(d.passive12M)}
          sub={`≈ ${fmtEUR0(d.passive12M / 12)}/mese`}
        />
      </div>

      {/* ── Report del mese concluso ── */}
      <MonthlyReportCard data={data} />

      {/* ── Andamento patrimonio ── */}
      <Card
        title="Andamento patrimonio"
        subtitle="Costruito dagli snapshot automatici (1 al giorno all'apertura)"
        action={
          <Segmented<Range>
            options={(["7g", "30g", "6m", "1a", "5a", "10a"] as Range[]).map((r) => ({
              value: r,
              label: r,
            }))}
            value={range}
            onChange={setRange}
          />
        }
      >
        {chart.points.length >= 2 ? (
          <NetWorthChart data={chart.points} maxPoint={chart.maxPoint} />
        ) : (
          <p className="py-10 text-center text-sm text-faint">
            Riapri l&apos;app nei prossimi giorni: ogni apertura salva uno snapshot e il grafico
            prende forma.
          </p>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Asset allocation ── */}
        <Card title="Asset allocation" subtitle="Investimenti e liquidità">
          {donutData.length > 0 ? (
            <div className="flex flex-col items-center gap-4 sm:flex-row">
              <div className="w-full sm:w-1/2">
                <AllocationDonut data={donutData} />
              </div>
              <ul className="flex w-full flex-col gap-2 text-sm sm:w-1/2">
                {donutData.map((row) => {
                  const total = donutData.reduce((s, x) => s + x.value, 0);
                  return (
                    <li key={row.name} className="flex items-center gap-2">
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ background: row.color }}
                      />
                      <span className="flex-1 truncate text-soft">{row.name}</span>
                      <span className="tnum font-medium">
                        {fmtPct((row.value / total) * 100)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-faint">
              Aggiungi conti e investimenti per vedere la ripartizione.
            </p>
          )}
        </Card>

        {/* ── Salute finanziaria ── */}
        <Card
          title={
            <span className="flex items-center gap-1">
              Indice di salute finanziaria
              <InfoTip text="Media a pesi uguali di 5 sotto-punteggi (0–100): fondo emergenza, tasso di risparmio, diversificazione, debito contenuto, concentrazione. Le formule sono nei tooltip di ogni barra." />
            </span>
          }
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex flex-col items-center gap-1 sm:w-2/5">
              <div
                className={`tnum font-display text-5xl font-semibold ${
                  d.health.total >= 70
                    ? "text-pos"
                    : d.health.total >= 40
                      ? "text-warn"
                      : "text-neg"
                }`}
              >
                {d.health.total}
              </div>
              <div className="text-xs text-faint">su 100</div>
              <HealthRadar
                data={d.health.subscores.map((s) => ({ label: s.label, score: s.score }))}
              />
            </div>
            <ul className="flex flex-1 flex-col gap-3">
              {d.health.subscores.map((s) => (
                <li key={s.key}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                    <span className="flex items-center gap-1 font-medium text-ink">
                      {s.label}
                      <InfoTip text={s.formula} />
                    </span>
                    <span className="tnum text-soft">{Math.round(s.score)}</span>
                  </div>
                  <ProgressBar
                    value={s.score}
                    tone={s.score >= 70 ? "pos" : s.score >= 40 ? "warn" : "neg"}
                  />
                  <div className="mt-1 text-[11px] text-faint">{s.detail}</div>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Cash flow 6 mesi ── */}
        <Card title="Cash flow — ultimi 6 mesi" subtitle="Entrate, uscite e risparmio mensile">
          <CashflowChart data={cashflow} />
        </Card>

        {/* ── Performance investimenti ── */}
        <Card title="Performance investimenti">
          {data.assets.length > 0 ? (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
              <PerfRow label="Profitto totale" value={perf.unrealized + perf.realized} />
              <PerfRow label="Non realizzato" value={perf.unrealized} />
              <PerfRow label="Realizzato (anno)" value={perf.realized} />
              <div>
                <dt className="text-xs text-soft">Tasse latenti</dt>
                <dd className="tnum mt-0.5 font-semibold text-warn">{fmtEUR(d.latentTax)}</dd>
              </div>
              <div>
                <dt className="text-xs text-soft">Rendimento atteso</dt>
                <dd className="tnum mt-0.5 font-semibold text-ink">
                  {fmtPct(d.portfolio.mu * 100)}{" "}
                  <span className="font-normal text-faint">annuo</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-soft">Volatilità stimata</dt>
                <dd className="tnum mt-0.5 font-semibold text-ink">
                  {fmtPct(d.portfolio.sigma * 100)}{" "}
                  <span className="font-normal text-faint">annua</span>
                </dd>
              </div>
              <div className="col-span-2 border-t border-line pt-3 text-xs text-faint">
                Capitale investito: <span className="tnum">{fmtEUR(invested)}</span> · Valore
                attuale: <span className="tnum">{fmtEUR(d.agg.investments)}</span>
              </div>
            </dl>
          ) : (
            <p className="py-10 text-center text-sm text-faint">
              Aggiungi il tuo primo investimento per vedere la performance.
            </p>
          )}
        </Card>
      </div>

      {/* ── Le tre cose più importanti ── */}
      <Card
        title="Le tre cose più importanti adesso"
        action={
          <Link
            href="/consigli"
            className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline"
          >
            Tutti i consigli <ArrowRight className="size-4" />
          </Link>
        }
      >
        {topAdvice.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-3">
            {topAdvice.map((a) => (
              <AdviceCard key={a.id} advice={a} />
            ))}
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-faint">
            Nessun consiglio al momento: aggiungi più dati per un&apos;analisi completa.
          </p>
        )}
      </Card>
    </div>
  );
}

function PerfRow({ label, value }: { label: string; value: number }) {
  const color = value > 0 ? "text-pos" : value < 0 ? "text-neg" : "text-ink";
  return (
    <div>
      <dt className="text-xs text-soft">{label}</dt>
      <dd className={`tnum mt-0.5 font-semibold ${color}`}>{fmtEURSigned(value)}</dd>
    </div>
  );
}
