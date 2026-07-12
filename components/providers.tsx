"use client";

// ── Provider globali: toast, attività di avvio, blocco PIN ─────────────────

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ToastProvider, useToast, type ToastOptions } from "./toast";
import { LockGate } from "./lock";
import { ThemeProvider } from "./theme";
import { CommandPaletteProvider } from "./CommandPalette";
import { runBootTasks, backupReminderDue, pruneStalePriceHistory } from "@/lib/boot";
import { autoSyncIfDue, refreshAccountRates } from "@/lib/prices/sync";
import { runAutoBackup } from "@/lib/autobackup";
import { todayISO } from "@/lib/format";

let lastBootDate = ""; // giorno dell'ultima esecuzione delle attività di avvio

type Toast = (message: string, opts?: ToastOptions) => void;

/** Attività "giornaliere": ricorrenti, snapshot, sync, backup, promemoria.
 *  Idempotenti: rieseguirle nello stesso giorno non produce duplicati. */
async function runDailyTasks(showToast: Toast, goToBackup: () => void) {
  lastBootDate = todayISO();
  const res = await runBootTasks();
  if (res.registered > 0) {
    showToast(
      res.registered === 1
        ? "1 movimento ricorrente registrato"
        : `${res.registered} movimenti ricorrenti registrati`,
      { kind: "success" }
    );
  }
  // sync prezzi, cambi valuta e backup automatico: in background
  autoSyncIfDue().catch(() => {});
  refreshAccountRates().catch(() => {});
  pruneStalePriceHistory().catch(() => {});
  runAutoBackup().then((r) => {
    if (r.status === "permission-needed") {
      showToast(
        `Backup automatico in pausa: serve la tua conferma per scrivere in "${r.dirName}"`,
        {
          duration: 12000,
          actionLabel: "Riattiva",
          action: async () => {
            const retry = await runAutoBackup({ requestPermission: true, force: true });
            showToast(
              retry.status === "done"
                ? `Backup automatico ripristinato (${retry.fileName})`
                : "Non è stato possibile riattivare il backup: controlla in Impostazioni",
              { kind: retry.status === "done" ? "success" : "error" }
            );
          },
        }
      );
    } else if (r.status === "done") {
      showToast(`Backup automatico salvato in "${r.dirName}"`, { kind: "success" });
    }
  });
  backupReminderDue().then((due) => {
    if (due) {
      showToast("È da un po' che non fai un backup dei tuoi dati", {
        duration: 8000,
        actionLabel: "Vai al backup",
        action: goToBackup,
      });
    }
  });
}

function BootTasks({ children }: { children: ReactNode }) {
  const { showToast } = useToast();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      try {
        if (lastBootDate !== todayISO()) {
          await runDailyTasks(showToast, () => router.push("/impostazioni#backup"));
        }
      } finally {
        setReady(true);
      }
    })();
  }, [showToast, router]);

  // La PWA su iPhone resta viva per giorni senza ricaricarsi: quando torna
  // visibile in un giorno nuovo, riesegui le attività giornaliere.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== "visible") return;
      if (lastBootDate && lastBootDate !== todayISO()) {
        runDailyTasks(showToast, () => router.push("/impostazioni#backup")).catch(() => {});
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [showToast, router]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <div className="font-display text-2xl font-semibold text-brand-ink">PFOS</div>
      </div>
    );
  }
  return <>{children}</>;
}

function ServiceWorkerRegistrar() {
  const { showToast } = useToast();
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      process.env.NODE_ENV !== "production"
    ) {
      return;
    }

    let refreshing = false;
    // quando il nuovo SW prende il controllo, ricarica una sola volta
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    function promptUpdate(worker: ServiceWorker) {
      showToast("È disponibile una nuova versione di PFOS", {
        duration: 20000,
        actionLabel: "Aggiorna",
        action: () => worker.postMessage({ type: "SKIP_WAITING" }),
      });
    }

    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        // un aggiornamento è già in attesa all'avvio
        if (reg.waiting && navigator.serviceWorker.controller) {
          promptUpdate(reg.waiting);
        }
        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            // installato mentre esiste già un controller = è un aggiornamento
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              promptUpdate(installing);
            }
          });
        });
      })
      .catch(() => {});
  }, [showToast]);
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <ToastProvider>
        <ServiceWorkerRegistrar />
        <BootTasks>
          <LockGate>
            <CommandPaletteProvider>{children}</CommandPaletteProvider>
          </LockGate>
        </BootTasks>
      </ToastProvider>
    </ThemeProvider>
  );
}
