"use client";

// ── Debiti ──────────────────────────────────────────────────────────────────

import { useState } from "react";
import { Landmark, Pencil, Plus, Trash2 } from "lucide-react";
import { useFinancial } from "@/lib/useFinancial";
import { storage } from "@/lib/storage";
import { DEBT_TYPES, uid, type Debt, type DebtType } from "@/lib/types";
import { assetValue } from "@/lib/engine/aggregates";
import { payoffMonth, rataSplit } from "@/lib/engine/amortization";
import { fmtDate, fmtEUR, fmtPct, monthLabel, parseItAmount } from "@/lib/format";
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

export default function DebitiPage() {
  const { ready, data, derived } = useFinancial();
  const [editing, setEditing] = useState<Debt | "new" | null>(null);
  const undoableDelete = useUndoableDelete();

  if (!ready) return <LoadingState />;

  const totalResidual = derived.agg.debts;
  const totalMonthly = data.debts.reduce((s, d) => s + d.monthlyPayment, 0);
  const debtToGross =
    derived.agg.gross > 0 ? (totalResidual / derived.agg.gross) * 100 : null;

  return (
    <div>
      <PageHeader
        title="Debiti"
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus className="size-4" /> Nuovo debito
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi label="Debito residuo" value={fmtEUR(totalResidual)} />
        <Kpi label="Rate mensili" value={fmtEUR(totalMonthly)} sub="registrate automaticamente nelle uscite" />
        <Kpi
          label="Debiti / lordo"
          value={debtToGross != null ? fmtPct(debtToGross) : "—"}
          tone={debtToGross != null && debtToGross > 100 ? "neg" : "default"}
          sub={debtToGross != null && debtToGross > 100 ? "leva elevata" : "ottimo se ≤ 30%"}
        />
      </div>

      {data.debts.length === 0 ? (
        <EmptyState
          icon={<Landmark />}
          title="Nessun debito registrato"
          text="Mutui, prestiti e finanziamenti: le rate entrano da sole nel calendario e nelle uscite. Collega il mutuo alla casa per vedere equity e loan-to-value."
          action={<Button onClick={() => setEditing("new")}>Aggiungi un debito</Button>}
        />
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {data.debts.map((d) => {
              const linked = d.linkedAssetId
                ? data.assets.find((a) => a.id === d.linkedAssetId)
                : undefined;
              const equity = linked ? assetValue(linked) - d.residual : null;
              const ltv =
                linked && assetValue(linked) > 0
                  ? (d.residual / assetValue(linked)) * 100
                  : null;
              const split =
                d.amortize && d.residual > 0 && d.monthlyPayment > 0
                  ? rataSplit(d.residual, d.tan, d.monthlyPayment)
                  : null;
              const payoff =
                d.amortize && d.residual > 0
                  ? payoffMonth(d.residual, d.tan, d.monthlyPayment)
                  : null;
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1 basis-48">
                    <div className="truncate font-medium text-ink">{d.name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-faint">
                      <Badge tone="neutral">{d.type}</Badge>
                      <span className="tnum">TAN {fmtPct(d.tan)}</span>
                      {d.endDate && <span>fine {fmtDate(d.endDate)}</span>}
                    </div>
                    {linked && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <Badge tone="brand">→ {linked.name}</Badge>
                        {equity != null && (
                          <Badge tone={equity >= 0 ? "pos" : "neg"}>
                            equity {fmtEUR(equity)}
                          </Badge>
                        )}
                        {ltv != null && <Badge tone="accent">LTV {fmtPct(ltv)}</Badge>}
                      </div>
                    )}
                    {split && !split.underwater && (
                      <div className="tnum mt-1.5 text-xs text-soft">
                        Prossima rata: {fmtEUR(split.principal)} capitale +{" "}
                        {fmtEUR(split.interest)} interessi
                        {payoff && (
                          <>
                            {" "}
                            · estinzione stimata:{" "}
                            <span className="font-medium capitalize">{monthLabel(payoff)}</span>
                          </>
                        )}
                      </div>
                    )}
                    {split?.underwater && (
                      <Badge tone="neg" className="mt-1.5">
                        la rata non copre gli interessi
                      </Badge>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="tnum font-semibold text-neg">{fmtEUR(d.residual)}</div>
                    <div className="tnum text-xs text-faint">
                      rata {fmtEUR(d.monthlyPayment)} il giorno {d.paymentDay}
                    </div>
                  </div>
                  <div className="flex shrink-0">
                    <IconButton label={`Modifica ${d.name}`} onClick={() => setEditing(d)}>
                      <Pencil className="size-4" />
                    </IconButton>
                    <IconButton
                      label={`Elimina ${d.name}`}
                      onClick={() => undoableDelete("debts", d, `Debito "${d.name}"`)}
                    >
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <DebtModal
        key={editing === "new" ? "new" : editing?.id ?? "closed"}
        editing={editing}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

function DebtModal({
  editing,
  onClose,
}: {
  editing: Debt | "new" | null;
  onClose: () => void;
}) {
  const { data } = useFinancial();
  const { showToast } = useToast();
  const isNew = editing === "new";
  const base = isNew ? null : editing;
  const [name, setName] = useState(base?.name ?? "");
  const [type, setType] = useState<DebtType>(base?.type ?? "mutuo");
  const [residual, setResidual] = useState(base ? String(base.residual).replace(".", ",") : "");
  const [tan, setTan] = useState(base ? String(base.tan).replace(".", ",") : "");
  const [monthly, setMonthly] = useState(
    base ? String(base.monthlyPayment).replace(".", ",") : ""
  );
  const [endDate, setEndDate] = useState(base?.endDate ?? "");
  const [paymentDay, setPaymentDay] = useState(String(base?.paymentDay ?? 1));
  const [linkedAssetId, setLinkedAssetId] = useState(base?.linkedAssetId ?? "");
  const [amortize, setAmortize] = useState(base?.amortize ?? true);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const res = parseItAmount(residual);
    const rate = parseItAmount(monthly) ?? 0;
    const tanParsed = parseItAmount(tan) ?? 0;
    if (!name.trim() || res == null || res < 0) {
      showToast("Controlla nome e debito residuo", { kind: "error" });
      return;
    }
    const debt: Debt = {
      id: base?.id ?? uid(),
      name: name.trim(),
      type,
      residual: res,
      tan: tanParsed,
      monthlyPayment: rate,
      endDate: endDate || undefined,
      linkedAssetId: linkedAssetId || undefined,
      paymentDay: Math.min(28, Math.max(1, Number(paymentDay) || 1)),
      amortize,
    };
    await storage.put("debts", debt);
    showToast(isNew ? "Debito aggiunto" : "Debito aggiornato", { kind: "success" });
    onClose();
  }

  return (
    <Modal
      open={editing !== null}
      onClose={onClose}
      title={isNew ? "Nuovo debito" : "Modifica debito"}
      wide
    >
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="es. Mutuo casa"
            autoFocus
          />
        </Field>
        <Field label="Tipo">
          <Select value={type} onChange={(e) => setType(e.target.value as DebtType)}>
            {DEBT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Debito residuo (€)">
          <Input
            inputMode="decimal"
            value={residual}
            onChange={(e) => setResidual(e.target.value)}
            placeholder="es. 120.000"
          />
        </Field>
        <Field label="TAN (%)">
          <Input
            inputMode="decimal"
            value={tan}
            onChange={(e) => setTan(e.target.value)}
            placeholder="es. 3,2"
          />
        </Field>
        <Field label="Rata mensile (€)">
          <Input
            inputMode="decimal"
            value={monthly}
            onChange={(e) => setMonthly(e.target.value)}
            placeholder="es. 650"
          />
        </Field>
        <Field label="Giorno di addebito della rata (1–28)">
          <Input
            type="number"
            min={1}
            max={28}
            value={paymentDay}
            onChange={(e) => setPaymentDay(e.target.value)}
          />
        </Field>
        <Field label="Data fine (facoltativa)">
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
        <Field
          label="Asset collegato (facoltativo)"
          hint="es. mutuo → immobile: calcola equity e loan-to-value"
        >
          <Select value={linkedAssetId} onChange={(e) => setLinkedAssetId(e.target.value)}>
            <option value="">Nessuno</option>
            {data.assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.assetClass})
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex min-h-11 cursor-pointer items-start gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            checked={amortize}
            onChange={(e) => setAmortize(e.target.checked)}
            className="mt-1 size-4 accent-brand"
          />
          <span>
            Ammortamento automatico (piano francese)
            <span className="block text-xs text-faint">
              A ogni rata registrata il residuo scende della quota capitale (rata − interessi
              del mese, calcolati dal TAN). Disattiva se preferisci aggiornare il residuo a
              mano.
            </span>
          </span>
        </label>
        <div className="sm:col-span-2">
          <ModalFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Annulla
            </Button>
            <Button type="submit">Salva debito</Button>
          </ModalFooter>
        </div>
      </form>
    </Modal>
  );
}
