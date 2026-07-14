"use client";

// ── Consigli: card del RulesAdvisor + analisi AI opzionale (BYOK) ───────────

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCcw } from "lucide-react";
import { useFinancial } from "@/lib/useFinancial";
import { advisor } from "@/lib/engine/advisor";
import {
  generateLlmAdvice,
  readCachedAdvice,
  writeCachedAdvice,
  type LlmAdviceResult,
} from "@/lib/engine/llmAdvisor";
import { fmtDateTime } from "@/lib/format";
import { Button, EmptyState, LoadingState, PageHeader } from "@/components/ui";
import { AdviceCard } from "@/components/AdviceCard";
import { SumoMascot } from "@/components/Mascot";

function AiAdviceSection() {
  const { ready, data, derived } = useFinancial();
  const [result, setResult] = useState<LlmAdviceResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  const configured = Boolean(data.settings.aiProvider && data.settings.aiApiKey);
  const hasData =
    data.accounts.length + data.assets.length + data.incomes.length + data.expenses.length > 0;

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const r = await generateLlmAdvice(data.settings, data, derived);
      writeCachedAdvice(r, data, derived);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analisi non riuscita");
    } finally {
      setBusy(false);
    }
  }

  // al primo ingresso: usa la cache del giorno, altrimenti genera in automatico
  useEffect(() => {
    if (!ready || !configured || !hasData || startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      await Promise.resolve(); // setState fuori dal corpo sincrono dell'effect
      const cached = readCachedAdvice(data, derived);
      if (cached) {
        setResult(cached);
      } else {
        await generate();
      }
    })();
    // generate/data/derived cambiano identità a ogni render: il ref li blinda
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, configured, hasData]);

  if (!configured) {
    return (
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface-2 px-4 py-3 text-sm text-soft">
        <SumoMascot size={40} />
        <span className="flex-1">
          Il sumo può analizzare i tuoi numeri con l&apos;AI: porti la tua chiave (Gemini è
          gratis) e ricevi analisi personalizzate accanto ai consigli a regole.
        </span>
        <Link href="/impostazioni">
          <Button variant="outline">Attiva in Impostazioni</Button>
        </Link>
      </div>
    );
  }
  if (!hasData) return null;

  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-wide">
          <SumoMascot size={28} /> L&apos;analisi del sumo
        </h2>
        <span className="text-xs text-faint">
          {result
            ? `${result.provider === "gemini" ? "Gemini" : "Claude"} · ${fmtDateTime(result.generatedAt)}`
            : "AI"}
        </span>
        <button
          aria-label="Rigenera l'analisi AI"
          onClick={() => void generate()}
          disabled={busy}
          className="flex size-9 items-center justify-center rounded-lg text-soft hover:bg-surface-2 hover:text-ink disabled:opacity-50"
        >
          <RefreshCcw className={`size-4 ${busy ? "animate-spin" : ""}`} />
        </button>
      </div>
      {busy ? (
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface-2 px-4 py-6 text-sm text-soft">
          <SumoMascot size={44} className="animate-pulse" />
          Il sumo sta studiando i tuoi numeri…
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-warn/25 bg-warn-soft px-4 py-3 text-sm text-warn">
          {error} — controlla la chiave in Impostazioni e riprova.
        </div>
      ) : result && result.advice.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          {result.advice.map((a) => (
            <AdviceCard key={a.id} advice={a} />
          ))}
        </div>
      ) : null}
      <p className="mt-2 text-xs text-faint">
        Generata dall&apos;AI sul riepilogo aggregato dei tuoi dati: non è consulenza
        finanziaria. Un&apos;analisi al giorno, rigenerabile a mano.
      </p>
    </section>
  );
}

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
        actions={<SumoMascot size={52} />}
      />
      <AiAdviceSection />
      {advice.length === 0 ? (
        <EmptyState
          mascot
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
