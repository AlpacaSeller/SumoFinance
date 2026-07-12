"use client";

// ── Valore investimenti nel tempo (ricostruzione accurata, 12 mesi) ─────────
// Usa le operazioni datate + lo storico prezzi reale (Yahoo per azioni/ETF,
// CoinGecko per le crypto). Gli asset senza storico sono esclusi e dichiarati.

import { useEffect, useMemo, useState } from "react";
import { History } from "lucide-react";
import type { Asset, AssetTransaction } from "@/lib/types";
import type { PricePoint } from "@/lib/engine/benchmark";
import {
  reconstructPortfolioHistory,
  type PortfolioHistoryResult,
} from "@/lib/engine/portfolioHistory";
import { ensureAssetHistory } from "@/lib/prices/history";
import { fmtEURSigned, fmtPctSigned, todayISO } from "@/lib/format";
import { Badge, Card } from "./ui";
import { PortfolioHistoryChart } from "./lazyCharts";

/** Asset con storico prezzi disponibile (Yahoo o CoinGecko). */
function trackable(a: Asset): boolean {
  return (
    a.assetClass !== "Immobili" &&
    !!a.symbol &&
    (a.priceSource === "yahoo" || a.priceSource === "coingecko")
  );
}

export function PortfolioHistoryCard({
  assets,
  transactions,
}: {
  assets: Asset[];
  transactions: AssetTransaction[];
}) {
  const [histories, setHistories] = useState<Map<string, PricePoint[]> | null>(null);
  const [loading, setLoading] = useState(true);

  // chiave = simbolo dell'asset (Yahoo symbol o CoinGecko id): coincide con la
  // chiave usata da reconstructPortfolioHistory (historyBySymbol.has(a.symbol))
  const trackKey = useMemo(
    () =>
      [...new Set(assets.filter(trackable).map((a) => `${a.priceSource}:${a.symbol}`))].join("|"),
    [assets]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const map = new Map<string, PricePoint[]>();
      const seen = new Set<string>();
      for (const a of assets) {
        if (!trackable(a) || !a.symbol || seen.has(a.symbol)) continue;
        seen.add(a.symbol);
        const points = await ensureAssetHistory(a);
        if (points && points.length > 0) map.set(a.symbol, points);
      }
      if (!cancelled) {
        setHistories(map);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackKey]);

  const result: PortfolioHistoryResult | null = useMemo(() => {
    if (!histories) return null;
    return reconstructPortfolioHistory(assets, transactions, histories, todayISO(), 12);
  }, [histories, assets, transactions]);

  // niente da mostrare se nessun asset ha storico
  if (!loading && (!result || result.includedAssets.length === 0)) return null;

  const first = result?.points.find((p) => p.value > 0);
  const last = result?.points[result.points.length - 1];
  const growth = first && last && first.value > 0 ? last.value - first.value : null;
  const growthPct = first && last && first.value > 0 ? ((last.value - first.value) / first.value) * 100 : null;

  return (
    <Card
      title={
        <span className="flex items-center gap-1.5">
          <History className="size-4 text-brand-ink" aria-hidden />
          Valore investimenti — ultimi 12 mesi
        </span>
      }
      subtitle="Ricostruito da operazioni datate e prezzi storici reali"
      action={
        growth != null && growthPct != null ? (
          <Badge tone={growth >= 0 ? "pos" : "neg"}>
            {fmtEURSigned(growth)} ({fmtPctSigned(growthPct)})
          </Badge>
        ) : undefined
      }
    >
      {loading ? (
        <p className="py-8 text-center text-sm text-faint">Ricostruisco lo storico…</p>
      ) : result ? (
        <>
          <PortfolioHistoryChart data={result.points} />
          {result.excludedAssets.length > 0 && (
            <p className="mt-3 text-xs text-faint">
              Esclusi (senza storico prezzi disponibile): {result.excludedAssets.join(", ")}. Lo
              storico c&apos;è per gli asset con fonte prezzo Yahoo (azioni, ETF) o CoinGecko
              (crypto); manuali e immobili restano fuori.
            </p>
          )}
        </>
      ) : null}
    </Card>
  );
}
