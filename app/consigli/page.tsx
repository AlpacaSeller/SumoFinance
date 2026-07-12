"use client";

// ── Consigli: tutte le card del RulesAdvisor ────────────────────────────────

import Link from "next/link";
import { useMemo } from "react";
import { Lightbulb } from "lucide-react";
import { useFinancial } from "@/lib/useFinancial";
import { advisor } from "@/lib/engine/advisor";
import { Button, EmptyState, LoadingState, PageHeader } from "@/components/ui";
import { AdviceCard } from "@/components/AdviceCard";

export default function ConsigliPage() {
  const { ready, data, derived } = useFinancial();

  const advice = useMemo(
    () => (ready ? advisor.analyze({ data, derived }) : []),
    [ready, data, derived]
  );

  if (!ready) return <LoadingState />;

  const hasData =
    data.accounts.length + data.assets.length + data.incomes.length + data.expenses.length > 0;

  return (
    <div>
      <PageHeader
        title="Consigli"
        subtitle={`${advice.length} analis${advice.length === 1 ? "i" : "i"} sul tuo profilo ${data.settings.riskProfile} — rivalutate a ogni apertura`}
      />
      {advice.length === 0 ? (
        <EmptyState
          icon={<Lightbulb />}
          title={hasData ? "Nessun rilievo al momento" : "Ancora niente da analizzare"}
          text={
            hasData
              ? "Con più storico (entrate, uscite, investimenti) le analisi diventano più ricche."
              : "Aggiungi conti, movimenti e investimenti: il motore dei consigli si attiva da solo."
          }
          action={
            !hasData ? (
              <Link href="/conti">
                <Button>Aggiungi il primo conto</Button>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {advice.map((a) => (
            <AdviceCard key={a.id} advice={a} />
          ))}
        </div>
      )}
      <p className="mt-8 text-center text-xs text-faint">
        Le analisi si basano solo sui tuoi dati e su medie storiche: non sono previsioni di
        mercato né consulenza finanziaria personalizzata.
      </p>
    </div>
  );
}
