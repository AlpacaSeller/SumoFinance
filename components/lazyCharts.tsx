"use client";

// ── Grafici caricati on-demand ──────────────────────────────────────────────
// Recharts pesa ~450 KB: con next/dynamic il chunk si scarica solo quando un
// grafico entra davvero in pagina, alleggerendo il primo avvio (specie su 4G).
// Nota: next/dynamic richiede le opzioni come OGGETTO LETTERALE, da cui la
// ripetizione dello skeleton per ogni grafico.

import dynamic from "next/dynamic";

function ChartSkeleton({ height }: { height: number }) {
  return (
    <div aria-busy="true" className="animate-pulse rounded-xl bg-line/40" style={{ height }} />
  );
}

export const NetWorthChart = dynamic(() => import("./charts").then((m) => m.NetWorthChart), {
  ssr: false,
  loading: () => <ChartSkeleton height={260} />,
});

export const AllocationDonut = dynamic(() => import("./charts").then((m) => m.AllocationDonut), {
  ssr: false,
  loading: () => <ChartSkeleton height={220} />,
});

export const HealthRadar = dynamic(() => import("./charts").then((m) => m.HealthRadar), {
  ssr: false,
  loading: () => <ChartSkeleton height={240} />,
});

export const CashflowChart = dynamic(() => import("./charts").then((m) => m.CashflowChart), {
  ssr: false,
  loading: () => <ChartSkeleton height={240} />,
});

export const MonthlyBars = dynamic(() => import("./charts").then((m) => m.MonthlyBars), {
  ssr: false,
  loading: () => <ChartSkeleton height={220} />,
});

export const FanChart = dynamic(() => import("./charts").then((m) => m.FanChart), {
  ssr: false,
  loading: () => <ChartSkeleton height={320} />,
});

export const PortfolioTreemap = dynamic(
  () => import("./charts").then((m) => m.PortfolioTreemap),
  {
    ssr: false,
    loading: () => <ChartSkeleton height={280} />,
  }
);

export const ForecastChart = dynamic(() => import("./charts").then((m) => m.ForecastChart), {
  ssr: false,
  loading: () => <ChartSkeleton height={260} />,
});

export const PortfolioHistoryChart = dynamic(
  () => import("./charts").then((m) => m.PortfolioHistoryChart),
  {
    ssr: false,
    loading: () => <ChartSkeleton height={240} />,
  }
);

export const PriceHistoryChart = dynamic(
  () => import("./charts").then((m) => m.PriceHistoryChart),
  {
    ssr: false,
    loading: () => <ChartSkeleton height={180} />,
  }
);
