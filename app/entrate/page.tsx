"use client";

// ── Entrate ─────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import { Coins, FileDown, FileUp, Plus, TrendingDown, TrendingUp } from "lucide-react";
import { useFinancial } from "@/lib/useFinancial";
import { useTable } from "@/lib/storage";
import { fingerprint } from "@/lib/csv";
import {
  INCOME_CATEGORIES,
  PASSIVE_INCOME_CATEGORIES,
  type ImportProfile,
  type ImportRule,
} from "@/lib/types";
import { sumInMonth } from "@/lib/engine/aggregates";
import {
  fmtEUR,
  fmtEUR0,
  monthKey,
  monthLabelShort,
  shiftedMonthKey,
} from "@/lib/format";
import {
  Button,
  Card,
  EmptyState,
  Input,
  Kpi,
  LoadingState,
  PageHeader,
} from "@/components/ui";
import { MonthlyBars } from "@/components/lazyCharts";
import {
  buildMovementsCsv,
  downloadTextFile,
  MonthNav,
  MovementModal,
  MovementRows,
  RecurringSection,
  searchMovements,
  useMonthNav,
  type Movement,
} from "@/components/movements";
import { CsvImportWizard } from "@/components/CsvImportWizard";
import { useOpenNew } from "@/lib/useOpenNew";

export default function EntratePage() {
  const { ready, data } = useFinancial();
  const [editing, setEditing] = useState<Movement | "new" | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [query, setQuery] = useState("");
  const nav = useMonthNav();
  useOpenNew(() => setEditing("new"));
  const rules = useTable<ImportRule>("importRules") ?? [];
  const profiles = useTable<ImportProfile>("importProfiles") ?? [];

  const categories = useMemo(
    () => [...INCOME_CATEGORIES, ...(data.settings.customIncomeCategories || [])],
    [data.settings.customIncomeCategories]
  );

  const last12 = useMemo(() => {
    const rows = [];
    for (let i = 11; i >= 0; i--) {
      const key = shiftedMonthKey(-i);
      rows.push({ key, label: monthLabelShort(key), value: sumInMonth(data.incomes, key) });
    }
    return rows;
  }, [data.incomes]);

  const stats = useMemo(() => {
    const withData = last12.filter((r) => r.value > 0);
    if (withData.length === 0) return null;
    const values = withData.map((r) => r.value);
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    const firstHalf = last12.slice(0, 6).reduce((s, r) => s + r.value, 0);
    const secondHalf = last12.slice(6).reduce((s, r) => s + r.value, 0);
    return {
      avg,
      max: Math.max(...values),
      min: Math.min(...values),
      trendUp: secondHalf >= firstHalf,
    };
  }, [last12]);

  const passive = useMemo(() => {
    const cutoff = shiftedMonthKey(-12);
    const passiveSet = new Set<string>(PASSIVE_INCOME_CATEGORIES);
    const byCat = new Map<string, number>();
    for (const i of data.incomes) {
      const k = monthKey(i.date);
      if (k > cutoff && passiveSet.has(i.category)) {
        byCat.set(i.category, (byCat.get(i.category) || 0) + i.amount);
      }
    }
    for (const a of data.assets) {
      if (a.declaredAnnualIncome) {
        byCat.set("Rendite dichiarate", (byCat.get("Rendite dichiarate") || 0) + a.declaredAnnualIncome);
      }
    }
    return [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  }, [data.incomes, data.assets]);

  const existingFingerprints = useMemo(() => {
    const set = new Set<string>();
    for (const i of data.incomes)
      set.add(i.fingerprint ?? fingerprint(i.date, i.amount, i.description));
    for (const e of data.expenses)
      set.add(e.fingerprint ?? fingerprint(e.date, -e.amount, e.description));
    return set;
  }, [data.incomes, data.expenses]);

  if (!ready) return <LoadingState />;

  const monthIncomes = data.incomes.filter((i) => monthKey(i.date) === nav.key);
  const passiveTotal = passive.reduce((s, [, v]) => s + v, 0);

  return (
    <div>
      <PageHeader
        title="Entrate"
        actions={
          <>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <FileUp className="size-4" /> Importa CSV
            </Button>
            {data.incomes.length > 0 && (
              <Button
                variant="outline"
                onClick={() =>
                  downloadTextFile("sumo-entrate.csv", buildMovementsCsv(data.incomes, "entrata"))
                }
              >
                <FileDown className="size-4" /> Esporta CSV
              </Button>
            )}
            <Button onClick={() => setEditing("new")}>
              <Plus className="size-4" /> Nuova entrata
            </Button>
          </>
        }
      />

      {data.incomes.length === 0 && data.recurring.filter((r) => r.type === "entrata").length === 0 ? (
        <EmptyState
          icon={<Coins />}
          title="Nessuna entrata registrata"
          text="Registra lo stipendio come entrata ricorrente: si aggiornerà da solo ogni mese. Puoi anche importare l'estratto conto in CSV."
          action={<Button onClick={() => setEditing("new")}>{"Aggiungi un'entrata"}</Button>}
        />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Media mensile (12M)" value={stats ? fmtEUR0(stats.avg) : "—"} />
            <Kpi label="Mese migliore" value={stats ? fmtEUR0(stats.max) : "—"} />
            <Kpi label="Mese peggiore" value={stats ? fmtEUR0(stats.min) : "—"} />
            <Kpi
              label="Trend 12 mesi"
              value={
                stats ? (
                  <span className="flex items-center gap-1.5">
                    {stats.trendUp ? (
                      <TrendingUp className="size-5 text-pos" />
                    ) : (
                      <TrendingDown className="size-5 text-neg" />
                    )}
                    {stats.trendUp ? "in crescita" : "in calo"}
                  </span>
                ) : (
                  "—"
                )
              }
              sub="secondo semestre vs primo"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card title="Entrate — ultimi 12 mesi" className="lg:col-span-2">
              <MonthlyBars data={last12} tone="pos" avg={stats?.avg} />
            </Card>
            <Card
              title="Rendite passive 12M"
              subtitle={`${fmtEUR0(passiveTotal)} totali · ≈ ${fmtEUR0(passiveTotal / 12)}/mese`}
            >
              {passive.length > 0 ? (
                <ul className="flex flex-col gap-2 text-sm">
                  {passive.map(([cat, v]) => (
                    <li key={cat} className="flex items-center justify-between gap-2">
                      <span className="text-soft">{cat}</span>
                      <span className="tnum font-medium text-pos">{fmtEUR(v)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-6 text-center text-xs text-faint">
                  Dividendi, cedole, interessi, affitti: quando arrivano, li vedi qui.
                </p>
              )}
            </Card>
          </div>

          <Card
            title="Movimenti"
            action={
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Cerca in tutti i mesi…"
                  aria-label="Cerca nelle entrate"
                  className="!w-44"
                />
                {query.trim().length < 2 && (
                  <MonthNav label={nav.label} offset={nav.offset} setOffset={nav.setOffset} />
                )}
              </div>
            }
          >
            {query.trim().length >= 2 ? (
              (() => {
                const results = searchMovements(data.incomes, query);
                return results.length > 0 ? (
                  <>
                    <p className="mb-2 text-xs text-faint">
                      {results.length} risultat{results.length === 1 ? "o" : "i"}
                      {results.length === 100 && " (mostro i primi 100)"} per “{query.trim()}”
                    </p>
                    <MovementRows movements={results} kind="entrata" onEdit={setEditing} />
                  </>
                ) : (
                  <p className="py-8 text-center text-sm text-faint">
                    Nessuna entrata trovata per “{query.trim()}”.
                  </p>
                );
              })()
            ) : monthIncomes.length > 0 ? (
              <>
                <MovementRows movements={monthIncomes} kind="entrata" onEdit={setEditing} />
                <div className="mt-3 border-t border-line pt-3 text-right text-sm">
                  Totale mese:{" "}
                  <span className="tnum font-semibold text-pos">
                    {fmtEUR(sumInMonth(data.incomes, nav.key))}
                  </span>
                </div>
              </>
            ) : (
              <p className="py-8 text-center text-sm text-faint">
                Nessuna entrata in {nav.label}.
              </p>
            )}
          </Card>

          <Card>
            <RecurringSection
              kind="entrata"
              recurring={data.recurring}
              categories={categories}
              movements={data.incomes}
            />
          </Card>
        </div>
      )}

      <MovementModal
        key={editing === "new" ? "new" : editing?.id ?? "closed"}
        kind="entrata"
        editing={editing}
        categories={categories}
        settings={data.settings}
        existingFingerprints={existingFingerprints}
        onClose={() => setEditing(null)}
      />
      {importOpen && (
        <CsvImportWizard
          open={importOpen}
          onClose={() => setImportOpen(false)}
          incomeCategories={categories}
          expenseCategories={[...data.settings.customExpenseCategories, "Casa", "Cibo", "Auto", "Trasporti", "Salute", "Tempo libero", "Abbonamenti", "Altro"]}
          rules={rules}
          profiles={profiles}
          existingFingerprints={existingFingerprints}
        />
      )}
    </div>
  );
}
