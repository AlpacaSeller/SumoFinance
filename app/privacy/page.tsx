"use client";

// ── Privacy e termini: la promessa local-first spiegata per esteso ──────────
// Pagina statica di fiducia per chi riceve il link all'app: dove vivono i
// dati, cosa transita in rete e cosa l'app NON è (consulenza finanziaria).

import { Database, Globe2, Scale, ShieldCheck, Trash2, WifiOff } from "lucide-react";
import { Card, PageHeader } from "@/components/ui";
import { SumoMascot } from "@/components/Mascot";

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Privacy e termini"
        subtitle="La versione breve: i tuoi dati non lasciano mai il tuo dispositivo."
        actions={<SumoMascot size={52} />}
      />

      <div className="flex flex-col gap-4">
        <Card title="Dove vivono i tuoi dati">
          <div className="flex items-start gap-3 text-sm text-soft">
            <Database className="mt-0.5 size-5 shrink-0 text-brand-ink" aria-hidden />
            <div className="flex flex-col gap-2">
              <p>
                Tutto ciò che inserisci — conti, movimenti, investimenti, obiettivi — è salvato{" "}
                <strong className="text-ink">solo nel browser di questo dispositivo</strong>{" "}
                (IndexedDB). Non esistono account, server con i tuoi dati o database remoti:
                nessuno può leggerli, nemmeno chi gestisce l&apos;app.
              </p>
              <p>
                Il rovescio della medaglia: i dati non ti seguono da soli su altri dispositivi
                e spariscono se cancelli i dati di navigazione del sito.{" "}
                <strong className="text-ink">Il backup (Impostazioni → Backup) è tuo amico</strong>:
                esportalo regolarmente, anche in versione cifrata con passphrase (AES-256).
              </p>
            </div>
          </div>
        </Card>

        <Card title="Cosa transita in rete">
          <div className="flex items-start gap-3 text-sm text-soft">
            <Globe2 className="mt-0.5 size-5 shrink-0 text-brand-ink" aria-hidden />
            <div className="flex flex-col gap-2">
              <p>
                Solo richieste <strong className="text-ink">anonime e generiche di mercato</strong>:
                ticker e simboli per aggiornare i prezzi (CoinGecko, Yahoo Finance, Twelve Data,
                cambi BCE via Frankfurter), indirizzi pubblici dei wallet che scegli di tracciare
                on-chain e il feed del calendario economico. Mai importi, saldi, nomi o altri
                dati personali.
              </p>
              <p>
                Le due API interne dell&apos;app (<code className="text-xs">/api/quote</code>,{" "}
                <code className="text-xs">/api/economic-calendar</code>) sono proxy di sola
                lettura senza stato: non registrano né conservano nulla.
              </p>
            </div>
          </div>
        </Card>

        <Card title="Niente tracciamento">
          <div className="flex items-start gap-3 text-sm text-soft">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand-ink" aria-hidden />
            <p>
              Nessun cookie di profilazione, nessun analytics, nessuna pubblicità, nessun
              tracciante di terze parti. L&apos;app usa solo lo storage locale tecnico
              indispensabile (preferenza del tema, stato di sblocco del PIN).
            </p>
          </div>
        </Card>

        <Card title="Cancellare tutto">
          <div className="flex items-start gap-3 text-sm text-soft">
            <Trash2 className="mt-0.5 size-5 shrink-0 text-brand-ink" aria-hidden />
            <p>
              Sei sempre a un click dalla cancellazione completa:{" "}
              <strong className="text-ink">Impostazioni → Backup e dati → Cancella tutto</strong>{" "}
              elimina ogni dato dal dispositivo, senza residui altrove — perché altrove non
              c&apos;è mai stato nulla.
            </p>
          </div>
        </Card>

        <Card title="Offline e PIN">
          <div className="flex items-start gap-3 text-sm text-soft">
            <WifiOff className="mt-0.5 size-5 shrink-0 text-brand-ink" aria-hidden />
            <p>
              L&apos;app funziona anche offline (si aggiornano solo i prezzi quando torni in
              rete). Il PIN opzionale protegge da occhi indiscreti sul tuo dispositivo: è una
              barriera di cortesia, non crittografia dei dati — per quella usa l&apos;export
              cifrato.
            </p>
          </div>
        </Card>

        <Card title="Termini d'uso">
          <div className="flex items-start gap-3 text-sm text-soft">
            <Scale className="mt-0.5 size-5 shrink-0 text-brand-ink" aria-hidden />
            <div className="flex flex-col gap-2">
              <p>
                Sumo Finance è uno strumento personale di organizzazione:{" "}
                <strong className="text-ink">
                  non fornisce consulenza finanziaria, fiscale o d&apos;investimento
                </strong>
                . Le analisi si basano solo sui tuoi dati e su medie storiche; le stime fiscali
                sono semplificate e non sostituiscono un commercialista. I prezzi di mercato
                provengono da fonti gratuite di terze parti e possono essere ritardati o
                imprecisi.
              </p>
              <p>
                L&apos;app è offerta così com&apos;è, senza garanzie. Il codice è consultabile
                su GitHub; tutti i diritti riservati.
              </p>
            </div>
          </div>
        </Card>

        <p className="pb-4 text-center text-xs text-faint">
          Ultimo aggiornamento: luglio 2026 · Sumo Finance
        </p>
      </div>
    </div>
  );
}
