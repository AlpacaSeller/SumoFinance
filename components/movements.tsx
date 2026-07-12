"use client";

// ── Componenti condivisi per Entrate e Uscite ───────────────────────────────

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Pencil, Repeat, Trash2 } from "lucide-react";
import { storage, useTable } from "@/lib/storage";
import { applyRules, fingerprint } from "@/lib/csv";
import { detectRecurringCandidates } from "@/lib/engine/recurring";
import {
  uid,
  type Expense,
  type ImportRule,
  type Income,
  type RecurringTransaction,
  type Settings,
} from "@/lib/types";
import {
  fmtDate,
  fmtEUR,
  monthLabel,
  parseItAmount,
  shiftedMonthKey,
  todayISO,
} from "@/lib/format";
import { useToast, useUndoableDelete } from "@/components/toast";
import {
  Badge,
  Button,
  Field,
  IconButton,
  Input,
  Modal,
  ModalFooter,
  Select,
} from "@/components/ui";

export type Movement = Income | Expense;
export type MovementKind = "entrata" | "uscita";

// ── Ricerca ed export ───────────────────────────────────────────────────────

/** Filtra su descrizione e categoria, tutti i mesi, più recenti prima. */
export function searchMovements(movements: Movement[], query: string, cap = 100): Movement[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return movements
    .filter(
      (m) => m.description.toLowerCase().includes(q) || m.category.toLowerCase().includes(q)
    )
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, cap);
}

/** CSV it-IT (BOM + ";") di tutti i movimenti, per Excel. */
export function buildMovementsCsv(movements: Movement[], kind: MovementKind): string {
  const esc = (s: string) => (/[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const rows = ["Data;Descrizione;Categoria;Importo (€);Tipo;Origine"];
  for (const m of [...movements].sort((a, b) => a.date.localeCompare(b.date))) {
    rows.push(
      [
        m.date.split("-").reverse().join("/"),
        esc(m.description),
        esc(m.category),
        m.amount.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        kind,
        m.source ?? "manuale",
      ].join(";")
    );
  }
  return "﻿" + rows.join("\r\n");
}

export function downloadTextFile(filename: string, content: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Navigazione mese ‹ › ────────────────────────────────────────────────────

export function useMonthNav() {
  const [offset, setOffset] = useState(0); // 0 = mese corrente, -1 = precedente…
  const key = shiftedMonthKey(offset);
  return { offset, setOffset, key, label: monthLabel(key) };
}

export function MonthNav({
  label,
  offset,
  setOffset,
}: {
  label: string;
  offset: number;
  setOffset: (fn: (o: number) => number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <IconButton label="Mese precedente" onClick={() => setOffset((o) => o - 1)}>
        <ChevronLeft className="size-4" />
      </IconButton>
      <span className="min-w-36 text-center text-sm font-semibold capitalize">{label}</span>
      <IconButton
        label="Mese successivo"
        onClick={() => setOffset((o) => Math.min(0, o + 1))}
        disabled={offset >= 0}
        className={offset >= 0 ? "opacity-30" : ""}
      >
        <ChevronRight className="size-4" />
      </IconButton>
    </div>
  );
}

// ── Lista movimenti del mese ────────────────────────────────────────────────

export function MovementRows({
  movements,
  kind,
  onEdit,
}: {
  movements: Movement[];
  kind: MovementKind;
  onEdit: (m: Movement) => void;
}) {
  const undoableDelete = useUndoableDelete();
  const table = kind === "entrata" ? "incomes" : "expenses";
  const sorted = [...movements].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <ul className="divide-y divide-line">
      {sorted.map((m) => (
        <li key={m.id} className="flex items-center gap-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-ink">{m.description}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-faint">
              <span>{fmtDate(m.date)}</span>
              <Badge tone="neutral">{m.category}</Badge>
              {m.source === "ricorrente" && (
                <Badge tone="accent">
                  <Repeat className="size-3" /> ricorrente
                </Badge>
              )}
              {m.source === "auto" && <Badge tone="accent">auto</Badge>}
              {m.source === "import" && <Badge tone="neutral">import</Badge>}
            </div>
          </div>
          <span
            className={`tnum shrink-0 font-semibold ${
              kind === "entrata" ? "text-pos" : "text-neg"
            }`}
          >
            {kind === "entrata" ? "+" : "−"}
            {fmtEUR(m.amount)}
          </span>
          <div className="flex shrink-0">
            <IconButton label={`Modifica ${m.description}`} onClick={() => onEdit(m)}>
              <Pencil className="size-4" />
            </IconButton>
            <IconButton
              label={`Elimina ${m.description}`}
              onClick={() => undoableDelete(table, m, `Movimento "${m.description}"`)}
            >
              <Trash2 className="size-4" />
            </IconButton>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Modale movimento (entrata o uscita) ─────────────────────────────────────

export function MovementModal({
  kind,
  editing,
  categories,
  settings,
  onClose,
  existingFingerprints,
}: {
  kind: MovementKind;
  editing: Movement | "new" | null;
  categories: string[];
  settings: Settings;
  onClose: () => void;
  existingFingerprints?: Set<string>;
}) {
  const { showToast } = useToast();
  const isNew = editing === "new";
  const base = isNew ? null : editing;
  const [description, setDescription] = useState(base?.description ?? "");
  const [category, setCategory] = useState(base?.category ?? categories[0] ?? "Altro");
  const [categoryTouched, setCategoryTouched] = useState(!isNew);
  const [autoApplied, setAutoApplied] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [amount, setAmount] = useState(base ? String(base.amount).replace(".", ",") : "");
  const [date, setDate] = useState(base?.date ?? todayISO());
  const [dupConfirm, setDupConfirm] = useState(false);
  const table = kind === "entrata" ? "incomes" : "expenses";
  const rules = useTable<ImportRule>("importRules");

  const allCategories = useMemo(
    () => (categories.includes(category) ? categories : [...categories, category]),
    [categories, category]
  );

  // Suggerisce la categoria dalle regole di categorizzazione, se l'utente non
  // ne ha scelta una a mano (le stesse regole usate nell'import CSV).
  function onDescriptionChange(value: string) {
    setDescription(value);
    if (categoryTouched || !rules) return;
    const suggested = applyRules(value, kind === "entrata", rules);
    if (suggested) {
      setCategory(suggested);
      setAutoApplied(true);
    } else if (autoApplied) {
      setAutoApplied(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseItAmount(amount);
    let cat = category;
    if (category === "__new__") {
      cat = newCategory.trim();
      if (!cat) {
        showToast("Dai un nome alla nuova categoria", { kind: "error" });
        return;
      }
      // salva la categoria personalizzata nelle impostazioni
      const field = kind === "entrata" ? "customIncomeCategories" : "customExpenseCategories";
      const existing = settings[field] || [];
      if (!existing.includes(cat) && !categories.includes(cat)) {
        await storage.put("settings", { ...settings, [field]: [...existing, cat] });
      }
    }
    if (!description.trim() || parsed == null || parsed <= 0 || !date) {
      showToast("Controlla descrizione, importo (positivo) e data", { kind: "error" });
      return;
    }
    // avviso duplicati (solo nuovi): stessa data + importo + descrizione
    const signed = kind === "entrata" ? parsed : -parsed;
    const fp = fingerprint(date, signed, description.trim());
    if (isNew && existingFingerprints?.has(fp) && !dupConfirm) {
      setDupConfirm(true);
      showToast(
        "Sembra un movimento già presente (stessa data, importo e descrizione). Tocca di nuovo Salva per aggiungerlo comunque.",
        { kind: "error", duration: 7000 }
      );
      return;
    }
    const movement: Movement = {
      id: base?.id ?? uid(),
      description: description.trim(),
      category: cat,
      amount: parsed,
      date,
      source: base?.source ?? "manuale",
      sourceRef: base?.sourceRef,
      fingerprint: base?.fingerprint ?? fp,
    };
    await storage.put(table, movement);
    showToast(isNew ? `${kind === "entrata" ? "Entrata" : "Uscita"} aggiunta` : "Movimento aggiornato", {
      kind: "success",
    });
    onClose();
  }

  return (
    <Modal
      open={editing !== null}
      onClose={onClose}
      title={isNew ? (kind === "entrata" ? "Nuova entrata" : "Nuova uscita") : "Modifica movimento"}
    >
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Descrizione">
          <Input
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder={kind === "entrata" ? "es. Stipendio giugno" : "es. Spesa Esselunga"}
            autoFocus
          />
        </Field>
        <Field
          label="Categoria"
          hint={autoApplied ? "Categoria suggerita da una tua regola" : undefined}
        >
          <Select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setCategoryTouched(true);
              setAutoApplied(false);
            }}
          >
            {allCategories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value="__new__">+ Nuova categoria…</option>
          </Select>
        </Field>
        {category === "__new__" && (
          <Field label="Nome nuova categoria">
            <Input
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="es. Animali"
            />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Importo (€)">
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="es. 45,90"
            />
          </Field>
          <Field label="Data">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <ModalFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Annulla
          </Button>
          <Button type="submit">
            {kind === "entrata" ? "Salva entrata" : "Salva uscita"}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

// ── Movimenti ricorrenti ────────────────────────────────────────────────────

export function RecurringSection({
  kind,
  recurring,
  categories,
  movements = [],
}: {
  kind: MovementKind;
  recurring: RecurringTransaction[];
  categories: string[];
  movements?: Movement[];
}) {
  const { showToast } = useToast();
  const [editing, setEditing] = useState<RecurringTransaction | "new" | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const undoableDelete = useUndoableDelete();
  const mine = recurring.filter((r) => r.type === kind);

  const candidates = useMemo(
    () =>
      detectRecurringCandidates(movements, kind, recurring)
        .filter((c) => !dismissed.has(c.description.toLowerCase()))
        .slice(0, 2),
    [movements, kind, recurring, dismissed]
  );

  async function createFromCandidate(c: (typeof candidates)[number]) {
    const item: RecurringTransaction = {
      id: uid(),
      description: c.description,
      category: c.category,
      amount: c.amount,
      type: kind,
      cadence: "mensile",
      day: c.day,
      active: true,
      startDate: todayISO(),
    };
    await storage.put("recurringTransactions", item);
    showToast(`"${c.description}" ora è ricorrente: si registrerà da sola ogni mese`, {
      kind: "success",
      duration: 6000,
    });
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Repeat className="size-4 text-accent" />
          {kind === "entrata" ? "Entrate ricorrenti" : "Uscite ricorrenti"}
        </h2>
        <Button variant="ghost" onClick={() => setEditing("new")}>
          + Aggiungi
        </Button>
      </div>

      {candidates.length > 0 && (
        <div className="mb-3 flex flex-col gap-2">
          {candidates.map((c) => (
            <div
              key={c.description}
              className="flex flex-wrap items-center gap-2 rounded-xl bg-accent-soft px-3 py-2 text-xs text-accent"
            >
              <span className="flex-1">
                <strong>{c.description}</strong> compare in {c.months} mesi (~{fmtEUR(c.amount)}):
                vuoi renderla ricorrente?
              </span>
              <button
                className="rounded-lg bg-accent px-2 py-1 font-semibold text-white"
                onClick={() => createFromCandidate(c)}
              >
                Rendi ricorrente
              </button>
              <button
                className="rounded-lg px-2 py-1 font-medium hover:underline"
                onClick={() =>
                  setDismissed((s) => new Set(s).add(c.description.toLowerCase()))
                }
              >
                Ignora
              </button>
            </div>
          ))}
        </div>
      )}
      {mine.length === 0 ? (
        <p className="rounded-xl bg-surface-2 px-4 py-3 text-xs text-faint">
          {kind === "entrata"
            ? "Es. lo stipendio: si registra da solo ogni mese alla data che scegli, senza duplicati."
            : "Es. l'affitto: si registra da solo ogni mese alla data che scegli, senza duplicati."}
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {mine.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{r.description}</div>
                <div className="text-xs text-faint">
                  {r.category} · {r.cadence} · giorno {r.day}
                  {!r.active && " · in pausa"}
                </div>
              </div>
              <span className={`tnum text-sm font-semibold ${kind === "entrata" ? "text-pos" : "text-neg"}`}>
                {fmtEUR(r.amount)}
              </span>
              <div className="flex shrink-0">
                <IconButton label={`Modifica ${r.description}`} onClick={() => setEditing(r)}>
                  <Pencil className="size-4" />
                </IconButton>
                <IconButton
                  label={`Elimina ${r.description}`}
                  onClick={() =>
                    undoableDelete(
                      "recurringTransactions",
                      r,
                      `Movimento ricorrente "${r.description}"`
                    )
                  }
                >
                  <Trash2 className="size-4" />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      )}
      <RecurringModal
        key={editing === "new" ? "new" : editing?.id ?? "closed"}
        kind={kind}
        editing={editing}
        categories={categories}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

function RecurringModal({
  kind,
  editing,
  categories,
  onClose,
}: {
  kind: MovementKind;
  editing: RecurringTransaction | "new" | null;
  categories: string[];
  onClose: () => void;
}) {
  const { showToast } = useToast();
  const isNew = editing === "new";
  const base = isNew ? null : editing;
  const [description, setDescription] = useState(base?.description ?? "");
  const [category, setCategory] = useState(base?.category ?? categories[0] ?? "Altro");
  const [amount, setAmount] = useState(base ? String(base.amount).replace(".", ",") : "");
  const [cadence, setCadence] = useState<"mensile" | "annuale">(base?.cadence ?? "mensile");
  const [day, setDay] = useState(String(base?.day ?? 1));
  const [active, setActive] = useState(base?.active ?? true);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseItAmount(amount);
    if (!description.trim() || parsed == null || parsed <= 0) {
      showToast("Controlla descrizione e importo", { kind: "error" });
      return;
    }
    const item: RecurringTransaction = {
      id: base?.id ?? uid(),
      description: description.trim(),
      category,
      amount: parsed,
      type: kind,
      cadence,
      day: Math.min(28, Math.max(1, Number(day) || 1)),
      active,
      startDate: base?.startDate ?? todayISO(),
      lastRegisteredPeriod: base?.lastRegisteredPeriod,
    };
    await storage.put("recurringTransactions", item);
    showToast(
      isNew
        ? "Movimento ricorrente creato: verrà registrato automaticamente alla data prevista"
        : "Movimento ricorrente aggiornato",
      { kind: "success", duration: 6000 }
    );
    onClose();
  }

  return (
    <Modal
      open={editing !== null}
      onClose={onClose}
      title={
        isNew
          ? kind === "entrata"
            ? "Nuova entrata ricorrente"
            : "Nuova uscita ricorrente"
          : "Modifica ricorrente"
      }
    >
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Descrizione">
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={kind === "entrata" ? "es. Stipendio" : "es. Affitto"}
            autoFocus
          />
        </Field>
        <Field label="Categoria">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Importo (€)">
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="es. 1.850,00"
            />
          </Field>
          <Field label="Cadenza">
            <Select
              value={cadence}
              onChange={(e) => setCadence(e.target.value as "mensile" | "annuale")}
            >
              <option value="mensile">mensile</option>
              <option value="annuale">annuale</option>
            </Select>
          </Field>
        </div>
        <Field label="Giorno di registrazione (1–28)">
          <Input type="number" min={1} max={28} value={day} onChange={(e) => setDay(e.target.value)} />
        </Field>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="size-4 accent-brand"
          />
          Attivo (registra automaticamente)
        </label>
        <ModalFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Annulla
          </Button>
          <Button type="submit">Salva ricorrente</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
