"use client";

// ── Investimenti ────────────────────────────────────────────────────────────

import Link from "next/link";
import { useMemo, useState } from "react";
import { LineChart, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useFinancial } from "@/lib/useFinancial";
import { storage } from "@/lib/storage";
import {
  ASSET_CLASSES,
  uid,
  type Asset,
  type AssetClass,
  type PriceSource,
  type TaxRegime,
  type WalletChain,
} from "@/lib/types";
import { assetCost, assetValue, allocationByClass } from "@/lib/engine/aggregates";
import { latentTax, taxRate, unrealizedGain } from "@/lib/engine/tax";
import { recomputeAssetPosition } from "@/lib/positionSync";
import { syncAllAssets, syncAsset } from "@/lib/prices/sync";
import { AssetSearch } from "@/components/AssetSearch";
import {
  fmtDateTime,
  fmtEUR,
  fmtEURSigned,
  fmtNum,
  fmtPct,
  fmtPctSigned,
  parseItAmount,
  todayISO,
} from "@/lib/format";
import { portfolioXirr } from "@/lib/engine/xirr";
import { computeTwr, investmentFlows } from "@/lib/engine/twr";
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
  Segmented,
  Select,
} from "@/components/ui";
import { AllocationDonut, PortfolioTreemap } from "@/components/lazyCharts";
import { useClassColors } from "@/components/chartTheme";
import { BenchmarkCard } from "@/components/BenchmarkCard";
import { PortfolioHistoryCard } from "@/components/PortfolioHistoryCard";
import { useOpenNew } from "@/lib/useOpenNew";

export default function InvestimentiPage() {
  const { ready, data, derived } = useFinancial();
  const [editing, setEditing] = useState<Asset | "new" | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [classFilter, setClassFilter] = useState<"tutte" | AssetClass>("tutte");
  const [syncing, setSyncing] = useState(false);
  const { showToast } = useToast();
  const undoableDelete = useUndoableDelete();
  useOpenNew(() => setEditing("new"));
  const classColors = useClassColors();

  const treemapItems = useMemo(() => {
    const gross = derived.agg.gross;
    return data.assets
      .filter((a) => assetValue(a) > 0)
      .map((a) => {
        const value = assetValue(a);
        const cost = assetCost(a);
        return {
          name: a.name,
          size: value,
          color: classColors[a.assetClass],
          pctOfGross: gross > 0 ? (value / gross) * 100 : 0,
          pl: value - cost,
          plPct: cost > 0 ? ((value - cost) / cost) * 100 : null,
          assetClass: a.assetClass,
        };
      });
  }, [data.assets, derived.agg.gross, classColors]);

  const donutData = useMemo(() => {
    const alloc = allocationByClass(data.assets);
    return [...alloc.entries()]
      .filter(([, v]) => v > 0)
      .map(([cls, v]) => ({ name: cls as string, value: v, color: classColors[cls] }));
  }, [data.assets, classColors]);

  if (!ready) return <LoadingState />;

  const invested = data.assets.reduce((s, a) => s + assetCost(a), 0);
  const value = derived.agg.investments;
  const pl = value - invested;
  const plPct = invested > 0 ? (pl / invested) * 100 : null;
  const pXirr = portfolioXirr(data.assets, data.assetTransactions);
  const twrFrom = new Date();
  twrFrom.setFullYear(twrFrom.getFullYear() - 1);
  const twr = computeTwr(
    data.snapshots,
    investmentFlows(data.assets, data.assetTransactions),
    twrFrom.toISOString().slice(0, 10)
  );

  const shown = data.assets
    .filter((a) => classFilter === "tutte" || a.assetClass === classFilter)
    .sort((a, b) => assetValue(b) - assetValue(a));

  const presentClasses = [...new Set(data.assets.map((a) => a.assetClass))];

  async function syncAll() {
    setSyncing(true);
    try {
      const results = await syncAllAssets();
      const failed = results.filter((r) => !r.ok);
      if (results.length === 0) {
        showToast("Nessun asset da sincronizzare (tutti a prezzo manuale)");
      } else if (failed.length === 0) {
        showToast(`Prezzi aggiornati per ${results.length} asset`, { kind: "success" });
      } else {
        showToast(
          `${results.length - failed.length} aggiornati, ${failed.length} falliti (${failed[0].name}: ${failed[0].error}). Gli ultimi prezzi restano validi.`,
          { kind: "error", duration: 8000 }
        );
      }
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Investimenti"
        actions={
          <>
            <Button variant="outline" onClick={syncAll} disabled={syncing}>
              <RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Sincronizzo…" : "Sincronizza prezzi"}
            </Button>
            {data.assets.length > 0 && (
              <Button variant="outline" onClick={() => setManualOpen(true)}>
                <Pencil className="size-4" /> Prezzi manuali
              </Button>
            )}
            <Button onClick={() => setEditing("new")}>
              <Plus className="size-4" /> Nuovo asset
            </Button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Valore attuale" value={fmtEUR(value)} />
        <Kpi label="Capitale investito" value={fmtEUR(invested)} />
        <Kpi
          label="P/L non realizzato"
          value={fmtEURSigned(pl)}
          sub={plPct != null ? fmtPctSigned(plPct) : undefined}
          tone={pl > 0 ? "pos" : pl < 0 ? "neg" : "default"}
        />
        <Kpi
          label="Rendimento annuo (XIRR)"
          value={pXirr.rate != null ? fmtPctSigned(pXirr.rate * 100) : "—"}
          tone={pXirr.rate != null ? (pXirr.rate > 0 ? "pos" : "neg") : "default"}
          sub={
            pXirr.rate != null
              ? `money-weighted su ${pXirr.included} asset${pXirr.excluded > 0 ? ` (${pXirr.excluded} esclusi)` : ""}`
              : pXirr.excluded > 0
                ? "imposta la data di carico sugli asset"
                : "servono flussi datati"
          }
          info="Tasso interno di rendimento annualizzato dei tuoi flussi reali (acquisti, vendite, dividendi registrati, valore attuale): tiene conto di QUANDO hai investito. Esclude gli asset senza data di carico."
        />
        <Kpi
          label="TWR"
          value={
            twr.computable
              ? fmtPctSigned((twr.annualized ?? twr.cumulative ?? 0) * 100)
              : "—"
          }
          tone={
            twr.computable
              ? (twr.annualized ?? twr.cumulative ?? 0) > 0
                ? "pos"
                : "neg"
              : "default"
          }
          sub={
            twr.computable
              ? twr.annualized != null
                ? `annualizzato su ${twr.days} giorni di snapshot`
                : `cumulato su ${twr.days} giorni (annualizzo da 90)`
              : "si costruisce con gli snapshot giornalieri"
          }
          info="Rendimento time-weighted: neutralizza l'effetto di quando hai versato o prelevato e misura solo la bontà degli investimenti. È la metrica giusta per confrontarti con un benchmark; lo XIRR invece pesa anche il tuo tempismo."
        />
        <Kpi
          label="Volatilità stimata"
          value={fmtPct(derived.portfolio.sigma * 100)}
          sub="annua, media pesata per classe"
        />
      </div>

      {data.assets.length === 0 ? (
        <EmptyState
          icon={<LineChart />}
          title="Nessun investimento ancora"
          text="Aggiungi ETF, azioni, crypto, oro o immobili: i prezzi si aggiornano da soli dai provider gratuiti."
          action={<Button onClick={() => setEditing("new")}>Aggiungi un asset</Button>}
        />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid gap-6 lg:grid-cols-5">
            <Card title="Mappa del portafoglio" subtitle="Area ∝ valore" className="lg:col-span-3">
              <PortfolioTreemap items={treemapItems} />
            </Card>
            <Card title="Per classe" className="lg:col-span-2">
              <AllocationDonut data={donutData} height={200} />
              <ul className="mt-2 flex flex-col gap-1.5 text-sm">
                {donutData.map((row) => (
                  <li key={row.name} className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full" style={{ background: row.color }} />
                    <span className="flex-1 text-soft">{row.name}</span>
                    <span className="tnum font-medium">{fmtEUR(row.value)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <MissingBaseDateCard assets={data.assets} />

          <PortfolioHistoryCard assets={data.assets} transactions={data.assetTransactions} />

          <BenchmarkCard assets={data.assets} transactions={data.assetTransactions} />

          <Card
            title="I tuoi asset"
            action={
              presentClasses.length > 1 ? (
                <Segmented
                  options={[
                    { value: "tutte" as const, label: "Tutte" },
                    ...presentClasses.map((c) => ({ value: c, label: c })),
                  ]}
                  value={classFilter}
                  onChange={(v) => setClassFilter(v as "tutte" | AssetClass)}
                />
              ) : undefined
            }
          >
            <ul className="divide-y divide-line">
              {shown.map((a) => (
                <AssetRow
                  key={a.id}
                  asset={a}
                  onEdit={() => setEditing(a)}
                  onDelete={() => undoableDelete("assets", a, `Asset "${a.name}"`)}
                />
              ))}
            </ul>
          </Card>
        </div>
      )}

      <AssetModal
        key={editing === "new" ? "new" : editing?.id ?? "closed"}
        editing={editing}
        hasTransactions={
          editing !== null &&
          editing !== "new" &&
          data.assetTransactions.some((t) => t.assetId === editing.id)
        }
        onClose={() => setEditing(null)}
      />
      {manualOpen && (
        <ManualPricesModal assets={data.assets} onClose={() => setManualOpen(false)} />
      )}
    </div>
  );
}

function ManualPricesModal({ assets, onClose }: { assets: Asset[]; onClose: () => void }) {
  const { showToast } = useToast();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(assets.map((a) => [a.id, String(a.currentPrice).replace(".", ",")]))
  );

  async function save() {
    let updated = 0;
    for (const a of assets) {
      const parsed = parseItAmount(values[a.id] ?? "");
      if (parsed != null && parsed !== a.currentPrice) {
        await storage.put("assets", { ...a, currentPrice: parsed });
        updated++;
      }
    }
    showToast(updated > 0 ? `${updated} prezzi aggiornati` : "Nessun prezzo modificato", {
      kind: "success",
    });
    onClose();
  }

  return (
    <Modal open onClose={onClose} title="Prezzi manuali">
      <p className="mb-4 text-sm text-soft">
        Aggiorna a mano il prezzo unitario (in EUR) di qualunque asset — utile per immobili,
        BTP quotati sul MOT e collezioni.
      </p>
      <div className="flex flex-col gap-3">
        {assets.map((a) => (
          <div key={a.id} className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{a.name}</div>
              <div className="text-xs text-faint">{a.assetClass}</div>
            </div>
            <Input
              inputMode="decimal"
              value={values[a.id] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [a.id]: e.target.value }))}
              className="!w-36 text-right"
              aria-label={`Prezzo di ${a.name}`}
            />
          </div>
        ))}
      </div>
      <ModalFooter>
        <Button variant="outline" onClick={onClose}>
          Annulla
        </Button>
        <Button onClick={save}>Salva prezzi</Button>
      </ModalFooter>
    </Modal>
  );
}

function AssetRow({
  asset,
  onEdit,
  onDelete,
}: {
  asset: Asset;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { showToast } = useToast();
  const [syncing, setSyncing] = useState(false);
  const value = assetValue(asset);
  const pl = unrealizedGain(asset);
  const cost = assetCost(asset);
  const tax = latentTax(asset);

  async function syncOne() {
    setSyncing(true);
    try {
      const settings = await storage.get<import("@/lib/types").Settings>("settings", "main");
      if (!settings) return;
      const res = await syncAsset(asset, settings);
      if (res.ok) showToast(`${asset.name}: prezzo aggiornato`, { kind: "success" });
      else
        showToast(`${asset.name}: ${res.error}. L'ultimo prezzo resta valido.`, {
          kind: "error",
          duration: 7000,
        });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-0 flex-1 basis-48">
        <Link
          href={`/investimenti/${asset.id}`}
          className="truncate font-medium text-ink hover:text-accent hover:underline"
        >
          {asset.name}
        </Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-faint">
          {asset.ticker && <span className="tnum">{asset.ticker}</span>}
          <Badge tone="brand">{asset.assetClass}</Badge>
          {asset.broker && <span>{asset.broker}</span>}
          {asset.taxRegime === "whitelist" && <Badge tone="accent">12,5%</Badge>}
          {asset.walletChain && asset.walletAddress && (
            <Badge tone="accent">wallet on-chain</Badge>
          )}
        </div>
      </div>
      <div className="tnum basis-40 text-xs text-soft">
        {fmtNum(asset.quantity, 6)} × {fmtEUR(asset.avgCost)}
        <div className="text-faint">
          {asset.priceSource === "manuale"
            ? "prezzo manuale"
            : asset.lastSyncAt
              ? `sync ${fmtDateTime(asset.lastSyncAt)}`
              : "mai sincronizzato"}
        </div>
      </div>
      <div className="basis-32 text-right">
        <div className="tnum font-semibold">{fmtEUR(value)}</div>
        <div className={`tnum text-xs ${pl > 0 ? "text-pos" : pl < 0 ? "text-neg" : "text-faint"}`}>
          {fmtEURSigned(pl)}
          {cost > 0 ? ` (${fmtPctSigned((pl / cost) * 100)})` : ""}
        </div>
        {tax > 0 && (
          <Badge tone="warn" className="mt-1">
            {fmtEUR(tax)} tasse se vendi
          </Badge>
        )}
      </div>
      <div className="flex shrink-0">
        {(asset.priceSource !== "manuale" || (asset.walletChain && asset.walletAddress)) && (
          <IconButton label={`Sincronizza ${asset.name}`} onClick={syncOne} disabled={syncing}>
            <RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} />
          </IconButton>
        )}
        <IconButton label={`Modifica ${asset.name}`} onClick={onEdit}>
          <Pencil className="size-4" />
        </IconButton>
        <IconButton label={`Elimina ${asset.name}`} onClick={onDelete}>
          <Trash2 className="size-4" />
        </IconButton>
      </div>
    </li>
  );
}

/** Invito a completare le date di carico mancanti: sbloccano XIRR e storico. */
function MissingBaseDateCard({ assets }: { assets: Asset[] }) {
  const { showToast } = useToast();
  const [dates, setDates] = useState<Record<string, string>>({});
  const missing = assets.filter(
    (a) => a.quantity > 0 && !a.baseDate && (a.baseQuantity ?? a.quantity) > 0
  );
  if (missing.length === 0) return null;

  async function saveDate(asset: Asset) {
    const date = dates[asset.id];
    if (!date) return;
    await storage.put("assets", { ...asset, baseDate: date });
    showToast(`Data di carico salvata per ${asset.name}: XIRR e storico attivi`, {
      kind: "success",
    });
  }

  return (
    <Card
      title={`${missing.length} asset senza data di carico`}
      subtitle="Indica quando hai costruito la posizione: sblocca rendimento annualizzato (XIRR), benchmark e ricostruzione storica"
    >
      <ul className="flex flex-col gap-2">
        {missing.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{a.name}</span>
            <Input
              type="date"
              value={dates[a.id] ?? ""}
              onChange={(e) => setDates((d) => ({ ...d, [a.id]: e.target.value }))}
              className="!w-44"
              aria-label={`Data di carico di ${a.name}`}
            />
            <Button variant="outline" onClick={() => saveDate(a)} disabled={!dates[a.id]}>
              Salva
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const SOURCE_HINTS: Record<PriceSource, string> = {
  manuale: "Prezzo inserito a mano: ideale per immobili, BTP sul MOT, collezioni, monete.",
  coingecko: 'ID CoinGecko, es. "bitcoin", "ethereum" (minuscolo).',
  yahoo: 'Simbolo Yahoo, es. "VWCE.MI" (Borsa Italiana), "VWCE.DE" (XETRA), "AAPL" (USA), "GC=F" (oro spot).',
  twelvedata: 'Formato Twelve Data, es. "VWCE:XETRA". Serve la chiave API in Impostazioni.',
};

function AssetModal({
  editing,
  hasTransactions,
  onClose,
}: {
  editing: Asset | "new" | null;
  hasTransactions: boolean;
  onClose: () => void;
}) {
  const { showToast } = useToast();
  const isNew = editing === "new";
  const base = isNew ? null : editing;
  const [name, setName] = useState(base?.name ?? "");
  const [ticker, setTicker] = useState(base?.ticker ?? "");
  const [assetClass, setAssetClass] = useState<AssetClass>(base?.assetClass ?? "ETF");
  const [broker, setBroker] = useState(base?.broker ?? "");
  const [quantity, setQuantity] = useState(
    base ? String(base.baseQuantity ?? base.quantity).replace(".", ",") : ""
  );
  const [avgCost, setAvgCost] = useState(
    base ? String(base.baseAvgCost ?? base.avgCost).replace(".", ",") : ""
  );
  const [baseDate, setBaseDate] = useState(base?.baseDate ?? (isNew ? todayISO() : ""));
  const [currentPrice, setCurrentPrice] = useState(
    base ? String(base.currentPrice).replace(".", ",") : ""
  );
  const [priceSource, setPriceSource] = useState<PriceSource>(base?.priceSource ?? "yahoo");
  const [symbol, setSymbol] = useState(base?.symbol ?? "");
  const [taxRegime, setTaxRegime] = useState<TaxRegime>(base?.taxRegime ?? "standard");
  const [declaredIncome, setDeclaredIncome] = useState(
    base?.declaredAnnualIncome ? String(base.declaredAnnualIncome).replace(".", ",") : ""
  );
  const [walletChain, setWalletChain] = useState<WalletChain | "">(base?.walletChain ?? "");
  const [walletAddress, setWalletAddress] = useState(base?.walletAddress ?? "");
  const [tokenContract, setTokenContract] = useState(base?.tokenContract ?? "");
  const [tokenDecimals, setTokenDecimals] = useState(String(base?.tokenDecimals ?? 18));
  const [exchange, setExchange] = useState(base?.exchange ?? "");
  const [ter, setTer] = useState(base?.ter != null ? String(base.ter).replace(".", ",") : "");
  const [saving, setSaving] = useState(false);

  // aliquota effettiva calcolata dalla classe (crypto 33% dal 2026, whitelist 12,5%…)
  const effectiveRate = taxRate({ assetClass, taxRegime } as Asset);

  // Selezione dalla ricerca: compila i campi in automatico.
  function handleSearchSelect(r: import("@/lib/prices/search").AssetSearchResult) {
    if (!name.trim()) setName(r.name);
    setTicker(r.ticker);
    setAssetClass(r.assetClass);
    setPriceSource(r.priceSource);
    setSymbol(r.symbol);
    setExchange(r.exchange ?? "");
    // titoli di Stato → whitelist; il resto → standard (crypto usa 33% via classe)
    setTaxRegime("standard");
    showToast(`${r.name} selezionato: sincronizzo il prezzo dopo il salvataggio`, {
      kind: "info",
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const q = parseItAmount(quantity);
    const pmc = parseItAmount(avgCost);
    const price = parseItAmount(currentPrice) ?? pmc;
    if (!name.trim() || q == null || pmc == null || q < 0 || pmc < 0) {
      showToast("Controlla nome, quantità e PMC: gli importi accettano la virgola", {
        kind: "error",
      });
      return;
    }
    if (priceSource !== "manuale" && !symbol.trim()) {
      showToast("Per la sincronizzazione serve il simbolo nel formato del provider", {
        kind: "error",
      });
      return;
    }
    const asset: Asset = {
      id: base?.id ?? uid(),
      name: name.trim(),
      ticker: ticker.trim() || undefined,
      assetClass,
      broker: broker.trim() || undefined,
      quantity: q,
      avgCost: pmc,
      baseQuantity: q,
      baseAvgCost: pmc,
      baseDate: baseDate || undefined,
      currentPrice: price ?? 0,
      priceSource,
      symbol: symbol.trim() || undefined,
      quoteCurrency: base?.quoteCurrency,
      lastSyncAt: base?.lastSyncAt,
      taxRegime,
      declaredAnnualIncome: parseItAmount(declaredIncome) ?? undefined,
      walletChain: walletChain || undefined,
      walletAddress: walletChain ? walletAddress.trim() || undefined : undefined,
      tokenContract:
        walletChain === "ethereum" ? tokenContract.trim() || undefined : undefined,
      tokenDecimals:
        walletChain === "ethereum" && tokenContract.trim()
          ? Math.max(0, Math.min(36, Number(tokenDecimals) || 18))
          : undefined,
      exchange: exchange.trim() || undefined,
      ter: parseItAmount(ter) ?? undefined,
    };
    setSaving(true);
    await storage.put("assets", asset);
    if (hasTransactions) {
      // quantità/PMC inseriti sono la posizione iniziale: riapplica le operazioni
      await recomputeAssetPosition(asset.id);
    }
    setSaving(false);
    // il modale si chiude subito; la sync avviene in background (senza bloccare)
    const wantsSync = asset.priceSource !== "manuale" || (asset.walletChain && asset.walletAddress);
    onClose();
    if (wantsSync) {
      showToast(isNew ? "Asset aggiunto: sincronizzo il prezzo…" : "Asset aggiornato", {
        kind: "success",
      });
      (async () => {
        const settings = await storage.get<import("@/lib/types").Settings>("settings", "main");
        if (!settings) return;
        const res = await syncAsset(asset, settings);
        if (res.ok && res.price != null) {
          showToast(`${asset.name}: ${fmtEUR(res.price)}`, { kind: "success" });
        } else if (!res.ok) {
          showToast(
            `${asset.name}: prezzo non recuperato (${res.error}). Inseriscilo a mano o riprova.`,
            { kind: "error", duration: 7000 }
          );
        }
      })();
    } else {
      showToast(isNew ? "Asset aggiunto" : "Asset aggiornato", { kind: "success" });
    }
  }

  return (
    <Modal
      open={editing !== null}
      onClose={onClose}
      title={isNew ? "Nuovo asset" : "Modifica asset"}
      wide
    >
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        {isNew && (
          <div className="sm:col-span-2">
            <Field
              label="Cerca l'asset"
              hint="Seleziona un risultato e nome, ticker, simbolo, classe e provider si compilano da soli"
            >
              <AssetSearch onSelect={handleSearchSelect} />
            </Field>
          </div>
        )}
        <Field label="Nome">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="es. Vanguard FTSE All-World"
            autoFocus={!isNew}
          />
        </Field>
        <Field label="Ticker (facoltativo)">
          <Input
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            placeholder="es. VWCE"
          />
        </Field>
        <Field label="Classe">
          <Select
            value={assetClass}
            onChange={(e) => setAssetClass(e.target.value as AssetClass)}
          >
            {ASSET_CLASSES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Broker / luogo (facoltativo)">
          <Input
            value={broker}
            onChange={(e) => setBroker(e.target.value)}
            placeholder="es. Directa, Ledger…"
          />
        </Field>
        <Field
          label={hasTransactions ? "Quantità iniziale" : "Quantità"}
          hint={
            hasTransactions
              ? "Posizione PRIMA delle operazioni registrate: il totale attuale si ricalcola da qui"
              : "Per gli immobili usa 1"
          }
        >
          <Input
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="es. 10"
          />
        </Field>
        <Field
          label={hasTransactions ? "PMC iniziale (€)" : "PMC — prezzo medio di carico (€)"}
          hint={hasTransactions ? "Il PMC attuale si ricalcola applicando le operazioni" : undefined}
        >
          <Input
            inputMode="decimal"
            value={avgCost}
            onChange={(e) => setAvgCost(e.target.value)}
            placeholder="es. 105,30"
          />
        </Field>
        <Field
          label="Data di carico (facoltativa)"
          hint="Quando hai costruito questa posizione: serve per il rendimento annualizzato (XIRR)"
        >
          <Input type="date" value={baseDate} onChange={(e) => setBaseDate(e.target.value)} />
        </Field>
        <Field label="Fonte prezzo">
          <Select
            value={priceSource}
            onChange={(e) => setPriceSource(e.target.value as PriceSource)}
          >
            <option value="yahoo">Yahoo Finance (azioni, ETF, oro, indici — senza chiave)</option>
            <option value="coingecko">CoinGecko (crypto — senza chiave)</option>
            <option value="twelvedata">Twelve Data (con chiave API)</option>
            <option value="manuale">Manuale (immobili, BTP, collezioni)</option>
          </Select>
        </Field>
        {priceSource !== "manuale" ? (
          <Field label="Simbolo per la sync" hint={SOURCE_HINTS[priceSource]}>
            <Input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder={
                priceSource === "coingecko"
                  ? "bitcoin"
                  : priceSource === "twelvedata"
                    ? "VWCE:XETRA"
                    : "VWCE.MI"
              }
            />
          </Field>
        ) : (
          <Field
            label="Prezzo attuale (€)"
            hint="Per i BTP: prezzo in % del nominale × valore nominale ÷ 100"
          >
            <Input
              inputMode="decimal"
              value={currentPrice}
              onChange={(e) => setCurrentPrice(e.target.value)}
              placeholder="es. 98,50"
            />
          </Field>
        )}
        <Field
          label={
            <span className="flex items-center gap-2">
              Regime fiscale
              <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand-ink">
                aliquota {fmtPct(effectiveRate * 100)}
              </span>
            </span>
          }
          hint={
            assetClass === "Crypto"
              ? "Assegnata dalla classe: le crypto usano il 33% per i realizzi dal 2026 (26% fino al 2025)"
              : "Assegnata dalla classe. Per i titoli di Stato scegli «whitelist 12,5%»"
          }
        >
          <Select
            value={taxRegime}
            onChange={(e) => setTaxRegime(e.target.value as TaxRegime)}
            disabled={assetClass === "Crypto"}
          >
            <option value="standard">Standard 26%</option>
            <option value="whitelist">Whitelist 12,5% (titoli di Stato)</option>
          </Select>
        </Field>
        <Field label="Rendita annua dichiarata (€, facoltativa)" hint="es. affitti di un immobile">
          <Input
            inputMode="decimal"
            value={declaredIncome}
            onChange={(e) => setDeclaredIncome(e.target.value)}
            placeholder="es. 7.200"
          />
        </Field>
        {assetClass === "ETF" && (
          <Field
            label="TER % annuo (facoltativo)"
            hint="Lo trovi sul KID/scheda dell'ETF: non esiste una fonte gratuita automatica"
          >
            <Input
              inputMode="decimal"
              value={ter}
              onChange={(e) => setTer(e.target.value)}
              placeholder="es. 0,22"
            />
          </Field>
        )}

        {assetClass === "Crypto" && (
          <div className="rounded-xl bg-surface-2 p-4 sm:col-span-2">
            <div className="mb-1 text-sm font-semibold">Wallet auto-tracciato (opzionale)</div>
            <p className="mb-3 text-xs text-faint">
              Inserisci solo l&apos;indirizzo <strong>pubblico</strong>: a ogni sincronizzazione
              la quantità si legge dalla chain (il prezzo resta da CoinGecko). Nota privacy: il
              provider interrogato (mempool.space / RPC pubblici) può associare l&apos;indirizzo
              al tuo IP.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Chain">
                <Select
                  value={walletChain}
                  onChange={(e) => setWalletChain(e.target.value as WalletChain | "")}
                >
                  <option value="">Nessuna (quantità manuale)</option>
                  <option value="bitcoin">Bitcoin</option>
                  <option value="ethereum">Ethereum (nativo o ERC-20)</option>
                  <option value="solana">Solana</option>
                </Select>
              </Field>
              {walletChain && (
                <Field
                  label="Indirizzo pubblico"
                  hint={
                    walletChain === "bitcoin"
                      ? "Indirizzo singolo oppure chiave estesa xpub/ypub/zpub (traccia l'intero wallet)"
                      : undefined
                  }
                >
                  <Input
                    value={walletAddress}
                    onChange={(e) => setWalletAddress(e.target.value)}
                    placeholder={
                      walletChain === "bitcoin"
                        ? "bc1q… / xpub… / zpub…"
                        : walletChain === "ethereum"
                          ? "0x…"
                          : "indirizzo Solana"
                    }
                    className="tnum"
                  />
                </Field>
              )}
              {walletChain === "ethereum" && (
                <>
                  <Field
                    label="Contratto token ERC-20 (facoltativo)"
                    hint="Vuoto = saldo ETH nativo"
                  >
                    <Input
                      value={tokenContract}
                      onChange={(e) => setTokenContract(e.target.value)}
                      placeholder="0x… (es. USDC)"
                      className="tnum"
                    />
                  </Field>
                  {tokenContract.trim() && (
                    <Field label="Decimali del token" hint="USDC/USDT: 6 · la maggior parte: 18">
                      <Input
                        type="number"
                        min={0}
                        max={36}
                        value={tokenDecimals}
                        onChange={(e) => setTokenDecimals(e.target.value)}
                      />
                    </Field>
                  )}
                </>
              )}
            </div>
          </div>
        )}
        <div className="sm:col-span-2">
          <ModalFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Annulla
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Salvo…" : "Salva asset"}
            </Button>
          </ModalFooter>
        </div>
      </form>
    </Modal>
  );
}
