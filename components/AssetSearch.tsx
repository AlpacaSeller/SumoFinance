"use client";

// ── Ricerca asset con autocompletamento ─────────────────────────────────────
// Cerchi "appl" → compare Apple; selezionandolo, il form si compila da solo.

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { searchAssets, type AssetSearchResult } from "@/lib/prices/search";
import { Badge } from "./ui";
import { inputClass } from "./ui";

export function AssetSearch({ onSelect }: { onSelect: (r: AssetSearchResult) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AssetSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    const controller = new AbortController();
    const t = setTimeout(async () => {
      if (q.length < 2) {
        setResults([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      const res = await searchAssets(q, controller.signal);
      setResults(res);
      setActive(0);
      setLoading(false);
      setOpen(true);
    }, 280); // debounce
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [query]);

  // chiusura al click fuori
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function choose(r: AssetSearchResult) {
    onSelect(r);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  const showDropdown = useMemo(
    () => open && (loading || results.length > 0 || query.trim().length >= 2),
    [open, loading, results.length, query]
  );

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-faint" />
        )}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onKeyDown={(e) => {
            if (!showDropdown) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(results.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter" && results[active]) {
              e.preventDefault();
              choose(results[active]);
            }
          }}
          placeholder="Cerca per nome, ticker o ISIN: es. Apple, VWCE, IE00BK5BQT80…"
          aria-label="Cerca un asset"
          className={`${inputClass} !pl-9`}
        />
      </div>
      {showDropdown && (
        <ul className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-xl">
          {results.length === 0 && !loading ? (
            <li className="px-3 py-4 text-center text-sm text-faint">
              Nessun risultato. Puoi comunque compilare i campi a mano.
            </li>
          ) : (
            results.map((r, i) => (
              <li key={r.id}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(r)}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                    i === active ? "bg-brand-soft" : "hover:bg-surface-2"
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{r.name}</span>
                    <span className="tnum text-xs text-faint">
                      {r.ticker}
                      {r.exchange ? ` · ${r.exchange}` : ""}
                    </span>
                  </span>
                  <Badge tone={r.assetClass === "Crypto" ? "accent" : "brand"}>{r.assetClass}</Badge>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
