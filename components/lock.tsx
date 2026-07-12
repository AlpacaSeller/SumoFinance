"use client";

// ── Blocco PIN ──────────────────────────────────────────────────────────────
// Schermata di sblocco all'avvio se il PIN è attivo, blocco manuale dal
// lucchetto. Il PIN protegge da occhi indiscreti sul dispositivo: non è
// crittografia dei dati (dichiarato in Impostazioni).

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Lock } from "lucide-react";
import { useTable } from "@/lib/storage";
import type { Settings } from "@/lib/types";
import { isUnlocked, setUnlocked, subscribeUnlock, verifyPin } from "@/lib/pin";

interface LockContextValue {
  pinEnabled: boolean;
  lock: () => void;
}

const LockContext = createContext<LockContextValue>({ pinEnabled: false, lock: () => {} });

export function useLock() {
  return useContext(LockContext);
}

export function LockGate({ children }: { children: ReactNode }) {
  const settingsRows = useTable<Settings>("settings");
  const settings = settingsRows?.find((s) => s.id === "main");
  // stato di sblocco derivato da sessionStorage (fonte esterna)
  const unlocked = useSyncExternalStore(subscribeUnlock, isUnlocked, () => true);

  const lock = useCallback(() => {
    setUnlocked(false);
  }, []);

  const value = useMemo(
    () => ({ pinEnabled: Boolean(settings?.pinHash), lock }),
    [settings?.pinHash, lock]
  );

  if (settingsRows === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <div className="font-display text-2xl font-semibold text-brand-ink">Sumo Finance</div>
      </div>
    );
  }

  if (settings?.pinHash && settings.pinSalt && !unlocked) {
    return (
      <LockScreen
        pinHash={settings.pinHash}
        pinSalt={settings.pinSalt}
        onUnlock={() => setUnlocked(true)}
      />
    );
  }

  return <LockContext.Provider value={value}>{children}</LockContext.Provider>;
}

function LockScreen({
  pinHash,
  pinSalt,
  onUnlock,
}: {
  pinHash: string;
  pinSalt: string;
  onUnlock: () => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (await verifyPin(pin, pinSalt, pinHash)) {
      onUnlock();
    } else {
      setError(true);
      setPin("");
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-brand px-6">
      <div className="flex flex-col items-center gap-2">
        <div className="font-display text-4xl font-semibold text-white">Sumo Finance</div>
        <p className="text-sm text-white/70">Il tuo sistema operativo finanziario</p>
      </div>
      <form
        onSubmit={submit}
        className="flex w-full max-w-xs flex-col items-center gap-4 rounded-2xl bg-white/10 p-6"
      >
        <Lock className="size-6 text-white/80" aria-hidden />
        <input
          type="password"
          inputMode="numeric"
          pattern="\d{4}"
          maxLength={4}
          autoFocus
          value={pin}
          onChange={(e) => {
            setPin(e.target.value.replace(/\D/g, ""));
            setError(false);
          }}
          aria-label="PIN a 4 cifre"
          placeholder="••••"
          className="w-40 rounded-xl border border-white/30 bg-white/10 px-4 py-3 text-center text-2xl tracking-[0.5em] text-white placeholder:text-white/40 focus:border-white"
        />
        {error && (
          <p role="alert" className="text-sm text-red-200">
            PIN errato, riprova.
          </p>
        )}
        <button
          type="submit"
          disabled={pin.length !== 4}
          className="min-h-11 w-full rounded-xl bg-white font-semibold text-brand transition-opacity disabled:opacity-40"
        >
          Entra
        </button>
        <p className="text-center text-xs text-white/60">
          Il PIN protegge da occhi indiscreti su questo dispositivo.
        </p>
      </form>
    </div>
  );
}
