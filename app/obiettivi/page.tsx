"use client";

// ── Obiettivi ───────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import { Link2, Pencil, PiggyBank, Plus, Target, Trash2 } from "lucide-react";
import { useFinancial } from "@/lib/useFinancial";
import { storage } from "@/lib/storage";
import { uid, type Goal } from "@/lib/types";
import { goalMonthlyNeeded, goalProbability } from "@/lib/engine/montecarlo";
import { goalEffectiveSaved } from "@/lib/engine/aggregates";
import {
  addMonths,
  fmtDate,
  fmtEUR,
  fmtEUR0,
  fmtPct,
  monthsUntil,
  parseItAmount,
  todayISO,
} from "@/lib/format";
import { useToast, useUndoableDelete } from "@/components/toast";
import { SumoMascot } from "@/components/Mascot";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  IconButton,
  Input,
  LoadingState,
  Modal,
  ModalFooter,
  PageHeader,
  ProgressBar,
  Select,
} from "@/components/ui";

export default function ObiettiviPage() {
  const { ready, data, derived } = useFinancial();
  const [editing, setEditing] = useState<Goal | "new" | null>(null);
  const [contributeTo, setContributeTo] = useState<Goal | null>(null);
  const undoableDelete = useUndoableDelete();

  // Calcoli per obiettivo (incluso il Monte Carlo) memoizzati: non si rifanno
  // a ogni re-render, solo quando cambiano gli obiettivi o i parametri di portafoglio.
  const goalRows = useMemo(
    () =>
      data.goals.map((g) => {
        // se collegato a un conto, il versato È il saldo del conto
        const saved = goalEffectiveSaved(g, data.accounts);
        const linkedAccount = g.linkedAccountId
          ? data.accounts.find((a) => a.id === g.linkedAccountId)
          : undefined;
        const monthsLeft = monthsUntil(g.deadline);
        const pct = g.target > 0 ? Math.min(100, (saved / g.target) * 100) : 0;
        const needed = goalMonthlyNeeded(saved, g.target, monthsLeft);
        const prob = goalProbability(
          saved,
          g.target,
          g.plannedMonthly,
          monthsLeft,
          derived.portfolio.mu,
          derived.portfolio.sigma
        );
        const extra = Math.max(0, needed - g.plannedMonthly);
        const atRisk = prob < 50 && saved < g.target;
        return { g, saved, linkedAccount, monthsLeft, pct, needed, prob, extra, atRisk };
      }),
    [data.goals, data.accounts, derived.portfolio.mu, derived.portfolio.sigma]
  );

  if (!ready) return <LoadingState />;

  return (
    <div>
      <PageHeader
        title="Obiettivi"
        subtitle="La probabilità è stimata con il Monte Carlo sul singolo obiettivo, al ritmo attuale"
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus className="size-4" /> Nuovo obiettivo
          </Button>
        }
      />

      {data.goals.length === 0 ? (
        <EmptyState
          icon={<Target />}
          title="Nessun obiettivo"
          text="Fondo emergenza, viaggio, anticipo casa: dai un nome ai tuoi soldi e Sumo Finance ti dice se il ritmo basta."
          action={<Button onClick={() => setEditing("new")}>Crea il primo obiettivo</Button>}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {goalRows.map(({ g, saved, linkedAccount, monthsLeft, pct, needed, prob, extra, atRisk }) => {
            return (
              <Card key={g.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-3">
                    {pct >= 100 && <SumoMascot pose="celebrate" size={64} />}
                    <div>
                      <h3 className="font-display text-lg font-semibold">{g.name}</h3>
                      <p className="mt-0.5 text-xs text-faint">
                        {pct >= 100 ? (
                          <span className="font-semibold text-pos">obiettivo raggiunto! 🎉</span>
                        ) : (
                          <>
                            scadenza {fmtDate(g.deadline)} ·{" "}
                            {monthsLeft > 0 ? `${monthsLeft} mesi rimanenti` : "scaduto"}
                          </>
                        )}
                      </p>
                      {linkedAccount && (
                        <Badge tone="accent" className="mt-1">
                          <Link2 className="size-3" /> segue il saldo di «{linkedAccount.name}»
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center">
                    {saved < g.target && !linkedAccount && (
                      <Button variant="ghost" onClick={() => setContributeTo(g)}>
                        <PiggyBank className="size-4" /> Versa
                      </Button>
                    )}
                    <IconButton label={`Modifica ${g.name}`} onClick={() => setEditing(g)}>
                      <Pencil className="size-4" />
                    </IconButton>
                    <IconButton
                      label={`Elimina ${g.name}`}
                      onClick={() => undoableDelete("goals", g, `Obiettivo "${g.name}"`)}
                    >
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="tnum">
                      {fmtEUR(saved)} <span className="text-faint">di {fmtEUR0(g.target)}</span>
                    </span>
                    <span className="tnum font-semibold">{fmtPct(pct, 0)}</span>
                  </div>
                  <ProgressBar value={pct} tone={pct >= 100 ? "pos" : atRisk ? "warn" : "brand"} />
                </div>

                <dl className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-xl bg-surface-2 p-2">
                    <dt className="text-faint">Serve al mese</dt>
                    <dd className="tnum mt-0.5 text-sm font-semibold">{fmtEUR0(needed)}</dd>
                  </div>
                  <div className="rounded-xl bg-surface-2 p-2">
                    <dt className="text-faint">Pianificato</dt>
                    <dd className="tnum mt-0.5 text-sm font-semibold">{fmtEUR0(g.plannedMonthly)}</dd>
                  </div>
                  <div className="rounded-xl bg-surface-2 p-2">
                    <dt className="text-faint">Probabilità</dt>
                    <dd
                      className={`tnum mt-0.5 text-sm font-semibold ${
                        prob >= 75 ? "text-pos" : prob >= 50 ? "text-warn" : "text-neg"
                      }`}
                    >
                      {fmtPct(prob, 0)}
                    </dd>
                  </div>
                </dl>

                {saved >= g.target ? (
                  <Badge tone="pos" className="mt-3">
                    Obiettivo raggiunto 🎉
                  </Badge>
                ) : atRisk ? (
                  <p className="mt-3 rounded-xl bg-warn-soft px-3 py-2 text-xs text-warn">
                    Al ritmo attuale probabilmente non basta:{" "}
                    {extra > 0 ? (
                      <>
                        aumenta il versamento di{" "}
                        <strong className="tnum">{fmtEUR0(extra)}/mese</strong> oppure sposta la
                        scadenza a{" "}
                        <strong>
                          {fmtDate(
                            addMonths(
                              todayISO(),
                              g.plannedMonthly > 0
                                ? Math.ceil((g.target - saved) / g.plannedMonthly)
                                : monthsLeft + 12
                            )
                          )}
                        </strong>
                        .
                      </>
                    ) : (
                      <>rivedi importo target o scadenza.</>
                    )}
                  </p>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}

      <GoalModal
        key={editing === "new" ? "new" : editing?.id ?? "closed"}
        editing={editing}
        onClose={() => setEditing(null)}
      />
      {contributeTo && (
        <ContributeModal goal={contributeTo} onClose={() => setContributeTo(null)} />
      )}
    </div>
  );
}

function ContributeModal({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const { showToast } = useToast();
  const [amount, setAmount] = useState("");
  const remaining = Math.max(0, goal.target - goal.saved);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseItAmount(amount);
    if (parsed == null || parsed <= 0) {
      showToast("Inserisci un importo positivo", { kind: "error" });
      return;
    }
    const saved = Math.min(goal.target, goal.saved + parsed);
    await storage.put("goals", { ...goal, saved });
    showToast(
      saved >= goal.target
        ? `Obiettivo "${goal.name}" raggiunto! 🎉`
        : `Versati ${fmtEUR0(parsed)} su "${goal.name}"`,
      { kind: "success" }
    );
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={`Versa su "${goal.name}"`}>
      <form onSubmit={save} className="flex flex-col gap-4">
        <p className="text-sm text-soft">
          Aggiorna quanto hai messo da parte per questo obiettivo. Attuale:{" "}
          <span className="tnum font-semibold">{fmtEUR(goal.saved)}</span> · manca{" "}
          <span className="tnum font-semibold">{fmtEUR0(remaining)}</span>.
        </p>
        <Field label="Importo da versare (€)">
          <Input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="es. 200"
            autoFocus
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          {[100, 250, 500].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setAmount(String(v))}
              className="rounded-lg border border-line-strong px-3 py-1 text-sm hover:bg-surface-2"
            >
              {fmtEUR0(v)}
            </button>
          ))}
          {remaining > 0 && (
            <button
              type="button"
              onClick={() => setAmount(String(remaining).replace(".", ","))}
              className="rounded-lg border border-line-strong px-3 py-1 text-sm hover:bg-surface-2"
            >
              Completa ({fmtEUR0(remaining)})
            </button>
          )}
        </div>
        <ModalFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Annulla
          </Button>
          <Button type="submit">Versa</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

function GoalModal({
  editing,
  onClose,
}: {
  editing: Goal | "new" | null;
  onClose: () => void;
}) {
  const { data } = useFinancial();
  const { showToast } = useToast();
  const isNew = editing === "new";
  const base = isNew ? null : editing;
  const [name, setName] = useState(base?.name ?? "");
  const [target, setTarget] = useState(base ? String(base.target).replace(".", ",") : "");
  const [saved, setSaved] = useState(base ? String(base.saved).replace(".", ",") : "0");
  const [deadline, setDeadline] = useState(base?.deadline ?? addMonths(todayISO(), 12));
  const [planned, setPlanned] = useState(
    base ? String(base.plannedMonthly).replace(".", ",") : ""
  );
  const [linkedAccountId, setLinkedAccountId] = useState(base?.linkedAccountId ?? "");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const t = parseItAmount(target);
    const s = parseItAmount(saved) ?? 0;
    const p = parseItAmount(planned) ?? 0;
    if (!name.trim() || t == null || t <= 0 || !deadline) {
      showToast("Controlla nome, importo target e scadenza", { kind: "error" });
      return;
    }
    const goal: Goal = {
      id: base?.id ?? uid(),
      name: name.trim(),
      target: t,
      saved: s,
      deadline,
      plannedMonthly: p,
      linkedAccountId: linkedAccountId || undefined,
    };
    await storage.put("goals", goal);
    showToast(isNew ? "Obiettivo creato" : "Obiettivo aggiornato", { kind: "success" });
    onClose();
  }

  return (
    <Modal
      open={editing !== null}
      onClose={onClose}
      title={isNew ? "Nuovo obiettivo" : "Modifica obiettivo"}
    >
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Nome">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="es. Anticipo casa"
            autoFocus
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Importo target (€)">
            <Input
              inputMode="decimal"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="es. 30.000"
            />
          </Field>
          <Field label="Già versato (€)">
            <Input
              inputMode="decimal"
              value={saved}
              onChange={(e) => setSaved(e.target.value)}
            />
          </Field>
          <Field label="Scadenza">
            <Input
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </Field>
          <Field label="Versamento mensile pianificato (€)">
            <Input
              inputMode="decimal"
              value={planned}
              onChange={(e) => setPlanned(e.target.value)}
              placeholder="es. 300"
            />
          </Field>
        </div>
        {data.accounts.length > 0 && (
          <Field
            label="Collega a un conto (facoltativo)"
            hint="Il versato seguirà da solo il saldo del conto: perfetto per un conto deposito dedicato"
          >
            <Select
              value={linkedAccountId}
              onChange={(e) => setLinkedAccountId(e.target.value)}
            >
              <option value="">Nessuno (versato manuale)</option>
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <ModalFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Annulla
          </Button>
          <Button type="submit">Salva obiettivo</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
