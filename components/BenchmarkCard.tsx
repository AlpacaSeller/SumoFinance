"use client";

// ── Confronto con il benchmark (VWCE — FTSE All-World) ─────────────────────
// Replay dei flussi reali sull'indice: risponde a "come sarei messo se avessi
// investito le stesse somme, nelle stesse date, tutto su VWCE?"

import { useEffect, useMemo, useState } from "react";
import { Scale } from "lucide-react";
import { storage } from "@/lib/storage";
import type { Asset, AssetTransaction, PriceHistoryCache } from "@/lib/types";
import { investmentFlows, xirr } from "@/lib/engine/xirr";
import { benchmarkFromFlows, type PricePoint } from "@/lib/engine/benchmark";
import { assetValue } from "@/lib/engine/aggregates";
import { fmtEUR0, fmtEURSigned, fmtPctSigned, todayISO } from "@/lib/format";
import { Card } from "./ui";

const BENCH_SYMBOL = "VWCE.MI";
const CACHE_ID = `${BENCH_SYMBOL}:max`;
const TTL = 24 * 60 * 60 * 1000;

export function BenchmarkCard({
  assets,
  transactions,
}: {
  assets: Asset[];
  transactions: AssetTransaction[];
}) {
  const [points, setPoints] = useState<PricePoint[] | null | "loading">("loading");

  // flussi reali datati, immobili esclusi (confrontare la casa con un ETF non ha senso)
  const real = useMemo(
    () => investmentFlows(assets, transactions, (a) => a.assetClass !== "Immobili"),
    [assets, transactions]
  );

  useEffect(() => {
    if (real.flows.length === 0) return;
    let cancelled = false;
    (async () => {
      const cached = await storage.get<PriceHistoryCache>("priceHistoryCache", CACHE_ID);
      if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < TTL) {
        if (!cancelled) setPoints(cached.points);
        return;
      }
      try {
        const res = await fetch(`/api/quote?symbol=${BENCH_SYMBOL}&range=max`);
        if (!res.ok) throw new Error();
        const json = await res.json();
        const entry: PriceHistoryCache = {
          id: CACHE_ID,
          fetchedAt: new Date().toISOString(),
          currency: json.currency || "EUR",
          points: json.points || [],
        };
        await storage.put("priceHistoryCache", entry);
        if (!cancelled) setPoints(entry.points);
      } catch {
        if (!cancelled) setPoints(cached?.points ?? null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [real.flows.length]);

  if (real.flows.length === 0) return null;

  const actualValue = real.included
    .filter((a) => a.assetClass !== "Immobili")
    .reduce((s, a) => s + assetValue(a), 0);
  const actualRate = xirr([...real.flows, { date: todayISO(), amount: actualValue }]);

  const bench =
    points !== "loading" && points !== null && points.length > 0
      ? benchmarkFromFlows(real.flows, points)
      : null;

  return (
    <Card
      title={
        <span className="flex items-center gap-1.5">
          <Scale className="size-4 text-brand-ink" aria-hidden />
          E se fosse stato tutto su VWCE?
        </span>
      }
      subtitle="Gli stessi flussi (stessi importi, stesse date) investiti nel FTSE All-World — immobili esclusi"
    >
      {points === "loading" ? (
        <p className="py-8 text-center text-sm text-faint">Scarico lo storico del benchmark…</p>
      ) : bench == null ? (
        <p className="py-8 text-center text-sm text-faint">
          Storico del benchmark non disponibile al momento (offline?). Riprova più tardi.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-surface-2 p-3">
              <div className="text-xs text-soft">Il tuo portafoglio</div>
              <div className="tnum mt-1 text-lg font-semibold">{fmtEUR0(actualValue)}</div>
              <div className="tnum text-xs text-faint">
                XIRR {actualRate != null ? fmtPctSigned(actualRate * 100) : "—"}
              </div>
            </div>
            <div className="rounded-xl bg-surface-2 p-3">
              <div className="text-xs text-soft">Strategia VWCE</div>
              <div className="tnum mt-1 text-lg font-semibold">{fmtEUR0(bench.finalValue)}</div>
              <div className="tnum text-xs text-faint">
                XIRR {bench.rate != null ? fmtPctSigned(bench.rate * 100) : "—"}
              </div>
            </div>
            <div
              className={`rounded-xl p-3 ${
                actualValue >= bench.finalValue ? "bg-pos-soft" : "bg-warn-soft"
              }`}
            >
              <div className="text-xs text-soft">Differenza</div>
              <div
                className={`tnum mt-1 text-lg font-semibold ${
                  actualValue >= bench.finalValue ? "text-pos" : "text-warn"
                }`}
              >
                {fmtEURSigned(actualValue - bench.finalValue)}
              </div>
              <div className="text-xs text-faint">
                {actualValue >= bench.finalValue
                  ? "stai battendo l'indice"
                  : "l'indice avrebbe reso di più"}
              </div>
            </div>
          </div>
          <p className="mt-3 text-xs text-faint">
            Replay sui prezzi storici mensili di {BENCH_SYMBOL} (fonte Yahoo).
            {bench.clampedFlows > 0 &&
              ` ${bench.clampedFlows} flussi precedono lo storico disponibile e usano il primo prezzo noto.`}{" "}
            {real.excluded > 0 &&
              `${real.excluded} asset esclusi (manca la data di carico). `}
            Confronto indicativo: ignora dividendi non registrati, tasse e commissioni del
            benchmark.
          </p>
        </>
      )}
    </Card>
  );
}
