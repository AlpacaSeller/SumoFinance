"use client";

// ── Uscite & budget ─────────────────────────────────────────────────────────

import { useMemo, useRef, useState } from "react";
import { Camera, FileDown, FileUp, Pencil, Plus, TrendingDown } from "lucide-react";
import { useFinancial } from "@/lib/useFinancial";
import { storage, useTable } from "@/lib/storage";
import { fingerprint } from "@/lib/importRules";
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  type ImportProfile,
  type ImportRule,
} from "@/lib/types";
import { sumInMonth } from "@/lib/engine/aggregates";
import { futureValueMonthly } from "@/lib/engine/montecarlo";
import { extractReceipt } from "@/lib/engine/llmAdvisor";
import {
  fmtEUR,
  fmtEUR0,
  fmtPct,
  monthKey,
  monthLabelShort,
  parseItAmount,
  shiftedMonthKey,
} from "@/lib/format";
import { useToast } from "@/components/toast";
import {
  Button,
  Card,
  EmptyState,
  Field,
  IconButton,
  Input,
  Kpi,
  LoadingState,
  Modal,
  ModalFooter,
  PageHeader,
  ProgressBar,
} from "@/components/ui";
import { AllocationDonut, MonthlyBars } from "@/components/lazyCharts";
import { useChartTheme } from "@/components/chartTheme";
import {
  buildMovementsCsv,
  downloadTextFile,
  MonthNav,
  MovementModal,
  MovementRows,
  RecurringSection,
  searchMovements,
  TagTotalsCard,
  useMonthNav,
  type Movement,
} from "@/components/movements";
import dynamic from "next/dynamic";
import { useOpenNew } from "@/lib/useOpenNew";

// wizard (e papaparse) caricati solo quando l'utente apre l'import
const CsvImportWizard = dynamic(
  () => import("@/components/CsvImportWizard").then((m) => m.CsvImportWizard),
  { ssr: false }
);

export default function UscitePage() {
  const { ready, data, derived } = useFinancial();
  const [editing, setEditing] = useState<Movement | "new" | null>(null);
  const [draft, setDraft] = useState<Partial<Movement> | undefined>(undefined);
  const [reading, setReading] = useState(false);
  const receiptInput = useRef<HTMLInputElement>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [overrideFor, setOverrideFor] = useState<string | null>(null);
  const [query, setQuery] = useState(() =>
    typeof window === "undefined" ? "" : (new URLSearchParams(window.location.search).get("q") ?? "")
  );
  const { showToast } = useToast();
  const nav = useMonthNav();
  useOpenNew(() => setEditing("new"));
  const rules = useTable<ImportRule>("importRules") ?? [];
  const profiles = useTable<ImportProfile>("importProfiles") ?? [];
  const chartTheme = useChartTheme();

  const categories = useMemo(
    () => [...EXPENSE_CATEGORIES, ...(data.settings.customExpenseCategories || [])],
    [data.settings.customExpenseCategories]
  );

  const last12 = useMemo(() => {
    const rows = [];
    for (let i = 11; i >= 0; i--) {
      const key = shiftedMonthKey(-i);
      rows.push({ key, label: monthLabelShort(key), value: sumInMonth(data.expenses, key) });
    }
    return rows;
  }, [data.expenses]);

  const avg12 = useMemo(() => {
    const withData = last12.filter((r) => r.value > 0);
    return withData.length > 0
      ? withData.reduce((s, r) => s + r.value, 0) / withData.length
      : 0;
  }, [last12]);

  const donutMonth = useMemo(() => {
    const byCat = new Map<string, number>();
    for (const e of data.expenses) {
      if (monthKey(e.date) === nav.key) {
        byCat.set(e.category, (byCat.get(e.category) || 0) + e.amount);
      }
    }
    return [...byCat.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, value], i) => ({
        name,
        value,
        color: chartTheme.categorical[i % chartTheme.categorical.length],
      }));
  }, [data.expenses, nav.key, chartTheme]);

  const existingFingerprints = useMemo(() => {
    const set = new Set<string>();
    for (const i of data.incomes)
      set.add(i.fingerprint ?? fingerprint(i.date, i.amount, i.description));
    for (const e of data.expenses)
      set.add(e.fingerprint ?? fingerprint(e.date, -e.amount, e.description));
    return set;
  }, [data.incomes, data.expenses]);

  if (!ready) return <LoadingState />;

  const aiConfigured = Boolean(data.settings.aiProvider && data.settings.aiApiKey);

  /** ridimensiona la foto (max 1280px, jpeg) prima di mandarla all'AI */
  async function fileToDataUrl(file: File): Promise<string> {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  }

  async function onReceiptPicked(file: File | undefined) {
    if (!file) return;
    setReading(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const parsed = await extractReceipt(data.settings, dataUrl, categories);
      setDraft({
        description: parsed.description,
        amount: parsed.amount,
        date: parsed.date,
        category: parsed.category,
      });
      setEditing("new");
      showToast("Scontrino letto: controlla i campi e salva", { kind: "success" });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Lettura non riuscita", {
        kind: "error",
        duration: 7000,
      });
    } finally {
      setReading(false);
      if (receiptInput.current) receiptInput.current.value = "";
    }
  }

  const monthExpenses = data.expenses.filter((e) => monthKey(e.date) === nav.key);
  const spentThisMonth = derived.expenseMonth;
  const budgetTotal = derived.totalBudget;
  const savingsIfLess = Math.max(0, budgetTotal - spentThisMonth);

  return (
    <div>
      <PageHeader
        title="Uscite & budget"
        actions={
          <>
            {aiConfigured && (
              <>
                <input
                  ref={receiptInput}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  aria-label="Foto dello scontrino"
                  onChange={(e) => void onReceiptPicked(e.target.files?.[0])}
                />
                <Button
                  variant="outline"
                  onClick={() => receiptInput.current?.click()}
                  disabled={reading}
                >
                  <Camera className="size-4" /> {reading ? "Il sumo legge…" : "Da foto"}
                </Button>
              </>
            )}
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <FileUp className="size-4" /> Importa CSV
            </Button>
            {data.expenses.length > 0 && (
              <Button
                variant="outline"
                onClick={() =>
                  downloadTextFile("sumo-uscite.csv", buildMovementsCsv(data.expenses, "uscita"))
                }
              >
                <FileDown className="size-4" /> Esporta CSV
              </Button>
            )}
            <Button onClick={() => setEditing("new")}>
              <Plus className="size-4" /> Nuova uscita
            </Button>
          </>
        }
      />

      {data.expenses.length === 0 && data.recurring.filter((r) => r.type === "uscita").length === 0 ? (
        <EmptyState
          icon={<TrendingDown />}
          title="Nessuna uscita registrata"
          text="Registra le spese a mano, rendile ricorrenti (affitto, bollette) o importa l'estratto conto in CSV: i budget si calcolano da soli."
          action={<Button onClick={() => setEditing("new")}>{"Aggiungi un'uscita"}</Button>}
        />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Speso questo mese" value={fmtEUR0(spentThisMonth)} />
            <Kpi
              label="Budget totale mese"
              value={fmtEUR0(budgetTotal)}
              sub="media 3 mesi + override"
            />
            <Kpi label="Media mensile (12M)" value={fmtEUR0(avg12)} />
            <Kpi
              label="Oggi puoi spendere"
              value={fmtEUR0(derived.todayCanSpend)}
              sub="(budget − speso) ÷ giorni rimanenti"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card
              title="Dove vanno i soldi"
              subtitle={<span className="capitalize">{nav.label}</span>}
            >
              {donutMonth.length > 0 ? (
                <>
                  <AllocationDonut data={donutMonth} height={190} />
                  <ul className="mt-2 flex flex-col gap-0.5 text-sm">
                    {donutMonth.slice(0, 6).map((row) => (
                      <li key={row.name}>
                        <button
                          onClick={() => setQuery(row.name)}
                          title={`Vedi tutti i movimenti di ${row.name}`}
                          className="flex min-h-9 w-full items-center gap-2 rounded-lg px-1 text-left hover:bg-surface-2"
                        >
                          <span className="size-2.5 rounded-full" style={{ background: row.color }} />
                          <span className="flex-1 text-soft">{row.name}</span>
                          <span className="tnum font-medium">{fmtEUR0(row.value)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="py-8 text-center text-xs text-faint">Nessuna spesa nel mese.</p>
              )}
            </Card>
            <Card title="Uscite — ultimi 12 mesi" className="lg:col-span-2">
              <MonthlyBars data={last12} tone="neg" avg={avg12} />
            </Card>
          </div>

          {/* ── Budget dinamici ── */}
          <Card
            title="Budget per categoria"
            subtitle="Budget = media delle uscite degli ultimi 3 mesi; usa la matita per fissarlo a mano"
            action={
              <label className="flex cursor-pointer items-center gap-2 text-xs text-soft">
                <input
                  type="checkbox"
                  checked={data.settings.budgetRollover ?? false}
                  onChange={(e) =>
                    storage.put("settings", {
                      ...data.settings,
                      budgetRollover: e.target.checked,
                    })
                  }
                  className="size-4 accent-brand"
                />
                Riporta il non speso
              </label>
            }
          >
            {derived.budgets.filter((b) => b.budget > 0 || b.spent > 0).length > 0 ? (
              <>
                <ul className="flex flex-col gap-4">
                  {derived.budgets
                    .filter((b) => b.budget > 0 || b.spent > 0)
                    .map((b) => {
                      const pct = b.budget > 0 ? (b.spent / b.budget) * 100 : b.spent > 0 ? 100 : 0;
                      return (
                        <li key={b.category}>
                          <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                            <span className="flex items-center gap-1 font-medium">
                              {b.category}
                              {b.isOverride && (
                                <span className="text-[10px] font-semibold uppercase text-accent">
                                  fisso
                                </span>
                              )}
                              {b.rollover > 0 && (
                                <span
                                  className="text-[10px] font-semibold uppercase text-pos"
                                  title={`Include ${fmtEUR0(b.rollover)} riportati dal mese scorso`}
                                >
                                  +{fmtEUR0(b.rollover)} rollover
                                </span>
                              )}
                              <IconButton
                                label={`Modifica budget ${b.category}`}
                                onClick={() => setOverrideFor(b.category)}
                                className="!size-9"
                              >
                                <Pencil className="size-3.5" />
                              </IconButton>
                            </span>
                            <span className="tnum text-xs text-soft">
                              {fmtEUR0(b.spent)} / {fmtEUR0(b.budget)}{" "}
                              {b.budget > 0 && `(${fmtPct(pct, 0)})`}
                            </span>
                          </div>
                          <ProgressBar
                            value={pct}
                            tone={pct > 100 ? "neg" : pct > 80 ? "warn" : "pos"}
                          />
                        </li>
                      );
                    })}
                </ul>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-sm">
                  <span>
                    Totale mese:{" "}
                    <span className="tnum font-semibold">{fmtEUR0(spentThisMonth)}</span> su{" "}
                    <span className="tnum font-semibold">{fmtEUR0(budgetTotal)}</span> di budget
                    {(() => {
                      const totalRollover = derived.budgets.reduce((s, b) => s + b.rollover, 0);
                      return totalRollover > 0 ? (
                        <span className="text-xs text-pos">
                          {" "}
                          (di cui {fmtEUR0(totalRollover)} riportati dal mese scorso)
                        </span>
                      ) : null;
                    })()}
                  </span>
                  {savingsIfLess > 0 && (
                    <span className="text-xs text-soft">
                      Se resti nel budget, questo mese puoi investire{" "}
                      <strong className="tnum text-pos">{fmtEUR0(savingsIfLess)}</strong> in più — in
                      10 anni al 6% varrebbero{" "}
                      <strong className="tnum text-pos">
                        {fmtEUR0(futureValueMonthly(savingsIfLess, 0.06, 10))}
                      </strong>
                      .
                    </span>
                  )}
                </div>
              </>
            ) : (
              <p className="py-6 text-center text-sm text-faint">
                I budget compaiono dopo il primo mese di spese registrate.
              </p>
            )}
          </Card>

          <Card
            title="Movimenti"
            action={
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Cerca in tutti i mesi…"
                  aria-label="Cerca nelle uscite"
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
                const results = searchMovements(data.expenses, query);
                return results.length > 0 ? (
                  <>
                    <p className="mb-2 text-xs text-faint">
                      {results.length} risultat{results.length === 1 ? "o" : "i"}
                      {results.length === 100 && " (mostro i primi 100)"} per “{query.trim()}”
                    </p>
                    <MovementRows movements={results} kind="uscita" onEdit={setEditing} />
                  </>
                ) : (
                  <p className="py-8 text-center text-sm text-faint">
                    Nessuna uscita trovata per “{query.trim()}”.
                  </p>
                );
              })()
            ) : monthExpenses.length > 0 ? (
              <>
                <MovementRows movements={monthExpenses} kind="uscita" onEdit={setEditing} />
                <div className="mt-3 border-t border-line pt-3 text-right text-sm">
                  Totale mese:{" "}
                  <span className="tnum font-semibold text-neg">
                    {fmtEUR(sumInMonth(data.expenses, nav.key))}
                  </span>
                </div>
              </>
            ) : (
              <p className="py-8 text-center text-sm text-faint">Nessuna uscita in {nav.label}.</p>
            )}
          </Card>

          <TagTotalsCard movements={data.expenses} kind="uscita" onTagClick={setQuery} />

          <Card>
            <RecurringSection
              kind="uscita"
              recurring={data.recurring}
              categories={categories}
              movements={data.expenses}
            />
          </Card>
        </div>
      )}

      <MovementModal
        key={editing === "new" ? "new" : editing?.id ?? "closed"}
        kind="uscita"
        editing={editing}
        categories={categories}
        settings={data.settings}
        existingFingerprints={existingFingerprints}
        draft={draft}
        onClose={() => {
          setEditing(null);
          setDraft(undefined);
        }}
      />
      {importOpen && (
        <CsvImportWizard
          open={importOpen}
          onClose={() => setImportOpen(false)}
          incomeCategories={[...INCOME_CATEGORIES, ...(data.settings.customIncomeCategories || [])]}
          expenseCategories={categories}
          rules={rules}
          profiles={profiles}
          existingFingerprints={existingFingerprints}
        />
      )}
      {overrideFor && (
        <BudgetOverrideModal
          category={overrideFor}
          onClose={() => setOverrideFor(null)}
        />
      )}
    </div>
  );
}

function BudgetOverrideModal({
  category,
  onClose,
}: {
  category: string;
  onClose: () => void;
}) {
  const { data, derived } = useFinancial();
  const { showToast } = useToast();
  const current = data.settings.budgetOverrides?.[category];
  const auto = derived.budgets.find((b) => b.category === category);
  const [value, setValue] = useState(current != null ? String(current).replace(".", ",") : "");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const overrides = { ...(data.settings.budgetOverrides || {}) };
    const parsed = parseItAmount(value);
    if (value.trim() === "" || parsed == null) {
      delete overrides[category];
      await storage.put("settings", { ...data.settings, budgetOverrides: overrides });
      showToast(`Budget di ${category} tornato automatico (media 3 mesi)`, { kind: "success" });
    } else {
      overrides[category] = parsed;
      await storage.put("settings", { ...data.settings, budgetOverrides: overrides });
      showToast(`Budget di ${category} fissato a ${fmtEUR0(parsed)}`, { kind: "success" });
    }
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={`Budget — ${category}`}>
      <form onSubmit={save} className="flex flex-col gap-4">
        <p className="text-sm text-soft">
          Budget automatico (media ultimi 3 mesi):{" "}
          <span className="tnum font-semibold">{fmtEUR0(auto && !auto.isOverride ? auto.budget : 0)}</span>
          . Lascia vuoto per tornare all&apos;automatico.
        </p>
        <Field label="Budget mensile fisso (€)">
          <Input
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="es. 400"
            autoFocus
          />
        </Field>
        <ModalFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Annulla
          </Button>
          <Button type="submit">Salva budget</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
