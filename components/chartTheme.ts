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
  grid: "#e6e2d8",
  axis: "#8a958e",
  soft: "#5f6d66",
  surface: "#ffffff",
  tooltip: {
    borderRadius: 12,
    border: "1px solid #e6e2d8",
    background: "#ffffff",
    color: "#1c2b26",
    fontSize: 12,
    boxShadow: "0 8px 24px rgba(28,43,38,0.12)",
  },
  brandLine: "#12382b",
  pos: "#1b7f4d",
  neg: "#bf3f3f",
  accent: "#2b59c3",
  classColors: {
    ETF: "#1d4a3a",
    Azioni: "#2b59c3",
    Obbligazioni: "#8a6fbf",
    Crypto: "#c4643c",
    "Oro & metalli": "#c9a227",
    Immobili: "#6b7f73",
    Altro: "#93a29b",
  },
  liquidity: "#4a6b5c",
  categorical: [
    "#12382b",
    "#2b59c3",
    "#c4643c",
    "#8a6fbf",
    "#c9a227",
    "#1b7f4d",
    "#6b7f73",
    "#bf3f3f",
    "#93a29b",
  ],
};

const DARK: ChartTheme = {
  grid: "#2a342e",
  axis: "#79857e",
  soft: "#a4afa8",
  surface: "#181f1b",
  tooltip: {
    borderRadius: 12,
    border: "1px solid #3b463f",
    background: "#1e2621",
    color: "#e7ece8",
    fontSize: 12,
    boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
  },
  brandLine: "#a5d2bc",
  pos: "#4fb583",
  neg: "#e08585",
  accent: "#6b8fe8",
  classColors: {
    ETF: "#4a8a6f",
    Azioni: "#6b8fe8",
    Obbligazioni: "#a48fd6",
    Crypto: "#d98a5f",
    "Oro & metalli": "#d3b64e",
    Immobili: "#87a094",
    Altro: "#a7b3ac",
  },
  liquidity: "#6f9482",
  categorical: [
    "#4a8a6f",
    "#6b8fe8",
    "#d98a5f",
    "#a48fd6",
    "#d3b64e",
    "#4fb583",
    "#87a094",
    "#e08585",
    "#a7b3ac",
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
