"use client";

// ── Conti & liquidità ───────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import { AlertTriangle, Pencil, Plus, Trash2, Wallet } from "lucide-react";
import { useFinancial } from "@/lib/useFinancial";
import { storage } from "@/lib/storage";
import { ACCOUNT_TYPES, uid, type Account, type AccountType } from "@/lib/types";
import { forecastLiquidity } from "@/lib/engine/forecast";
import { accountEurBalance } from "@/lib/engine/aggregates";
import { eurRate as getEurRate } from "@/lib/prices/providers";
import { fmtEUR, fmtEUR0, fmtNum, fmtPct, monthLabel, monthLabelShort, parseItAmount } from "@/lib/format";

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "JPY", "CAD", "AUD", "SEK", "NOK", "DKK", "PLN"];
import { useToast, useUndoableDelete } from "@/components/toast";
import {
  Badge,
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
  Select,
} from "@/components/ui";
import { ForecastChart } from "@/components/lazyCharts";

export default function ContiPage() {
  const { ready, data, derived } = useFinancial();
  const [editing, setEditing] = useState<Account | "new" | null>(null);
  const undoableDelete = useUndoableDelete();

  const forecast = useMemo(() => forecastLiquidity(data, 12), [data]);
  const forecastData = useMemo(
    () =>
      forecast.months.map((m) => ({
        label: monthLabelShort(m.key),
        entrate: m.incomeRecurring + Math.max(0, m.oneOff),
        uscite: m.expenseStructured + m.variableExpense + Math.max(0, -m.oneOff),
        saldo: m.balance,
      })),
    [forecast]
  );

  if (!ready) return <LoadingState />;

  const accounts = [...data.accounts].sort(
    (a, b) => accountEurBalance(b) - accountEurBalance(a)
  );
  const total = derived.agg.liquidity;

  return (
    <div>
      <PageHeader
        title="Conti & liquidità"
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus className="size-4" /> Nuovo conto
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3">
        <Kpi label="Liquidità totale" value={fmtEUR(total)} />
        <Kpi
          label="Copertura spese"
          value={
            derived.coverageMonths != null ? `${fmtNum(derived.coverageMonths, 1)} mesi` : "—"
          }
          sub="liquidità ÷ spesa media mensile"
        />
      </div>

      {accounts.length === 0 ? (
        <EmptyState
          icon={<Wallet />}
          title="Nessun conto ancora"
          text="Aggiungi il tuo conto corrente, la carta o i contanti: la liquidità è la base di tutte le metriche."
          action={<Button onClick={() => setEditing("new")}>Aggiungi un conto</Button>}
        />
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {accounts.map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-ink">{a.name}</div>
                  <div className="text-xs text-faint">
                    {a.type}
                    {a.currency && a.currency !== "EUR" && ` · ${a.currency}`}
                  </div>
                </div>
                <div className="text-right">
                  <div className="tnum font-semibold">{fmtEUR(accountEurBalance(a))}</div>
                  <div className="tnum text-xs text-faint">
                    {a.currency && a.currency !== "EUR"
                      ? `${fmtNum(a.balance)} ${a.currency}`
                      : total > 0
                        ? `${fmtPct((accountEurBalance(a) / total) * 100)} della liquidità`
                        : "—"}
                  </div>
                </div>
                <div className="flex shrink-0">
                  <IconButton label={`Modifica ${a.name}`} onClick={() => setEditing(a)}>
                    <Pencil className="size-4" />
                  </IconButton>
                  <IconButton
                    label={`Elimina ${a.name}`}
                    onClick={() => undoableDelete("accounts", a, `Conto "${a.name}"`)}
                  >
                    <Trash2 className="size-4" />
                  </IconButton>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ── Previsione liquidità ── */}
      <Card
        title="Previsione liquidità — prossimi 12 mesi"
        subtitle="Ricorrenti, abbonamenti, rate e scadenze + una stima delle spese variabili"
        className="mt-6"
        action={
          forecast.firstNegative ? (
            <Badge tone="neg">
              <AlertTriangle className="size-3" /> sotto zero a {monthLabel(forecast.firstNegative)}
            </Badge>
          ) : (
            <Badge tone="pos">saldo sempre positivo</Badge>
          )
        }
      >
        {data.recurring.length + data.subscriptions.length + data.debts.length + data.expenses.length > 0 ? (
          <>
            <ForecastChart data={forecastData} />
            <p className="mt-3 text-xs text-faint">
              Ipotesi: spese variabili stimate{" "}
              <strong className="tnum text-soft">{fmtEUR0(forecast.variableMonthly)}/mese</strong>{" "}
              (media delle uscite non automatiche degli ultimi 3 mesi) · saldo di partenza{" "}
              <span className="tnum">{fmtEUR0(forecast.start)}</span> · le rate con ammortamento
              si riducono e si fermano all&apos;estinzione. È una proiezione dei flussi noti, non
              una previsione.
            </p>
          </>
        ) : (
          <p className="py-8 text-center text-sm text-faint">
            Aggiungi entrate ricorrenti, abbonamenti o debiti: la proiezione si costruisce dai
            flussi strutturati.
          </p>
        )}
      </Card>

      <AccountModal
        key={editing === "new" ? "new" : editing?.id ?? "closed"}
        editing={editing}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

function AccountModal({
  editing,
  onClose,
}: {
  editing: Account | "new" | null;
  onClose: () => void;
}) {
  const { showToast } = useToast();
  const isNew = editing === "new";
  const base = isNew ? null : editing;
  const [name, setName] = useState(base?.name ?? "");
  const [type, setType] = useState<AccountType>(base?.type ?? "conto corrente");
  const [balance, setBalance] = useState(base != null ? String(base.balance).replace(".", ",") : "");
  const [currency, setCurrency] = useState(base?.currency ?? "EUR");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseItAmount(balance);
    if (!name.trim() || parsed == null) {
      showToast("Controlla nome e saldo: il saldo accetta la virgola (es. 1.250,50)", {
        kind: "error",
      });
      return;
    }
    let eurRate = base?.eurRate;
    if (currency !== "EUR" && (currency !== base?.currency || eurRate == null)) {
      try {
        eurRate = await getEurRate(currency);
      } catch {
        showToast(`Cambio ${currency}→EUR non disponibile ora: riprovo alla prossima apertura`, {
          kind: "info",
        });
      }
    }
    const account: Account = {
      id: base?.id ?? uid(),
      name: name.trim(),
      type,
      balance: parsed,
      currency: currency === "EUR" ? undefined : currency,
      eurRate: currency === "EUR" ? undefined : eurRate,
    };
    await storage.put("accounts", account);
    showToast(isNew ? "Conto aggiunto" : "Conto aggiornato", { kind: "success" });
    onClose();
  }

  return (
    <Modal
      open={editing !== null}
      onClose={onClose}
      title={isNew ? "Nuovo conto" : "Modifica conto"}
    >
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Nome">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="es. Conto principale"
            autoFocus
          />
        </Field>
        <Field label="Tipo">
          <Select value={type} onChange={(e) => setType(e.target.value as AccountType)}>
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label={`Saldo attuale (${currency})`}>
            <Input
              inputMode="decimal"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              placeholder="es. 2.500,00"
            />
          </Field>
          <Field label="Valuta" hint={currency !== "EUR" ? "Convertita in EUR ai cambi BCE" : undefined}>
            <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <ModalFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Annulla
          </Button>
          <Button type="submit">Salva conto</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
