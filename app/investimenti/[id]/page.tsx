"use client";

// ── Dettaglio asset: storico prezzo 1 anno + target vs attuale ─────────────

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useFinancial } from "@/lib/useFinancial";
import { assetCost, assetValue, allocationByClass } from "@/lib/engine/aggregates";
import { latentTax, taxRate, unrealizedGain } from "@/lib/engine/tax";
import { assetXirr } from "@/lib/engine/xirr";
import { ensureAssetHistory } from "@/lib/prices/history";
import type { PricePoint } from "@/lib/engine/benchmark";
import { fmtDate, fmtEUR, fmtEURSigned, fmtNum, fmtPct, fmtPctSigned, todayISO } from "@/lib/format";
import { approxYtm, bondEvents } from "@/lib/engine/bonds";
import { Badge, Card, Kpi, LoadingState, PageHeader } from "@/components/ui";
import { PriceHistoryChart } from "@/components/lazyCharts";
import { AssetTransactionsCard } from "@/components/AssetTransactions";

/** Politica dividendi dedotta dal nome dell'ETF (euristica dichiarata). */
function distributionPolicy(name: string): string | null {
  if (/\b(acc|accumulating|accumulazione)\b/i.test(name)) return "Accumulazione";
  if (/\b(dist|distributing|distribuzione|inc)\b/i.test(name)) return "Distribuzione";
  return null;
}

export default function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { ready, data, derived } = useFinancial();
  const [fetched, setFetched] = useState<PricePoint[] | null | "loading">("loading");

  const asset = data.assets.find((a) => a.id === id);
  // storico disponibile per Yahoo (azioni/ETF) e CoinGecko (crypto)
  const supported =
    !!asset?.symbol && (asset.priceSource === "yahoo" || asset.priceSource === "coingecko");
  const symbol = supported ? asset!.symbol : undefined;
  const source = asset?.priceSource === "coingecko" ? "CoinGecko" : "Yahoo Finance";
  const history: PricePoint[] | null | "loading" | "none" = !supported ? "none" : fetched;

  useEffect(() => {
    if (!ready || !asset || !supported) return;
    let cancelled = false;
    (async () => {
      const points = await ensureAssetHistory(asset);
      if (!cancelled) setFetched(points);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, symbol]);

  if (!ready) return <LoadingState />;

  if (!asset) {
    return (
      <div>
        <PageHeader title="Asset non trovato" />
        <Link href="/investimenti" className="text-sm font-semibold text-accent hover:underline">
          ← Torna agli investimenti
        </Link>
      </div>
    );
  }

  const value = assetValue(asset);
  const cost = assetCost(asset);
  const pl = unrealizedGain(asset);
  const tax = latentTax(asset);
  const irr = assetXirr(asset, data.assetTransactions);
  const target = data.settings.targetAllocation;
  const alloc = allocationByClass(data.assets);
  const bondYtm = approxYtm(asset, todayISO());
  const horizon = new Date();
  horizon.setFullYear(horizon.getFullYear() + 40);
  const nextCoupon = bondEvents(asset, todayISO(), horizon.toISOString().slice(0, 10))[0];

  return (
    <div>
      <Link
        href="/investimenti"
        className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline"
      >
        <ArrowLeft className="size-4" /> Investimenti
      </Link>
      <PageHeader
        title={asset.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {asset.ticker && <span className="tnum">{asset.ticker}</span>}
            <Badge tone="brand">{asset.assetClass}</Badge>
            {asset.broker && <span>{asset.broker}</span>}
            <Badge tone={asset.taxRegime === "whitelist" ? "accent" : "neutral"}>
              aliquota {fmtPct(taxRate(asset) * 100)}
            </Badge>
            {asset.quoteCurrency && asset.quoteCurrency !== "EUR" && (
              <Badge tone="neutral">quotato in {asset.quoteCurrency}, convertito in EUR (BCE)</Badge>
            )}
            {asset.exchange && <Badge tone="neutral">{asset.exchange}</Badge>}
            {asset.ter != null && asset.ter > 0 && (
              <Badge tone="neutral">TER {fmtPct(asset.ter, 2)}</Badge>
            )}
            {distributionPolicy(asset.name) && (
              <Badge tone="neutral">{distributionPolicy(asset.name)}</Badge>
            )}
            {bondYtm != null && (
              <Badge tone="pos">rendimento a scadenza ≈ {fmtPct(bondYtm * 100)} lordo</Badge>
            )}
            {nextCoupon && (
              <Badge tone="neutral">
                {nextCoupon.isMaturity ? "rimborso" : "prossima cedola"} {fmtDate(nextCoupon.date)}
                {" · "}
                {fmtEUR(nextCoupon.amount)} lordi
              </Badge>
            )}
          </span>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Valore attuale" value={fmtEUR(value)} sub={`${fmtNum(asset.quantity, 6)} × ${fmtEUR(asset.currentPrice)}`} />
        <Kpi label="Capitale investito" value={fmtEUR(cost)} sub={`PMC ${fmtEUR(asset.avgCost)}`} />
        <Kpi
          label="P/L non realizzato"
          value={fmtEURSigned(pl)}
          sub={cost > 0 ? fmtPctSigned((pl / cost) * 100) : undefined}
          tone={pl > 0 ? "pos" : pl < 0 ? "neg" : "default"}
        />
        <Kpi
          label="Rendimento annuo (XIRR)"
          value={irr.rate != null ? fmtPctSigned(irr.rate * 100) : "—"}
          tone={irr.rate != null ? (irr.rate > 0 ? "pos" : "neg") : "default"}
          sub={irr.rate == null ? irr.reason : "money-weighted, dai tuoi flussi reali"}
          info="Tasso interno di rendimento annualizzato: considera date e importi di posizione iniziale, acquisti, vendite, dividendi registrati come operazioni e valore attuale."
        />
        <Kpi
          label="Tasse se vendi oggi"
          value={fmtEUR(tax)}
          sub={pl <= 0 ? "nessuna plusvalenza da tassare" : `aliquota ${fmtPct(taxRate(asset) * 100)}`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="Storico prezzo — 1 anno"
          subtitle={
            history !== "loading" && history !== "none" && history
              ? `Fonte ${source} · prezzi in EUR`
              : undefined
          }
        >
          {history === "loading" ? (
            <p className="py-10 text-center text-sm text-faint">Carico lo storico…</p>
          ) : history === "none" ? (
            <p className="py-10 text-center text-sm text-faint">
              Lo storico è disponibile per gli asset con fonte prezzo Yahoo (azioni, ETF) o
              CoinGecko (crypto).
            </p>
          ) : history === null ? (
            <p className="py-10 text-center text-sm text-faint">
              Storico non raggiungibile al momento (offline?). Riprova più tardi.
            </p>
          ) : history.length > 0 ? (
            <PriceHistoryChart points={history} />
          ) : (
            <p className="py-10 text-center text-sm text-faint">Nessun dato storico disponibile.</p>
          )}
        </Card>

        <Card
          title="Allocazione: target vs attuale"
          subtitle={
            target
              ? "Scostamenti per classe rispetto al tuo target"
              : "Imposta un'allocazione target in Impostazioni per vedere gli scostamenti"
          }
        >
          {target ? (
            <ul className="flex flex-col gap-2.5 text-sm">
              {Object.entries(target)
                .filter(([, pct]) => (pct ?? 0) > 0)
                .map(([cls, pct]) => {
                  const actual =
                    derived.agg.investments > 0
                      ? ((alloc.get(cls as never) ?? 0) / derived.agg.investments) * 100
                      : 0;
                  const diff = actual - (pct ?? 0);
                  const isCurrent = cls === asset.assetClass;
                  return (
                    <li
                      key={cls}
                      className={`flex items-center gap-3 rounded-xl px-3 py-2 ${
                        isCurrent ? "bg-brand-soft" : ""
                      }`}
                    >
                      <span className="flex-1 font-medium">{cls}</span>
                      <span className="tnum text-soft">
                        target {fmtPct(pct ?? 0, 0)} · attuale {fmtPct(actual)}
                      </span>
                      <Badge tone={Math.abs(diff) > 5 ? "warn" : "pos"}>
                        {fmtPctSigned(diff)}
                      </Badge>
                    </li>
                  );
                })}
            </ul>
          ) : (
            <p className="py-10 text-center text-sm text-faint">
              Nessun target impostato.
            </p>
          )}
        </Card>
      </div>

      <AssetTransactionsCard asset={asset} transactions={data.assetTransactions} />
    </div>
  );
}
