"use client";

import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { Advice } from "@/lib/types";
import { BoldText } from "./ui";

export function AdviceCard({ advice }: { advice: Advice }) {
  const styles = {
    alert: {
      border: "border-neg/25",
      bg: "bg-neg-soft/50",
      icon: <AlertTriangle className="size-5 text-neg" aria-hidden />,
      label: "Attenzione",
      labelColor: "text-neg",
    },
    warn: {
      border: "border-warn/25",
      bg: "bg-warn-soft/50",
      icon: <Info className="size-5 text-warn" aria-hidden />,
      label: "Da valutare",
      labelColor: "text-warn",
    },
    ok: {
      border: "border-pos/25",
      bg: "bg-pos-soft/50",
      icon: <CheckCircle2 className="size-5 text-pos" aria-hidden />,
      label: "Tutto bene",
      labelColor: "text-pos",
    },
  }[advice.severity];

  return (
    <article className={`rounded-2xl border ${styles.border} ${styles.bg} p-4`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">{styles.icon}</div>
        <div className="min-w-0">
          <div className={`text-[11px] font-semibold uppercase tracking-wide ${styles.labelColor}`}>
            {styles.label}
          </div>
          <h2 className="mt-0.5 font-semibold text-ink">{advice.title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-soft">
            <BoldText text={advice.body} />
          </p>
          {advice.action && (
            <p className="mt-2 text-sm font-medium text-ink">→ {advice.action}</p>
          )}
        </div>
      </div>
    </article>
  );
}
