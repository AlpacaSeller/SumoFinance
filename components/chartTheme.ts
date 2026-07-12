"use client";

// ── Palette dei grafici per tema (SENZA importare Recharts) ─────────────────
// Separato da charts.tsx così le pagine possono leggere i colori senza
// trascinare nel bundle la libreria grafica (caricata lazy).

import type { CSSProperties } from "react";
import type { AssetClass } from "@/lib/types";
import { useTheme } from "./theme";

export interface ChartTheme {
  grid: string;
  axis: string;
  soft: string;
  surface: string;
  tooltip: CSSProperties;
  brandLine: string; // linea "patrimonio/mediana"
  pos: string;
  neg: string;
  accent: string;
  classColors: Record<AssetClass, string>;
  liquidity: string;
  categorical: string[]; // donut categorie di spesa
}

const LIGHT: ChartTheme = {
  grid: "#e8e1d3",
  axis: "#617072",
  soft: "#566a6c",
  surface: "#ffffff",
  tooltip: {
    borderRadius: 12,
    border: "1px solid #e8e1d3",
    background: "#ffffff",
    color: "#16282a",
    fontSize: 12,
    boxShadow: "0 8px 24px rgba(22,40,42,0.12)",
  },
  brandLine: "#17444a",
  pos: "#177347",
  neg: "#b03a3a",
  accent: "#2b59c3",
  classColors: {
    ETF: "#20575c",
    Azioni: "#2b59c3",
    Obbligazioni: "#8a6fbf",
    Crypto: "#c4643c",
    "Oro & metalli": "#c9a227",
    Immobili: "#6b7f80",
    Altro: "#93a1a2",
  },
  liquidity: "#4a6a6c",
  categorical: [
    "#17444a",
    "#2b59c3",
    "#c4643c",
    "#8a6fbf",
    "#c9a227",
    "#177347",
    "#6b7f80",
    "#b03a3a",
    "#93a1a2",
  ],
};

const DARK: ChartTheme = {
  grid: "#283436",
  axis: "#879496",
  soft: "#a3b0b1",
  surface: "#161f20",
  tooltip: {
    borderRadius: 12,
    border: "1px solid #3a4749",
    background: "#1c2627",
    color: "#e6ecec",
    fontSize: 12,
    boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
  },
  brandLine: "#9ecfd4",
  pos: "#4fb583",
  neg: "#e08585",
  accent: "#6b8fe8",
  classColors: {
    ETF: "#59a2a9",
    Azioni: "#6b8fe8",
    Obbligazioni: "#a48fd6",
    Crypto: "#d98a5f",
    "Oro & metalli": "#d3b64e",
    Immobili: "#8aa0a2",
    Altro: "#a7b3b4",
  },
  liquidity: "#6f9294",
  categorical: [
    "#59a2a9",
    "#6b8fe8",
    "#d98a5f",
    "#a48fd6",
    "#d3b64e",
    "#4fb583",
    "#8aa0a2",
    "#e08585",
    "#a7b3b4",
  ],
};

/** Palette grafici del tema corrente. */
export function useChartTheme(): ChartTheme {
  const { resolved } = useTheme();
  return resolved === "dark" ? DARK : LIGHT;
}

/** Colori per classe di attivo nel tema corrente (per donut/treemap/legende). */
export function useClassColors(): Record<AssetClass, string> {
  return useChartTheme().classColors;
}
