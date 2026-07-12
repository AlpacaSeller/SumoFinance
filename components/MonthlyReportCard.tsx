"use client";

// ── Card "Il tuo mese" in dashboard ─────────────────────────────────────────

import { useMemo, useState } from "react";
import { CalendarCheck, ChevronLeft, ChevronRight } from "lucide-react";
import type { FinancialData } from "@/lib/types";
import { buildMonthlyReport } from "@/lib/engine/monthlyReport";
import {
  fmtEUR0,
  fmtEURSigned,
  fmtPct,
  fmtPctSigned,
  monthLabel,
  shiftedMonthKey,
} from "@/lib/format";
import { Badge, Card, IconButton } from "./ui";

export function MonthlyReportCard({ data }: { data: FinancialData }) {
  const [offset, setOffset] = useState(-1); // -1 = mese scorso, -2 = due mesi fa…
  const key = shiftedMonthKey(offset);
  const report = useMemo(() => buildMonthlyReport(data, key), [data, key]);

  // non mostrare nulla solo se anche il mese scorso è vuoto
  const lastMonthReport = useMemo(() => buildMonthlyReport(data), [data]);
  if (!lastMonthReport && offset === -1 && !report) return null;

  const nav = (
    <div className="flex items-center gap-1">
      <IconButton
        label="Mese precedente"
        onClick={() => setOffset((o) => Math.max(-24, o - 1))}
        className="!size-9"
      >
        <ChevronLeft className="size-4" />
      </IconButton>
      <IconButton
        label="Mese successivo"
        onClick={() => setOffset((o) => Math.min(-1, o + 1))}
        disabled={offset >= -1}
        className={`!size-9 ${offset >= -1 ? "opacity-30" : ""}`}
      >
        <ChevronRight className="size-4" />
      </IconButton>
    </div>
  );

  if (!report) {
    return (
      <Card
        title={
          <span className="flex items-center gap-1.5 capitalize">
            <CalendarCheck className="size-4 text-brand-ink" aria-hidden />
            Il tuo mese: {monthLabel(key)}
          </span>
        }
        action={nav}
      >
        <p className="py-4 text-center text-sm text-faint">
          Nessun movimento registrato in {monthLabel(key)}.
        </p>
      </Card>
    );
  }

  const savedTone = report.saved >= 0 ? "text-pos" : "text-neg";
  const expenseDelta =
    report.prevExpense > 0 ? ((report.expense - report.prevExpense) / report.prevExpense) * 100 : null;

  return (
    <Card
      title={
        <span className="flex items-center gap-1.5 capitalize">
          <CalendarCheck className="size-4 text-brand-ink" aria-hidden />
          Il tuo mese: {monthLabel(report.key)}
        </span>
      }
      subtitle="Riepilogo automatico del mese concluso"
      action={nav}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl bg-surface-2 p-3">
          <div className="text-xs text-soft">Entrate</div>
          <div className="tnum mt-1 font-semibold text-pos">{fmtEUR0(report.income)}</div>
        </div>
        <div className="rounded-xl bg-surface-2 p-3">
          <div className="text-xs text-soft">Uscite</div>
          <div className="tnum mt-1 font-semibold text-neg">{fmtEUR0(report.expense)}</div>
          {expenseDelta != null && (
            <div className="tnum text-[11px] text-faint">
              {fmtPctSigned(expenseDelta, 0)} vs mese prima
            </div>
          )}
        </div>
        <div className="rounded-xl bg-surface-2 p-3">
          <div className="text-xs text-soft">Risparmiato</div>
          <div className={`tnum mt-1 font-semibold ${savedTone}`}>
            {fmtEURSigned(report.saved)}
          </div>
          {report.savingsRate != null && (
            <div className="tnum text-[11px] text-faint">
              tasso {fmtPct(report.savingsRate * 100, 0)}
            </div>
          )}
        </div>
        <div className="rounded-xl bg-surface-2 p-3">
          <div className="text-xs text-soft">Patrimonio netto</div>
          <div
            className={`tnum mt-1 font-semibold ${
              report.netDelta == null
                ? "text-ink"
                : report.netDelta.abs >= 0
                  ? "text-pos"
                  : "text-neg"
            }`}
          >
            {report.netDelta ? fmtEURSigned(report.netDelta.abs) : "—"}
          </div>
          {report.netDelta && (
            <div className="tnum text-[11px] text-faint">
              {fmtPctSigned(report.netDelta.pct)} nel mese
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
        {report.topCategory && (
          <Badge tone="neutral">
            top categoria: {report.topCategory.name} · {fmtEUR0(report.topCategory.amount)} (
            {fmtPct(report.topCategory.sharePct, 0)})
          </Badge>
        )}
        {report.biggestExpense && (
          <Badge tone="neutral">
            spesa più grande: {report.biggestExpense.description.slice(0, 32)} ·{" "}
            {fmtEUR0(report.biggestExpense.amount)}
          </Badge>
        )}
        {report.overAverage.map((o) => (
          <Badge key={o.category} tone="warn">
            {o.category} sopra la tua media: {fmtEUR0(o.spent)} vs {fmtEUR0(o.average)}
          </Badge>
        ))}
      </div>
    </Card>
  );
}
