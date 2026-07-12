"use client";

// ── Command palette (Ctrl/Cmd+K) ────────────────────────────────────────────
// Salto rapido a pagine, asset e azioni. Su desktop via scorciatoia, su mobile
// dall'icona di ricerca nell'header.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  CalendarDays,
  Coins,
  Globe2,
  Landmark,
  LayoutDashboard,
  Lightbulb,
  LineChart,
  Plus,
  Receipt,
  Repeat,
  Search,
  Settings,
  Target,
  TrendingDown,
  Wallet,
} from "lucide-react";
import { useTable } from "@/lib/storage";
import type { Asset } from "@/lib/types";
import { assetValue } from "@/lib/engine/aggregates";
import { fmtEUR0 } from "@/lib/format";

interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  keywords?: string;
  run: () => void;
}

interface PaletteContextValue {
  open: () => void;
}
const PaletteContext = createContext<PaletteContextValue>({ open: () => {} });
export function useCommandPalette() {
  return useContext(PaletteContext);
}

const PAGES: { href: string; label: string; icon: ReactNode; keywords: string }[] = [
  { href: "/", label: "Dashboard", icon: <LayoutDashboard />, keywords: "home panoramica" },
  { href: "/consigli", label: "Consigli", icon: <Lightbulb />, keywords: "advisor analisi" },
  { href: "/conti", label: "Conti & liquidità", icon: <Wallet />, keywords: "banca saldo" },
  { href: "/investimenti", label: "Investimenti", icon: <LineChart />, keywords: "asset etf crypto azioni" },
  { href: "/debiti", label: "Debiti", icon: <Landmark />, keywords: "mutuo prestito" },
  { href: "/entrate", label: "Entrate", icon: <Coins />, keywords: "stipendio income" },
  { href: "/uscite", label: "Uscite & budget", icon: <TrendingDown />, keywords: "spese budget" },
  { href: "/abbonamenti", label: "Abbonamenti", icon: <Repeat />, keywords: "netflix subscription" },
  { href: "/simulazioni", label: "Simulazioni & FIRE", icon: <BarChart3 />, keywords: "montecarlo whatif pensione" },
  { href: "/obiettivi", label: "Obiettivi", icon: <Target />, keywords: "goal risparmio" },
  { href: "/tasse", label: "Tasse", icon: <Receipt />, keywords: "fisco zainetto plusvalenza" },
  { href: "/calendario", label: "Calendario finanziario", icon: <CalendarDays />, keywords: "scadenze rate" },
  { href: "/calendario-economico", label: "Calendario economico", icon: <Globe2 />, keywords: "bce fed cpi macro" },
  { href: "/impostazioni", label: "Impostazioni", icon: <Settings />, keywords: "backup pin tema" },
];

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const assets = useTable<Asset>("assets");

  const open = useMemo(() => () => setIsOpen(true), []);
  const close = () => {
    setIsOpen(false);
    setQuery("");
    setActive(0);
  };

  // scorciatoia globale Ctrl/Cmd+K
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsOpen((v) => !v);
      }
      if (e.key === "Escape") setIsOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (isOpen) requestAnimationFrame(() => inputRef.current?.focus());
  }, [isOpen]);

  const items: CommandItem[] = useMemo(() => {
    const nav: CommandItem[] = PAGES.map((p) => ({
      id: `page:${p.href}`,
      label: p.label,
      hint: "Vai a",
      icon: p.icon,
      keywords: p.keywords,
      run: () => router.push(p.href),
    }));
    const quickNew = (page: string) => () => {
      try {
        sessionStorage.setItem("pfos-open-new", "1");
      } catch {
        // storage non disponibile: si aprirà comunque la pagina
      }
      router.push(page);
    };
    const actions: CommandItem[] = [
      {
        id: "act:new-expense",
        label: "Nuova uscita",
        hint: "Azione",
        icon: <Plus />,
        keywords: "spesa aggiungi",
        run: quickNew("/uscite"),
      },
      {
        id: "act:new-income",
        label: "Nuova entrata",
        hint: "Azione",
        icon: <Plus />,
        keywords: "stipendio aggiungi",
        run: quickNew("/entrate"),
      },
      {
        id: "act:new-asset",
        label: "Nuovo asset",
        hint: "Azione",
        icon: <Plus />,
        keywords: "investimento aggiungi",
        run: quickNew("/investimenti"),
      },
    ];
    const assetItems: CommandItem[] = (assets ?? []).map((a) => ({
      id: `asset:${a.id}`,
      label: a.name,
      hint: `${a.assetClass} · ${fmtEUR0(assetValue(a))}`,
      icon: <LineChart />,
      keywords: `${a.ticker ?? ""} ${a.assetClass}`,
      run: () => router.push(`/investimenti/${a.id}`),
    }));
    return [...nav, ...actions, ...assetItems];
  }, [assets, router]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 8);
    const scored = items
      .map((it) => {
        const hay = `${it.label} ${it.keywords ?? ""}`.toLowerCase();
        const idx = hay.indexOf(q);
        return { it, score: idx < 0 ? -1 : it.label.toLowerCase().startsWith(q) ? 0 : idx + 1 };
      })
      .filter((x) => x.score >= 0)
      .sort((a, b) => a.score - b.score);
    return scored.slice(0, 12).map((x) => x.it);
  }, [items, query]);

  function choose(item: CommandItem) {
    close();
    item.run();
  }

  return (
    <PaletteContext.Provider value={{ open }}>
      {children}
      {isOpen && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center px-4 pt-[12vh]">
          <div className="absolute inset-0 bg-ink/40" onClick={close} aria-hidden />
          <div
            role="dialog"
            aria-label="Ricerca comandi"
            className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
          >
            <div className="flex items-center gap-2 border-b border-line px-4">
              <Search className="size-4 shrink-0 text-faint" aria-hidden />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActive((a) => Math.min(filtered.length - 1, a + 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive((a) => Math.max(0, a - 1));
                  } else if (e.key === "Enter" && filtered[active]) {
                    e.preventDefault();
                    choose(filtered[active]);
                  }
                }}
                placeholder="Cerca pagine, asset, azioni…"
                aria-label="Cerca"
                className="min-h-12 flex-1 bg-transparent py-3 text-sm text-ink outline-none placeholder:text-faint"
              />
              <kbd className="hidden rounded border border-line px-1.5 py-0.5 text-[10px] text-faint sm:inline">
                Esc
              </kbd>
            </div>
            <ul className="max-h-80 overflow-y-auto p-2">
              {filtered.length === 0 ? (
                <li className="px-3 py-6 text-center text-sm text-faint">Nessun risultato</li>
              ) : (
                filtered.map((it, i) => (
                  <li key={it.id}>
                    <button
                      onMouseEnter={() => setActive(i)}
                      onClick={() => choose(it)}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm [&>svg]:size-4 ${
                        i === active ? "bg-brand-soft text-brand-ink" : "text-ink hover:bg-surface-2"
                      }`}
                    >
                      {it.icon}
                      <span className="flex-1 truncate">{it.label}</span>
                      {it.hint && <span className="shrink-0 text-xs text-faint">{it.hint}</span>}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      )}
    </PaletteContext.Provider>
  );
}
