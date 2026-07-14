"use client";

// ── Abbonamenti ─────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import { Pencil, Plus, Repeat, Sparkles, Trash2 } from "lucide-react";
import { useFinancial } from "@/lib/useFinancial";
import { storage } from "@/lib/storage";
import { uid, type Cadence, type Subscription } from "@/lib/types";
import { futureValueMonthly } from "@/lib/engine/montecarlo";
import { detectSubscriptionCandidates, type RecurringCandidate } from "@/lib/engine/recurring";
import { fmtEUR, fmtEUR0, parseItAmount, todayISO } from "@/lib/format";
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

const DISMISSED_KEY = "pfos-sub-suggestions-dismissed";

function readDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]") as string[]);
  } catch {
    return new Set();
  }
}

export default function AbbonamentiPage() {
  const { ready, data } = useFinancial();
  const [editing, setEditing] = useState<Subscription | "new" | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(() =>
    typeof window === "undefined" ? new Set() : readDismissed()
  );
  const { showToast } = useToast();
  const undoableDelete = useUndoableDelete();

  const candidates = useMemo(
    () =>
      ready
        ? detectSubscriptionCandidates(data.expenses, data.subscriptions, data.recurring).filter(
            (c) => !dismissed.has(c.description.toLowerCase())
          )
        : [],
    [ready, data.expenses, data.subscriptions, data.recurring, dismissed]
  );

  function dismiss(c: RecurringCandidate) {
    const next = new Set(dismissed).add(c.description.toLowerCase());
    setDismissed(next);
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]));
    } catch {
      /* niente */
    }
  }

  async function addAsSubscription(c: RecurringCandidate) {
    // startDate dal mese PROSSIMO: i mesi passati hanno già le spese registrate,
    // partire da subito creerebbe doppioni
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const startDate = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-01`;
    const sub: Subscription = {
      id: uid(),
      name: c.description,
      amount: c.amount,
      cadence: "mensile",
      active: true,
      chargeDay: c.day,
      startDate,
    };
    await storage.put("subscriptions", sub);
    dismiss(c);
    showToast(
      `"${c.description}" aggiunto: dagli addebiti dal mese prossimo ci pensa l'app`,
      { kind: "success", duration: 6000 }
    );
  }

  if (!ready) return <LoadingState />;

  const active = data.subscriptions.filter((s) => s.active);
  const monthly = active.reduce(
    (s, x) => s + (x.cadence === "mensile" ? x.amount : x.amount / 12),
    0
  );
  const yearly = monthly * 12;
  const opportunity = futureValueMonthly(monthly, 0.06, 10);

  return (
    <div>
      <PageHeader
        title="Abbonamenti"
        subtitle="Le uscite si registrano da sole alla data di addebito"
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus className="size-4" /> Nuovo abbonamento
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi label="Costo mensile" value={fmtEUR(monthly)} />
        <Kpi label="Costo annuo" value={fmtEUR0(yearly)} />
        <Kpi
          label="Costo opportunità"
          value={fmtEUR0(opportunity)}
          sub="in 10 anni, investito al 6%"
          tone="neg"
          info="Valore futuro dei versamenti mensili pari al costo degli abbonamenti, investiti al 6% annuo per 10 anni."
        />
      </div>

      {candidates.length > 0 && (
        <Card
          title={
            <span className="flex items-center gap-1.5">
              <Sparkles className="size-4 text-brand-ink" aria-hidden />
              Possibili abbonamenti rilevati
            </span>
          }
          subtitle="Addebiti che si ripetono ogni mese con lo stesso importo: sembrano abbonamenti"
          className="mb-6"
        >
          <ul className="flex flex-col gap-2">
            {candidates.map((c) => (
              <li key={c.description} className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-ink">{c.description}</span>
                  <span className="ml-2 text-xs text-faint">
                    ~{fmtEUR(c.amount)}/mese, in {c.months} mesi, verso il giorno {c.day}
                  </span>
                </div>
                <Button variant="outline" onClick={() => addAsSubscription(c)}>
                  È un abbonamento
                </Button>
                <Button variant="ghost" onClick={() => dismiss(c)}>
                  Ignora
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {data.subscriptions.length === 0 ? (
        <EmptyState
          icon={<Repeat />}
          title="Nessun abbonamento"
          text="Streaming, palestra, cloud: mettili qui e scopri quanto costano davvero in 10 anni."
          action={<Button onClick={() => setEditing("new")}>Aggiungi un abbonamento</Button>}
        />
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {[...data.subscriptions]
              .sort(
                (a, b) =>
                  (b.cadence === "mensile" ? b.amount : b.amount / 12) -
                  (a.cadence === "mensile" ? a.amount : a.amount / 12)
              )
              .map((s) => {
                const norm = s.cadence === "mensile" ? s.amount : s.amount / 12;
                return (
                  <li key={s.id} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-ink">{s.name}</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-faint">
                        <Badge tone="neutral">{s.cadence}</Badge>
                        <span>addebito il giorno {s.chargeDay}</span>
                        {!s.active && <Badge tone="warn">in pausa</Badge>}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="tnum font-semibold">{fmtEUR(s.amount)}</div>
                      <div className="tnum text-xs text-faint">≈ {fmtEUR(norm)}/mese</div>
                    </div>
                    <div className="flex shrink-0">
                      <IconButton label={`Modifica ${s.name}`} onClick={() => setEditing(s)}>
                        <Pencil className="size-4" />
                      </IconButton>
                      <IconButton
                        label={`Elimina ${s.name}`}
                        onClick={() => undoableDelete("subscriptions", s, `Abbonamento "${s.name}"`)}
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

      <SubscriptionModal
        key={editing === "new" ? "new" : editing?.id ?? "closed"}
        editing={editing}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

function SubscriptionModal({
  editing,
  onClose,
}: {
  editing: Subscription | "new" | null;
  onClose: () => void;
}) {
  const { showToast } = useToast();
  const isNew = editing === "new";
  const base = isNew ? null : editing;
  const [name, setName] = useState(base?.name ?? "");
  const [amount, setAmount] = useState(base ? String(base.amount).replace(".", ",") : "");
  const [cadence, setCadence] = useState<Cadence>(base?.cadence ?? "mensile");
  const [chargeDay, setChargeDay] = useState(String(base?.chargeDay ?? 1));
  const [active, setActive] = useState(base?.active ?? true);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseItAmount(amount);
    if (!name.trim() || parsed == null || parsed <= 0) {
      showToast("Controlla nome e importo", { kind: "error" });
      return;
    }
    const sub: Subscription = {
      id: base?.id ?? uid(),
      name: name.trim(),
      amount: parsed,
      cadence,
      active,
      chargeDay: Math.min(28, Math.max(1, Number(chargeDay) || 1)),
      startDate: base?.startDate ?? todayISO(),
    };
    await storage.put("subscriptions", sub);
    showToast(isNew ? "Abbonamento aggiunto" : "Abbonamento aggiornato", { kind: "success" });
    onClose();
  }

  return (
    <Modal
      open={editing !== null}
      onClose={onClose}
      title={isNew ? "Nuovo abbonamento" : "Modifica abbonamento"}
    >
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Nome">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="es. Netflix"
            autoFocus
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Importo (€)">
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="es. 12,99"
            />
          </Field>
          <Field label="Cadenza">
            <Select value={cadence} onChange={(e) => setCadence(e.target.value as Cadence)}>
              <option value="mensile">mensile</option>
              <option value="annuale">annuale</option>
            </Select>
          </Field>
        </div>
        <Field label="Giorno di addebito (1–28)">
          <Input
            type="number"
            min={1}
            max={28}
            value={chargeDay}
            onChange={(e) => setChargeDay(e.target.value)}
          />
        </Field>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="size-4 accent-brand"
          />
          Attivo (genera automaticamente l&apos;uscita)
        </label>
        <ModalFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Annulla
          </Button>
          <Button type="submit">Salva abbonamento</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
