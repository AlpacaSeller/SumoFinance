"use client";

// ── Toast con azione "Annulla" ──────────────────────────────────────────────
// Ogni eliminazione nell'app passa da useUndoableDelete: il dato viene rimosso
// subito, ma il toast permette di ripristinarlo per alcuni secondi.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { storage, type TableName } from "@/lib/storage";

export interface ToastOptions {
  kind?: "info" | "success" | "error";
  duration?: number; // ms
  undo?: () => void | Promise<void>;
  actionLabel?: string;
  action?: () => void;
}

interface ToastItem extends ToastOptions {
  id: number;
  message: string;
}

interface ToastContextValue {
  showToast: (message: string, opts?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

/** Elimina una riga con possibilità di annullo (la riga viene ripristinata). */
export function useUndoableDelete() {
  const { showToast } = useToast();
  return useCallback(
    async <T extends { id: string }>(table: TableName, item: T, label: string) => {
      await storage.remove(table, item.id);
      showToast(`${label} eliminato`, {
        kind: "info",
        duration: 6000,
        undo: async () => {
          await storage.put(table, item);
        },
      });
    },
    [showToast]
  );
}

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const showToast = useCallback(
    (message: string, opts?: ToastOptions) => {
      const id = nextId++;
      const item: ToastItem = { id, message, ...opts };
      setToasts((t) => [...t.slice(-2), item]);
      const timer = setTimeout(() => dismiss(id), opts?.duration ?? 4500);
      timers.current.set(id, timer);
    },
    [dismiss]
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) clearTimeout(timer);
    };
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[70] flex flex-col items-center gap-2 px-4 lg:bottom-6"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg transition-all ${
              t.kind === "error"
                ? "border-neg/30 bg-neg-soft text-neg"
                : t.kind === "success"
                  ? "border-pos/30 bg-pos-soft text-pos"
                  : "border-line bg-overlay text-white"
            }`}
          >
            <span className="flex-1">{t.message}</span>
            {t.undo && (
              <button
                className="shrink-0 rounded-lg px-2 py-1 font-semibold underline underline-offset-2 hover:opacity-80"
                onClick={async () => {
                  await t.undo?.();
                  dismiss(t.id);
                }}
              >
                Annulla
              </button>
            )}
            {t.action && t.actionLabel && (
              <button
                className="shrink-0 rounded-lg px-2 py-1 font-semibold underline underline-offset-2 hover:opacity-80"
                onClick={() => {
                  t.action?.();
                  dismiss(t.id);
                }}
              >
                {t.actionLabel}
              </button>
            )}
            <button
              aria-label="Chiudi notifica"
              className="shrink-0 opacity-60 hover:opacity-100"
              onClick={() => dismiss(t.id)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
