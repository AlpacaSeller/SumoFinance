"use client";

// ── Rete di sicurezza: un errore runtime non deve mai lasciare lo schermo
// bianco. I dati sono al sicuro in IndexedDB; da qui si può ricaricare o
// esportare subito un backup di emergenza.

import { useEffect } from "react";
import { Download, RotateCcw } from "lucide-react";
import { storage } from "@/lib/storage";
import { SumoMascot } from "@/components/Mascot";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Sumo Finance error boundary:", error);
  }, [error]);

  async function emergencyBackup() {
    try {
      const backup = await storage.exportAll();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sumo-backup-emergenza-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // se anche l'export fallisce, resta il reload
    }
  }

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <SumoMascot size={88} className="opacity-90" />
      <h1 className="font-display text-2xl font-semibold text-ink">
        Il sumo è scivolato
      </h1>
      <p className="max-w-md text-sm text-soft">
        Si è verificato un errore imprevisto in questa pagina. <strong>I tuoi dati sono al
        sicuro</strong> nel browser: riprova, oppure esporta subito un backup di emergenza.
      </p>
      {error?.message && (
        <code className="max-w-md truncate rounded-lg bg-surface-2 px-3 py-1.5 text-xs text-faint">
          {error.message}
        </code>
      )}
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <button
          onClick={() => reset()}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-2"
        >
          <RotateCcw className="size-4" /> Riprova
        </button>
        <button
          onClick={emergencyBackup}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-ink hover:bg-surface-2"
        >
          <Download className="size-4" /> Backup di emergenza
        </button>
      </div>
    </div>
  );
}
