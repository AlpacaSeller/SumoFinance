"use client";

// ── Tasse (regime italiano, semplificato) ───────────────────────────────────

import { useMemo, useState } from "react";
import { FileDown, Pencil, Printer, Receipt } from "lucide-react";
import { useFinancial } from "@/lib/useFinancial";
import { storage } from "@/lib/storage";
import type { LossPot, TaxState } from "@/lib/types";
import {
  expiringPots,
  latentTax,
  potExpiryYear,
  taxOptimizationHints,
  taxRate,
  unrealizedGain,
} from "@/lib/engine/tax";
import {
  allRealizedEvents,
  computeTaxFromTransactions,
  mergedPots,
  realizedByYear,
  totalMergedPots,
} from "@/lib/engine/transactions";
import { buildTaxCsv, buildTaxReportHtml } from "@/lib/taxReport";
import { assetValue } from "@/lib/engine/aggregates";
import { fmtEUR, fmtEURSigned, fmtPct, parseItAmount } from "@/lib/format";
import { useToast } from "@/components/toast";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Kpi,
  LoadingState,
  Modal,
  ModalFooter,
  PageHeader,
  Select,
} from "@/components/ui";

export default function TassePage() {
  const { ready, data, derived } = useFinancial();
  const [editOpen, setEditOpen] = useState(false);
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const { showToast } = useToast();

  const events = useMemo(
    () => allRealizedEvents(data.assets, data.assetTransactions),
    [data.assets, data.assetTransactions]
  );

  // anni selezionabili: quelli con operazioni realizzate + il corrente
  const years = useMemo(() => {
    const set = new Set<number>([currentYear]);
    for (const e of events) set.add(e.year);
    return [...set].sort((a, b) => b - a);
  }, [events, currentYear]);

  // fisco calcolato per l'anno scelto (le rettifiche manuali valgono solo
  // per l'anno corrente: si riferiscono a "quest'anno" per definizione)
  const computed = useMemo(() => computeTaxFromTransactions(events, year), [events, year]);
  const isCurrent = year === currentYear;
  const realizedSelected = useMemo(() => {
    const fromTx = realizedByYear(events).get(year) ?? { gains: 0, losses: 0 };
    return {
      gains: fromTx.gains + (isCurrent ? data.taxState.realizedGainsYear : 0),
      losses: fromTx.losses + (isCurrent ? data.taxState.realizedLossesYear : 0),
      fromTx,
    };
  }, [events, year, isCurrent, data.taxState]);

  function exportCsv() {
    if (events.length === 0) {
      showToast("Nessuna operazione realizzata da esportare", { kind: "info" });
      return;
    }
    const blob = new Blob([buildTaxCsv(events, data.assets)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pfos-operazioni-fiscali-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("CSV esportato (separatore ; — pronto per Excel)", { kind: "success" });
  }

  function openReport() {
    const html = buildTaxReportHtml({
      year,
      events,
      assets: data.assets,
      computed,
      taxState: isCurrent ? data.taxState : { ...data.taxState, realizedGainsYear: 0, realizedLossesYear: 0 },
      latentTax: derived.latentTax,
      realizedYear: { gains: realizedSelected.gains, losses: realizedSelected.losses },
    });
    const w = window.open("", "_blank");
    if (!w) {
      showToast("Il browser ha bloccato la finestra del report: consenti i popup", {
        kind: "error",
      });
      return;
    }
    w.document.write(html);
    w.document.close();
  }

  if (!ready) return <LoadingState />;

  const tax = data.taxState;
  // zainetto complessivo (auto da operazioni + rettifiche manuali) per i suggerimenti
  const mergedTaxView = { ...tax, lossPots: [...computed.autoPots, ...tax.lossPots] };
  const hints = taxOptimizationHints(mergedTaxView, data.assets, year, fmtEUR);
  const expiring = expiringPots(mergedTaxView, year);
  const potRows = mergedPots(computed.autoPots, tax.lossPots);
  const assetsWithGain = [...data.assets]
    .filter((a) => a.quantity > 0)
    .sort((a, b) => latentTax(b) - latentTax(a));

  return (
    <div>
      <PageHeader
        title="Tasse"
        subtitle={`Stime sull'anno ${year} — regime italiano semplificato`}
        actions={
          <>
            {years.length > 1 && (
              <Select
                value={String(year)}
                onChange={(e) => setYear(Number(e.target.value))}
                className="!w-28"
                aria-label="Anno fiscale"
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </Select>
            )}
            <Button variant="outline" onClick={exportCsv}>
              <FileDown className="size-4" /> CSV operazioni
            </Button>
            <Button variant="outline" onClick={openReport}>
              <Printer className="size-4" /> Report (PDF)
            </Button>
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="size-4" /> Rettifiche manuali
            </Button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Tasse latenti totali"
          value={fmtEUR(derived.latentTax)}
          sub="se vendessi tutto oggi"
          info="Somma per asset di max(0, plusvalenza non realizzata) × aliquota: 26% standard, 12,5% whitelist, 33% crypto (dal 2026)."
        />
        <Kpi
          label="Plusvalenze realizzate"
          value={fmtEUR(realizedSelected.gains)}
          sub={
            isCurrent
              ? `nel ${year}: ${fmtEUR(realizedSelected.fromTx.gains)} da operazioni + ${fmtEUR(tax.realizedGainsYear)} rettifiche`
              : `nel ${year}, da operazioni registrate in app`
          }
        />
        <Kpi
          label="Minusvalenze realizzate"
          value={fmtEUR(realizedSelected.losses)}
          sub={
            isCurrent
              ? `nel ${year}: ${fmtEUR(realizedSelected.fromTx.losses)} da operazioni + ${fmtEUR(tax.realizedLossesYear)} rettifiche`
              : `nel ${year}, da operazioni registrate in app`
          }
        />
        <Kpi
          label="Zainetto fiscale"
          value={fmtEUR(totalMergedPots(computed.autoPots, tax))}
          sub="minusvalenze compensabili"
          info="Le minusvalenze si compensano con plusvalenze future entro il 31/12 del 4° anno successivo alla formazione. Le vendite in perdita registrate in app lo alimentano da sole."
        />
      </div>

      {(computed.estimatedTaxDue > 0 || computed.compensatedThisYear > 0) && (
        <div className="mb-6 grid grid-cols-2 gap-3">
          <Kpi
            label={`Imposta stimata sul realizzato ${year}`}
            value={fmtEUR(computed.estimatedTaxDue)}
            tone="neg"
            info="Plusvalenze delle vendite registrate in app, al netto delle compensazioni con lo zainetto da operazioni, moltiplicate per l'aliquota dell'asset venduto."
          />
          <Kpi
            label="Compensato con lo zainetto"
            value={fmtEUR(computed.compensatedThisYear)}
            tone="pos"
            sub="imposte evitate grazie alle minusvalenze"
          />
        </div>
      )}

      {/* ── Ottimizzazione ── */}
      {(hints.length > 0 || expiring.length > 0) && (
        <Card title="Ottimizzazione fiscale" className="mb-6">
          <ul className="flex flex-col gap-3">
            {hints.map((h, i) => (
              <li key={i} className="rounded-xl bg-warn-soft px-4 py-3 text-sm text-ink">
                {h.text}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ── Zainetto per anno ── */}
      {potRows.length > 0 && (
        <Card
          title="Zainetto per anno di formazione"
          subtitle="Le voci «da operazioni» si aggiornano da sole a ogni vendita; le rettifiche manuali coprono ciò che è fuori dall'app"
          className="mb-6"
        >
          <ul className="divide-y divide-line">
            {potRows.map(({ pot, source }, i) => (
              <li key={`${source}-${pot.year}-${i}`} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="flex flex-wrap items-center gap-1.5">
                  Formazione {pot.year}
                  <Badge tone={potExpiryYear(pot) <= year ? "neg" : "neutral"}>
                    scade il 31/12/{potExpiryYear(pot)}
                  </Badge>
                  <Badge tone={source === "auto" ? "accent" : "neutral"}>
                    {source === "auto" ? "da operazioni" : "rettifica manuale"}
                  </Badge>
                </span>
                <span className="tnum font-semibold">{fmtEUR(pot.amount)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ── Per asset ── */}
      <Card title='Stima "se vendessi oggi" per asset' className="mb-6">
        {assetsWithGain.length > 0 ? (
          <ul className="divide-y divide-line">
            {assetsWithGain.map((a) => {
              const gain = unrealizedGain(a);
              const t = latentTax(a);
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <span className="font-medium">{a.name}</span>{" "}
                    <span className="text-xs text-faint">
                      · valore {fmtEUR(assetValue(a))} · aliquota {fmtPct(taxRate(a) * 100)}
                    </span>
                  </div>
                  <span
                    className={`tnum ${gain > 0 ? "text-pos" : gain < 0 ? "text-neg" : "text-faint"}`}
                  >
                    {fmtEURSigned(gain)}
                  </span>
                  {t > 0 ? (
                    <Badge tone="warn">{fmtEUR(t)} tasse se vendi</Badge>
                  ) : (
                    <Badge tone="pos">nessuna imposta</Badge>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            icon={<Receipt />}
            title="Nessun investimento"
            text="Le stime fiscali compaiono quando aggiungi asset in Investimenti."
          />
        )}
      </Card>

      <p className="rounded-2xl border border-line bg-surface-2 px-4 py-3 text-xs text-soft">
        <strong>Disclaimer.</strong> Stime semplificate a solo scopo informativo: non considerano
        l&apos;imposta di bollo 0,20%, l&apos;IVAFE, i regimi esteri, il regime dichiarativo vs
        amministrato né la non compensabilità dei redditi da capitale (es. dividendi). Le
        plusvalenze crypto usano il 33% per i realizzi dal 2026 (26% fino al 2025, legge di
        bilancio 2025). Per la dichiarazione serve un commercialista.
      </p>

      {editOpen && (
        <TaxEditModal
          tax={tax}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            showToast("Dati fiscali aggiornati", { kind: "success" });
            setEditOpen(false);
          }}
        />
      )}
    </div>
  );
}

function TaxEditModal({
  tax,
  onClose,
  onSaved,
}: {
  tax: TaxState;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const year = new Date().getFullYear();
  const [gains, setGains] = useState(String(tax.realizedGainsYear).replace(".", ","));
  const [losses, setLosses] = useState(String(tax.realizedLossesYear).replace(".", ","));
  const [pots, setPots] = useState<{ year: string; amount: string }[]>(
    tax.lossPots.length > 0
      ? tax.lossPots.map((p) => ({ year: String(p.year), amount: String(p.amount).replace(".", ",") }))
      : [{ year: String(year), amount: "" }]
  );

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const g = parseItAmount(gains) ?? 0;
    const l = parseItAmount(losses) ?? 0;
    const lossPots: LossPot[] = [];
    for (const p of pots) {
      const amount = parseItAmount(p.amount);
      const y = Number(p.year);
      if (amount != null && amount > 0 && y >= year - 4 && y <= year) {
        lossPots.push({ year: y, amount });
      } else if (amount != null && amount > 0) {
        showToast(`Anno di formazione ${p.year} non valido (ammessi ${year - 4}–${year})`, {
          kind: "error",
        });
        return;
      }
    }
    await storage.put("taxState", { ...tax, realizedGainsYear: g, realizedLossesYear: l, lossPots });
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title="Rettifiche manuali" wide>
      <form onSubmit={save} className="flex flex-col gap-4">
        <p className="text-xs text-soft">
          Le vendite registrate in app alimentano da sole plusvalenze, minusvalenze e zainetto.
          Qui inserisci solo ciò che avviene <strong>fuori</strong> dall&apos;app (es. altri
          broker o anni precedenti): si somma ai valori calcolati.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <Field label={`Plusvalenze extra-app ${year} (€)`}>
            <Input inputMode="decimal" value={gains} onChange={(e) => setGains(e.target.value)} />
          </Field>
          <Field label={`Minusvalenze extra-app ${year} (€)`}>
            <Input inputMode="decimal" value={losses} onChange={(e) => setLosses(e.target.value)} />
          </Field>
        </div>
        <div>
          <div className="mb-2 text-xs font-medium text-soft">
            Zainetto extra-app per anno di formazione (scadenza: 31/12 del 4° anno successivo)
          </div>
          <div className="flex flex-col gap-2">
            {pots.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  type="number"
                  min={year - 4}
                  max={year}
                  value={p.year}
                  onChange={(e) =>
                    setPots((ps) => ps.map((x, j) => (j === i ? { ...x, year: e.target.value } : x)))
                  }
                  className="!w-28"
                  aria-label="Anno di formazione"
                />
                <Input
                  inputMode="decimal"
                  value={p.amount}
                  onChange={(e) =>
                    setPots((ps) => ps.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))
                  }
                  placeholder="Importo €"
                  aria-label="Importo minusvalenze"
                />
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setPots((ps) => ps.filter((_, j) => j !== i))}
                >
                  Rimuovi
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() => setPots((ps) => [...ps, { year: String(year), amount: "" }])}
            >
              + Aggiungi anno
            </Button>
          </div>
        </div>
        <ModalFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Annulla
          </Button>
          <Button type="submit">Salva dati fiscali</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
