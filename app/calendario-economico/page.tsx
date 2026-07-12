"use client";

// ── Calendario economico (feed pubblico Forex Factory via proxy) ───────────

import { useCallback, useEffect, useMemo, useState } from "react";
import { Globe2, RefreshCw, WifiOff } from "lucide-react";
import { useFinancial } from "@/lib/useFinancial";
import { storage } from "@/lib/storage";
import type { EconomicEvent, EconomicEventsCache } from "@/lib/types";
import { fmtDateTime, todayISO } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingState,
  PageHeader,
  Segmented,
} from "@/components/ui";

const IMPACTS = ["High", "Medium", "Low"] as const;
const IMPACT_LABEL: Record<string, string> = {
  High: "Alto",
  Medium: "Medio",
  Low: "Basso",
};
const REFRESH_THROTTLE = 5 * 60 * 1000; // refresh manuale: max ogni 5 minuti

type WeekTab = "this" | "next";

export default function CalendarioEconomicoPage() {
  const { ready, data } = useFinancial();
  const [week, setWeek] = useState<WeekTab>("this");
  const [caches, setCaches] = useState<Record<string, EconomicEventsCache | null>>({});
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [impactFilter, setImpactFilter] = useState<Set<string>>(new Set(IMPACTS));
  const [currencyFilter, setCurrencyFilter] = useState<Set<string>>(new Set(["EUR", "USD"]));

  const load = useCallback(async (w: WeekTab, force = false) => {
    const cached = await storage.get<EconomicEventsCache>("economicEventsCache", w);
    setLoading(true);
    if (cached) setCaches((c) => ({ ...c, [w]: cached }));
    const fresh =
      !cached || Date.now() - new Date(cached.fetchedAt).getTime() > 4 * 60 * 60 * 1000;
    if (force || fresh) {
      try {
        const res = await fetch(`/api/economic-calendar?week=${w}`);
        if (!res.ok) throw new Error();
        const json = await res.json();
        const entry: EconomicEventsCache = {
          id: w,
          fetchedAt: json.fetchedAt ?? new Date().toISOString(),
          events: json.events ?? [],
        };
        await storage.put("economicEventsCache", entry);
        setCaches((c) => ({ ...c, [w]: entry }));
        setOffline(false);
      } catch {
        setOffline(true);
        if (!cached) setCaches((c) => ({ ...c, [w]: null }));
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // fetch iniziale (asincrono: gli stati vengono impostati dopo gli await)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load("this");
    load("next");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function manualRefresh() {
    const last = Number(localStorage.getItem("pfos-eco-refresh") || 0);
    if (Date.now() - last < REFRESH_THROTTLE) return;
    localStorage.setItem("pfos-eco-refresh", String(Date.now()));
    load(week, true);
  }

  const cache = caches[week];

  const currencies = useMemo(() => {
    const set = new Set<string>();
    for (const e of cache?.events ?? []) if (e.country) set.add(e.country);
    return [...set].sort();
  }, [cache]);

  // Rilevanza per il portafoglio dell'utente
  const relevance = useMemo(() => {
    const hasBonds = data.assets.some((a) => a.assetClass === "Obbligazioni");
    const hasMortgage = data.debts.some((d) => d.type === "mutuo");
    const hasEquity = data.assets.some((a) => a.assetClass === "ETF" || a.assetClass === "Azioni");
    const hasCrypto = data.assets.some((a) => a.assetClass === "Crypto");
    return (e: EconomicEvent): string | null => {
      const t = e.title.toLowerCase();
      const isRate = /rate|monetary|refinancing|fomc|press conference/.test(t);
      const isInflation = /cpi|inflation|pce/.test(t);
      const isJobs = /non-farm|nonfarm|unemployment|payroll/.test(t);
      if (e.country === "EUR" && isRate && (hasBonds || hasMortgage)) {
        return hasMortgage && hasBonds
          ? "Le decisioni BCE muovono i tassi: incidono sul tuo mutuo e sulle tue obbligazioni."
          : hasMortgage
            ? "Le decisioni BCE muovono i tassi: incidono sulla rata del tuo mutuo."
            : "Le decisioni BCE muovono i tassi: incidono sulle tue obbligazioni.";
      }
      if (e.country === "EUR" && isInflation && (hasBonds || hasMortgage)) {
        return "L'inflazione dell'eurozona orienta le prossime mosse della BCE.";
      }
      if (e.country === "USD" && (isRate || isInflation || isJobs) && (hasEquity || hasCrypto)) {
        return hasCrypto && !hasEquity
          ? "I dati USA muovono la propensione al rischio: le crypto ne risentono."
          : "I dati USA muovono i mercati globali: rilevante per i tuoi ETF/azioni.";
      }
      return null;
    };
  }, [data.assets, data.debts]);

  const grouped = useMemo(() => {
    const events = (cache?.events ?? [])
      .filter((e) => impactFilter.has(e.impact))
      .filter((e) => currencyFilter.size === 0 || currencyFilter.has(e.country));
    const byDay = new Map<string, EconomicEvent[]>();
    for (const e of events) {
      const day = new Date(e.date).toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" });
      const arr = byDay.get(day) ?? [];
      arr.push(e);
      byDay.set(day, arr);
    }
    return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [cache, impactFilter, currencyFilter]);

  if (!ready) return <LoadingState />;

  return (
    <div>
      <PageHeader
        title="Calendario economico"
        subtitle="Gli appuntamenti macro che muovono i mercati — settimana corrente e successiva"
        actions={
          <>
            <Segmented<WeekTab>
              options={[
                { value: "this", label: "Questa settimana" },
                { value: "next", label: "Prossima" },
              ]}
              value={week}
              onChange={setWeek}
              size="md"
            />
            <Button variant="outline" onClick={manualRefresh}>
              <RefreshCw className="size-4" /> Aggiorna
            </Button>
          </>
        }
      />

      {/* filtri */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-soft">Impatto:</span>
        {IMPACTS.map((imp) => (
          <FilterChip
            key={imp}
            active={impactFilter.has(imp)}
            tone={imp === "High" ? "neg" : imp === "Medium" ? "warn" : "neutral"}
            onClick={() =>
              setImpactFilter((f) => {
                const next = new Set(f);
                if (next.has(imp)) next.delete(imp);
                else next.add(imp);
                return next;
              })
            }
          >
            {IMPACT_LABEL[imp]}
          </FilterChip>
        ))}
        <span className="ml-3 text-xs font-medium text-soft">Valuta:</span>
        {currencies.map((cur) => (
          <FilterChip
            key={cur}
            active={currencyFilter.has(cur)}
            tone="accent"
            onClick={() =>
              setCurrencyFilter((f) => {
                const next = new Set(f);
                if (next.has(cur)) next.delete(cur);
                else next.add(cur);
                return next;
              })
            }
          >
            {cur}
          </FilterChip>
        ))}
      </div>

      {offline && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-warn/25 bg-warn-soft px-4 py-2.5 text-sm text-warn">
          <WifiOff className="size-4" />
          Feed non raggiungibile: stai vedendo l&apos;ultima copia salvata
          {cache && ` (${fmtDateTime(cache.fetchedAt)})`}.
        </div>
      )}

      {loading && !cache ? (
        <LoadingState />
      ) : !cache || cache.events.length === 0 ? (
        <EmptyState
          icon={<Globe2 />}
          title="Nessun evento disponibile"
          text="Il feed non è raggiungibile e non c'è una copia salvata. Riprova quando sei online."
        />
      ) : grouped.length === 0 ? (
        <EmptyState
          icon={<Globe2 />}
          title="Nessun evento con questi filtri"
          text="Allarga i filtri di impatto o valuta per vedere più eventi."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {grouped.map(([day, events]) => {
            const isToday = day === todayISO();
            return (
              <Card key={day} className={isToday ? "!border-brand" : ""}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-sm font-semibold capitalize">
                    {new Date(day + "T12:00:00").toLocaleDateString("it-IT", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    })}
                  </span>
                  {isToday && <Badge tone="brand">oggi</Badge>}
                </div>
                <ul className="divide-y divide-line">
                  {events.map((e, i) => {
                    const note = relevance(e);
                    const time = new Date(e.date).toLocaleTimeString("it-IT", {
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "Europe/Rome",
                    });
                    return (
                      <li key={i} className="py-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="tnum w-12 shrink-0 text-xs text-faint">{time}</span>
                          <Badge tone="accent">{e.country}</Badge>
                          <Badge
                            tone={
                              e.impact === "High"
                                ? "neg"
                                : e.impact === "Medium"
                                  ? "warn"
                                  : "neutral"
                            }
                          >
                            {IMPACT_LABEL[e.impact] ?? e.impact}
                          </Badge>
                          <span className="min-w-0 flex-1 text-sm font-medium">{e.title}</span>
                          <span className="tnum shrink-0 text-xs text-soft">
                            {e.actual && (
                              <>
                                actual <strong className="text-ink">{e.actual}</strong> ·{" "}
                              </>
                            )}
                            {e.forecast && <>prev. {e.forecast} · </>}
                            {e.previous && <>prec. {e.previous}</>}
                          </span>
                        </div>
                        {note && (
                          <p className="mt-1.5 rounded-lg bg-brand-soft px-3 py-1.5 text-xs text-brand-ink">
                            ★ Rilevante per il tuo portafoglio — {note}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </div>
      )}

      <p className="mt-6 text-center text-xs text-faint">
        {cache && <>Ultimo aggiornamento: {fmtDateTime(cache.fetchedAt)} · </>}
        Fonte: feed pubblico Forex Factory. Dati di terze parti, orari indicativi convertiti in
        ora italiana.
      </p>
    </div>
  );
}

function FilterChip({
  active,
  tone,
  onClick,
  children,
}: {
  active: boolean;
  tone: "neg" | "warn" | "neutral" | "accent";
  onClick: () => void;
  children: React.ReactNode;
}) {
  const activeStyles = {
    neg: "bg-neg text-white border-neg",
    warn: "bg-warn text-white border-warn",
    neutral: "bg-overlay text-white border-overlay",
    accent: "bg-accent text-white border-accent",
  };
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-8 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active ? activeStyles[tone] : "border-line-strong bg-surface text-soft hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
