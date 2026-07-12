"use client";

// ── Operazioni su un asset ──────────────────────────────────────────────────
// Acquisti/vendite ricalcolano quantità e PMC (le vendite alimentano il fisco);
// i dividendi entrano nell'XIRR e nelle entrate; gli split ricalcolano la
// posizione lasciando invariato il capitale investito.

import { useMemo, useState } from "react";
import { Coins, Minus, Plus, Scissors, Trash2 } from "lucide-react";
import { storage } from "@/lib/storage";
import { uid, type Asset, type AssetTransaction, type Income } from "@/lib/types";
import { applyTransactions, sortTransactions } from "@/lib/engine/transactions";
import { recomputeAssetPosition } from "@/lib/positionSync";
import { fmtDate, fmtEUR, fmtEURSigned, fmtNum, parseItAmount, todayISO } from "@/lib/format";
import { useToast } from "./toast";
import {
  Badge,
  Button,
  Card,
  Field,
  IconButton,
  Input,
  Modal,
  ModalFooter,
} from "./ui";

export function AssetTransactionsCard({
  asset,
  transactions,
}: {
  asset: Asset;
  transactions: AssetTransaction[];
}) {
  const { showToast } = useToast();
  const [modal, setModal] = useState<"acquisto" | "vendita" | "dividendo" | "frazionamento" | null>(
    null
  );

  const mine = useMemo(
    () => sortTransactions(transactions.filter((t) => t.assetId === asset.id)).reverse(),
    [transactions, asset.id]
  );
  // plus/minusvalenza realizzata per ogni vendita (ricalcolata dalla storia)
  const realizedByTx = useMemo(() => {
    const { realized } = applyTransactions(asset, transactions);
    return new Map(realized.map((e) => [e.txId, e.gain]));
  }, [asset, transactions]);

  async function remove(tx: AssetTransaction) {
    await storage.remove("assetTransactions", tx.id);
    // un dividendo ha un'entrata collegata: si elimina (e ripristina) insieme
    const linkedIncome =
      tx.type === "dividendo"
        ? await storage.findBy<Income>("incomes", "sourceRef", `tx:${tx.id}`)
        : undefined;
    if (linkedIncome) await storage.remove("incomes", linkedIncome.id);
    await recomputeAssetPosition(asset.id);
    showToast(`Operazione del ${fmtDate(tx.date)} eliminata`, {
      kind: "info",
      duration: 6000,
      undo: async () => {
        await storage.put("assetTransactions", tx);
        if (linkedIncome) await storage.put("incomes", linkedIncome);
        await recomputeAssetPosition(asset.id);
      },
    });
  }

  return (
    <Card
      title="Operazioni"
      subtitle="Acquisti, vendite, dividendi e split ricalcolano posizione, XIRR e fisco in automatico"
      action={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setModal("acquisto")}>
            <Plus className="size-4" /> Acquisto
          </Button>
          <Button
            variant="outline"
            onClick={() => setModal("vendita")}
            disabled={asset.quantity <= 0}
          >
            <Minus className="size-4" /> Vendita
          </Button>
          <Button
            variant="outline"
            onClick={() => setModal("dividendo")}
            disabled={asset.quantity <= 0}
          >
            <Coins className="size-4" /> Dividendo
          </Button>
          <Button
            variant="outline"
            onClick={() => setModal("frazionamento")}
            disabled={asset.quantity <= 0}
          >
            <Scissors className="size-4" /> Split
          </Button>
        </div>
      }
      className="mt-6"
    >
      {mine.length === 0 ? (
        <p className="py-6 text-center text-sm text-faint">
          Nessuna operazione registrata: la posizione attuale è quella inserita a mano
          ({fmtNum(asset.quantity, 6)} × {fmtEUR(asset.avgCost)}).
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {mine.map((tx) => {
            const gain = realizedByTx.get(tx.id);
            const labels = {
              acquisto: { text: "Acquisto", tone: "pos" as const },
              vendita: { text: "Vendita", tone: "accent" as const },
              dividendo: { text: "Dividendo", tone: "pos" as const },
              frazionamento: { text: "Split", tone: "neutral" as const },
            };
            return (
              <li key={tx.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <Badge tone={labels[tx.type].tone}>{labels[tx.type].text}</Badge>
                <span className="w-24 shrink-0 text-xs text-faint">{fmtDate(tx.date)}</span>
                <span className="tnum min-w-0 flex-1">
                  {tx.type === "dividendo" ? (
                    <span className="text-xs text-faint">incasso netto</span>
                  ) : tx.type === "frazionamento" ? (
                    <span className="text-xs text-faint">
                      fattore ×{fmtNum(tx.quantity, 4)} (quantità ×, PMC ÷)
                    </span>
                  ) : (
                    <>
                      {fmtNum(tx.quantity, 6)} × {fmtEUR(tx.unitPrice)}
                      {tx.fees > 0 && (
                        <span className="text-xs text-faint">
                          {" "}
                          + {fmtEUR(tx.fees)} commissioni
                        </span>
                      )}
                    </>
                  )}
                </span>
                {tx.type !== "frazionamento" && (
                  <span className="tnum font-semibold">
                    {tx.type === "dividendo"
                      ? fmtEUR(tx.unitPrice)
                      : fmtEUR(
                          tx.quantity * tx.unitPrice + (tx.type === "acquisto" ? tx.fees : -tx.fees)
                        )}
                  </span>
                )}
                {tx.type === "vendita" && gain != null && (
                  <Badge tone={gain >= 0 ? "pos" : "neg"}>
                    {gain >= 0 ? "plusvalenza" : "minusvalenza"} {fmtEURSigned(gain)}
                  </Badge>
                )}
                <IconButton label="Elimina operazione" onClick={() => remove(tx)}>
                  <Trash2 className="size-4" />
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}
      {(modal === "acquisto" || modal === "vendita") && (
        <TransactionModal asset={asset} type={modal} onClose={() => setModal(null)} />
      )}
      {(modal === "dividendo" || modal === "frazionamento") && (
        <SimpleTxModal asset={asset} type={modal} onClose={() => setModal(null)} />
      )}
    </Card>
  );
}

function SimpleTxModal({
  asset,
  type,
  onClose,
}: {
  asset: Asset;
  type: "dividendo" | "frazionamento";
  onClose: () => void;
}) {
  const { showToast } = useToast();
  const [date, setDate] = useState(todayISO());
  const [value, setValue] = useState("");

  const parsed = parseItAmount(value);
  const isDividend = type === "dividendo";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (parsed == null || parsed <= 0 || !date) {
      showToast(
        isDividend ? "Inserisci l'importo netto incassato" : "Inserisci il fattore dello split",
        { kind: "error" }
      );
      return;
    }
    const tx: AssetTransaction = {
      id: uid(),
      assetId: asset.id,
      type,
      date,
      quantity: isDividend ? 1 : parsed,
      unitPrice: isDividend ? parsed : 0,
      fees: 0,
      createdAt: new Date().toISOString(),
    };
    await storage.put("assetTransactions", tx);
    if (isDividend) {
      // il dividendo è anche un'entrata reale, collegata all'operazione
      const income: Income = {
        id: uid(),
        description: `Dividendo ${asset.name}`,
        category: "Dividendi",
        amount: parsed,
        date,
        source: "auto",
        sourceRef: `tx:${tx.id}`,
      };
      await storage.put("incomes", income);
      showToast(
        `Dividendo di ${fmtEUR(parsed)} registrato: entra nelle entrate e nell'XIRR dell'asset`,
        { kind: "success", duration: 6000 }
      );
    } else {
      await recomputeAssetPosition(asset.id);
      showToast(
        `Split ×${fmtNum(parsed, 4)} applicato: quantità e PMC ricalcolati (il capitale investito non cambia)`,
        { kind: "success", duration: 6000 }
      );
    }
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={
        isDividend ? `Registra dividendo — ${asset.name}` : `Registra split — ${asset.name}`
      }
    >
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Data">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field
            label={isDividend ? "Importo netto incassato (€)" : "Fattore dello split"}
            hint={
              isDividend
                ? "Al netto delle ritenute: quello che è arrivato sul conto"
                : "10 per un frazionamento 10:1 · 0,1 per un raggruppamento 1:10"
            }
          >
            <Input
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={isDividend ? "es. 24,35" : "es. 10"}
              autoFocus
            />
          </Field>
        </div>
        {!isDividend && parsed != null && parsed > 0 && (
          <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs text-soft">
            Dopo lo split: <strong className="tnum">{fmtNum(asset.quantity * parsed, 6)}</strong>{" "}
            unità a PMC <strong className="tnum">{fmtEUR(asset.avgCost / parsed)}</strong>.
          </p>
        )}
        <ModalFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Annulla
          </Button>
          <Button type="submit">{isDividend ? "Registra dividendo" : "Applica split"}</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

function TransactionModal({
  asset,
  type,
  onClose,
}: {
  asset: Asset;
  type: "acquisto" | "vendita";
  onClose: () => void;
}) {
  const { showToast } = useToast();
  const [date, setDate] = useState(todayISO());
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState(
    asset.currentPrice > 0 ? String(asset.currentPrice).replace(".", ",") : ""
  );
  const [fees, setFees] = useState("");

  const q = parseItAmount(quantity);
  const p = parseItAmount(unitPrice);
  const f = parseItAmount(fees) ?? 0;
  const preview =
    type === "vendita" && q != null && p != null && q > 0
      ? Math.min(q, asset.quantity) * (p - asset.avgCost) - f
      : null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (q == null || q <= 0 || p == null || p < 0 || !date) {
      showToast("Controlla quantità, prezzo e data", { kind: "error" });
      return;
    }
    if (type === "vendita" && q > asset.quantity + 1e-9) {
      showToast(
        `Puoi vendere al massimo ${fmtNum(asset.quantity, 6)} unità (quantità posseduta)`,
        { kind: "error" }
      );
      return;
    }
    const tx: AssetTransaction = {
      id: uid(),
      assetId: asset.id,
      type,
      date,
      quantity: q,
      unitPrice: p,
      fees: f,
      createdAt: new Date().toISOString(),
    };
    await storage.put("assetTransactions", tx);
    await recomputeAssetPosition(asset.id);
    if (type === "vendita" && preview != null) {
      showToast(
        preview >= 0
          ? `Vendita registrata: plusvalenza ${fmtEUR(preview)} (vedi Tasse)`
          : `Vendita registrata: minusvalenza ${fmtEUR(Math.abs(preview))} nello zainetto fiscale`,
        { kind: "success", duration: 7000 }
      );
    } else {
      showToast("Acquisto registrato: PMC e quantità aggiornati", { kind: "success" });
    }
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={type === "acquisto" ? `Registra acquisto — ${asset.name}` : `Registra vendita — ${asset.name}`}
    >
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Data">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field
            label="Quantità"
            hint={type === "vendita" ? `posseduta: ${fmtNum(asset.quantity, 6)}` : undefined}
          >
            <Input
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="es. 5"
              autoFocus
            />
          </Field>
          <Field label="Prezzo unitario (€)">
            <Input
              inputMode="decimal"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
            />
          </Field>
          <Field label="Commissioni (€, opzionali)">
            <Input
              inputMode="decimal"
              value={fees}
              onChange={(e) => setFees(e.target.value)}
              placeholder="0"
            />
          </Field>
        </div>
        {type === "acquisto" && q != null && p != null && q > 0 && (
          <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs text-soft">
            Nuovo PMC stimato:{" "}
            <strong className="tnum text-ink">
              {fmtEUR((asset.quantity * asset.avgCost + q * p + f) / (asset.quantity + q))}
            </strong>{" "}
            su {fmtNum(asset.quantity + q, 6)} unità.
          </p>
        )}
        {preview != null && (
          <p
            className={`rounded-xl px-3 py-2 text-xs ${
              preview >= 0 ? "bg-pos-soft text-pos" : "bg-warn-soft text-warn"
            }`}
          >
            {preview >= 0 ? "Plusvalenza stimata" : "Minusvalenza stimata"}:{" "}
            <strong className="tnum">{fmtEURSigned(preview)}</strong> (PMC {fmtEUR(asset.avgCost)}
            ). {preview < 0 && "Andrà nello zainetto fiscale, spendibile entro 4 anni."}
          </p>
        )}
        <ModalFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Annulla
          </Button>
          <Button type="submit">
            {type === "acquisto" ? "Registra acquisto" : "Registra vendita"}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
