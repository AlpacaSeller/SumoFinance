"use client";

// ── Calendario finanziario: prossimi 90 giorni ─────────────────────────────

import { useMemo, useState } from "react";
import { CalendarDays, Pencil, Plus, Trash2 } from "lucide-react";
import { useFinancial } from "@/lib/useFinancial";
import { storage } from "@/lib/storage";
import { uid, type CalendarItem, type CalendarRecurrence } from "@/lib/types";
import { upcomingItems } from "@/lib/engine/calendar";
import { fmtDateLong, fmtEUR, parseItAmount, todayISO } from "@/lib/format";
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

export default function CalendarioPage() {
  const { ready, data } = useFinancial();
  const [editing, setEditing] = useState<CalendarItem | "new" | null>(null);
  const undoableDelete = useUndoableDelete();

  const items = useMemo(
    () => upcomingItems(data.calendarItems, data.debts, data.recurring, 90),
    [data.calendarItems, data.debts, data.recurring]
  );

  const byDate = useMemo(() => {
    const m = new Map<string, typeof items>();
    for (const item of items) {
      const arr = m.get(item.date) ?? [];
      arr.push(item);
      m.set(item.date, arr);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);

  if (!ready) return <LoadingState />;

  const totalIn = items.filter((i) => i.amount > 0).reduce((s, i) => s + i.amount, 0);
  const totalOut = items.filter((i) => i.amount < 0).reduce((s, i) => s + i.amount, 0);

  return (
    <div>
      <PageHeader
        title="Calendario finanziario"
        subtitle="Prossimi 90 giorni: scadenze manuali + voci automatiche (rate, cedole, dividendi)"
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus className="size-4" /> Nuova scadenza
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3">
        <Kpi label="In arrivo (90g)" value={fmtEUR(totalIn)} tone="pos" />
        <Kpi label="In uscita (90g)" value={fmtEUR(Math.abs(totalOut))} tone="neg" />
      </div>

      {byDate.length === 0 ? (
        <EmptyState
          icon={<CalendarDays />}
          title="Nessuna scadenza nei prossimi 90 giorni"
          text="Aggiungi bolli, assicurazioni, tasse. Le rate dei debiti e le entrate ricorrenti passive compaiono qui da sole."
          action={<Button onClick={() => setEditing("new")}>Aggiungi una scadenza</Button>}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {byDate.map(([date, dayItems]) => (
            <Card key={date}>
              <div className="mb-2 flex items-center gap-2">
                <span className="text-sm font-semibold capitalize">{fmtDateLong(date)}</span>
                {date === todayISO() && <Badge tone="brand">oggi</Badge>}
              </div>
              <ul className="divide-y divide-line">
                {dayItems.map((item) => {
                  const manual = item.origin === "manuale" && item.sourceId
                    ? data.calendarItems.find((c) => c.id === item.sourceId)
                    : undefined;
                  return (
                    <li key={item.id} className="flex items-center gap-3 py-2">
                      <div className="min-w-0 flex-1">
                        <span className="text-sm font-medium">{item.title}</span>
                        <span className="ml-2 inline-flex gap-1.5">
                          {item.recurrence !== "una tantum" && (
                            <Badge tone="neutral">{item.recurrence}</Badge>
                          )}
                          {item.origin === "auto" && <Badge tone="accent">auto</Badge>}
                        </span>
                      </div>
                      <span
                        className={`tnum shrink-0 font-semibold ${
                          item.amount >= 0 ? "text-pos" : "text-neg"
                        }`}
                      >
                        {item.amount >= 0 ? "+" : "−"}
                        {fmtEUR(Math.abs(item.amount))}
                      </span>
                      {manual && (
                        <div className="flex shrink-0">
                          <IconButton
                            label={`Modifica ${item.title}`}
                            onClick={() => setEditing(manual)}
                          >
                            <Pencil className="size-4" />
                          </IconButton>
                          <IconButton
                            label={`Elimina ${item.title}`}
                            onClick={() =>
                              undoableDelete("calendarItems", manual, `Scadenza "${manual.title}"`)
                            }
                          >
                            <Trash2 className="size-4" />
                          </IconButton>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
      )}

      <CalendarModal
        key={editing === "new" ? "new" : editing?.id ?? "closed"}
        editing={editing}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

function CalendarModal({
  editing,
  onClose,
}: {
  editing: CalendarItem | "new" | null;
  onClose: () => void;
}) {
  const { showToast } = useToast();
  const isNew = editing === "new";
  const base = isNew ? null : editing;
  const [title, setTitle] = useState(base?.title ?? "");
  const [amount, setAmount] = useState(base ? String(base.amount).replace(".", ",") : "");
  const [direction, setDirection] = useState<"uscita" | "entrata">(
    base && base.amount > 0 ? "entrata" : "uscita"
  );
  const [date, setDate] = useState(base?.date ?? todayISO());
  const [recurrence, setRecurrence] = useState<CalendarRecurrence>(
    base?.recurrence ?? "una tantum"
  );

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseItAmount(amount);
    if (!title.trim() || parsed == null || parsed === 0 || !date) {
      showToast("Controlla titolo, importo e data", { kind: "error" });
      return;
    }
    const item: CalendarItem = {
      id: base?.id ?? uid(),
      title: title.trim(),
      amount: direction === "entrata" ? Math.abs(parsed) : -Math.abs(parsed),
      date,
      recurrence,
      origin: "manuale",
    };
    await storage.put("calendarItems", item);
    showToast(isNew ? "Scadenza aggiunta" : "Scadenza aggiornata", { kind: "success" });
    onClose();
  }

  return (
    <Modal
      open={editing !== null}
      onClose={onClose}
      title={isNew ? "Nuova scadenza" : "Modifica scadenza"}
    >
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Titolo">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="es. Bollo auto"
            autoFocus
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Importo (€)">
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="es. 210"
            />
          </Field>
          <Field label="Direzione">
            <Select
              value={direction}
              onChange={(e) => setDirection(e.target.value as "uscita" | "entrata")}
            >
              <option value="uscita">Uscita (rosso)</option>
              <option value="entrata">Entrata (verde)</option>
            </Select>
          </Field>
          <Field label="Data">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Ricorrenza">
            <Select
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value as CalendarRecurrence)}
            >
              <option value="una tantum">una tantum</option>
              <option value="mensile">mensile</option>
              <option value="annuale">annuale</option>
            </Select>
          </Field>
        </div>
        <ModalFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Annulla
          </Button>
          <Button type="submit">Salva scadenza</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
