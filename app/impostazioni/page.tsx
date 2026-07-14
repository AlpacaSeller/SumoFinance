"use client";

// ── Impostazioni ────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FolderSync, KeyRound, Link2, Lock, Smartphone, Upload } from "lucide-react";
import { useFinancial } from "@/lib/useFinancial";
import { storage } from "@/lib/storage";
import {
  autoBackupSupported,
  chooseBackupDir,
  disableAutoBackup,
  getBackupDir,
  runAutoBackup,
} from "@/lib/autobackup";
import {
  decryptBackup,
  encryptBackup,
  isEncryptedBackup,
  type EncryptedBackupFile,
} from "@/lib/cryptoBackup";
import { ASSET_CLASSES, type AssetClass, type BackupFile, type RiskProfile, type Settings } from "@/lib/types";
import { hashPin, randomSalt, setUnlocked, verifyPin } from "@/lib/pin";
import {
  connectSync,
  createSync,
  disconnectSync,
  formatSyncCode,
  lastSyncAt,
  pushSync,
} from "@/lib/sync";
import { disablePush, enablePush, pushLocallyEnabled, pushNeedsInstall, pushSupported } from "@/lib/push";
import { fmtDateTime, fmtNum, parseItAmount } from "@/lib/format";
import { useToast } from "@/components/toast";
import { useTheme, type ThemePreference } from "@/components/theme";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  LoadingState,
  Modal,
  ModalFooter,
  PageHeader,
  Segmented,
  Select,
} from "@/components/ui";

const PROFILE_HELP: Record<RiskProfile, string> = {
  prudente:
    "Soglie severe: allerta concentrazione oltre il 20%, quota crypto oltre il 5%.",
  bilanciato:
    "Soglie intermedie: allerta concentrazione oltre il 25%, quota crypto oltre il 12%.",
  dinamico:
    "Soglie permissive: allerta concentrazione oltre il 30%, quota crypto oltre il 25%.",
};

export default function ImpostazioniPage() {
  const { ready, data } = useFinancial();
  const { showToast } = useToast();
  const s = data.settings;

  if (!ready) return <LoadingState />;

  async function update(patch: Partial<Settings>) {
    await storage.put("settings", { ...s, ...patch });
  }

  return (
    <div>
      <PageHeader title="Impostazioni" />
      <div className="flex flex-col gap-6">
        <AppearanceSection />
        <ProfileSection settings={s} update={update} />
        <TargetAllocationSection settings={s} update={update} />
        <SyncSection settings={s} update={update} />
        <AiSection settings={s} update={update} />
        <SecuritySection settings={s} update={update} showToast={showToast} />
        <BackupSection settings={s} update={update} />
        <DeviceSyncSection settings={s} />
        <PushSection />
        <Card title="App sul telefono" subtitle="Sumo Finance è una PWA installabile">
          <div className="flex items-start gap-3 text-sm text-soft">
            <Smartphone className="mt-0.5 size-5 shrink-0 text-brand-ink" />
            <div>
              <p>
                <strong className="text-ink">iPhone/iPad:</strong> apri Sumo Finance in Safari →
                condividi <span className="tnum">⎋</span> → &quot;Aggiungi a Home&quot;.
              </p>
              <p className="mt-1">
                <strong className="text-ink">Android:</strong> apri Sumo Finance in Chrome → menu ⋮ →
                &quot;Aggiungi a schermata Home&quot; (o &quot;Installa app&quot;).
              </p>
              <p className="mt-2 text-xs text-faint">
                Attenzione: i dati vivono nel browser di ciascun dispositivo. Per portarli sul
                telefono usa Esporta/Importa backup qui sotto.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ── Aspetto ─────────────────────────────────────────────────────────────────

function AppearanceSection() {
  const { preference, setPreference } = useTheme();
  return (
    <Card title="Aspetto" subtitle="«Sistema» segue il tema del dispositivo">
      <Segmented<ThemePreference>
        options={[
          { value: "light", label: "Chiaro" },
          { value: "dark", label: "Scuro" },
          { value: "system", label: "Sistema" },
        ]}
        value={preference}
        onChange={setPreference}
        size="md"
      />
    </Card>
  );
}

// ── Profilo finanziario ─────────────────────────────────────────────────────

function ProfileSection({
  settings: s,
  update,
}: {
  settings: Settings;
  update: (p: Partial<Settings>) => Promise<void>;
}) {
  return (
    <Card title="Profilo finanziario">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Profilo di rischio" hint={PROFILE_HELP[s.riskProfile]}>
          <Select
            value={s.riskProfile}
            onChange={(e) => update({ riskProfile: e.target.value as RiskProfile })}
          >
            <option value="prudente">prudente</option>
            <option value="bilanciato">bilanciato</option>
            <option value="dinamico">dinamico</option>
          </Select>
        </Field>
        <Field label="Tasso di prelievo FIRE (%)" hint="Quota del capitale prelevabile ogni anno">
          <Input
            inputMode="decimal"
            defaultValue={String(s.fireWithdrawalRate).replace(".", ",")}
            onBlur={(e) => {
              const v = parseItAmount(e.target.value);
              if (v != null && v > 0 && v <= 20) update({ fireWithdrawalRate: v });
            }}
          />
        </Field>
        <Field label="Inflazione attesa (%)" hint="Usata nei consigli sulla liquidità ferma">
          <Input
            inputMode="decimal"
            defaultValue={String(s.expectedInflation).replace(".", ",")}
            onBlur={(e) => {
              const v = parseItAmount(e.target.value);
              if (v != null && v >= 0 && v <= 30) update({ expectedInflation: v });
            }}
          />
        </Field>
      </div>
    </Card>
  );
}

// ── Allocazione target ──────────────────────────────────────────────────────

function TargetAllocationSection({
  settings: s,
  update,
}: {
  settings: Settings;
  update: (p: Partial<Settings>) => Promise<void>;
}) {
  const { showToast } = useToast();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      ASSET_CLASSES.map((c) => [c, s.targetAllocation?.[c] != null ? String(s.targetAllocation[c]) : ""])
    )
  );

  async function save() {
    const target: Partial<Record<AssetClass, number>> = {};
    let sum = 0;
    for (const c of ASSET_CLASSES) {
      const v = parseItAmount(values[c] ?? "");
      if (v != null && v > 0) {
        target[c] = v;
        sum += v;
      }
    }
    if (Object.keys(target).length === 0) {
      await update({ targetAllocation: undefined });
      showToast("Allocazione target rimossa", { kind: "success" });
      return;
    }
    if (Math.abs(sum - 100) > 1) {
      showToast(`Le percentuali sommano a ${fmtNum(sum, 0)}%: devono fare 100%`, {
        kind: "error",
      });
      return;
    }
    await update({ targetAllocation: target });
    showToast("Allocazione target salvata: i consigli di ribilanciamento sono attivi", {
      kind: "success",
    });
  }

  return (
    <Card
      title="Allocazione target (opzionale)"
      subtitle="Percentuale desiderata per classe: se una classe devia oltre ±5 punti, ricevi un consiglio di ribilanciamento"
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {ASSET_CLASSES.map((c) => (
          <Field key={c} label={`${c} (%)`}>
            <Input
              inputMode="decimal"
              value={values[c] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [c]: e.target.value }))}
              placeholder="—"
            />
          </Field>
        ))}
      </div>
      <div className="mt-4 flex justify-end">
        <Button variant="outline" onClick={save}>
          Salva allocazione
        </Button>
      </div>
    </Card>
  );
}

// ── Sincronizzazione prezzi ─────────────────────────────────────────────────

function SyncSection({
  settings: s,
  update,
}: {
  settings: Settings;
  update: (p: Partial<Settings>) => Promise<void>;
}) {
  const { showToast } = useToast();
  const [key, setKey] = useState(s.twelveDataApiKey ?? "");
  return (
    <Card title="Sincronizzazione prezzi">
      <div className="flex flex-col gap-4">
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={s.syncOnOpen}
            onChange={(e) => update({ syncOnOpen: e.target.checked })}
            className="size-4 accent-brand"
          />
          <span>
            Sincronizza all&apos;apertura <span className="text-faint">(max ogni 6 ore, per rispettare i limiti gratuiti)</span>
          </span>
        </label>
        {s.lastPriceSyncAt && (
          <p className="text-xs text-faint">Ultima sincronizzazione: {fmtDateTime(s.lastPriceSyncAt)}</p>
        )}
        <div className="rounded-xl bg-surface-2 p-4">
          <Field
            label="Chiave API Twelve Data (opzionale)"
            hint="Gratuita (800 richieste/giorno) su twelvedata.com → Sign up → API key. Usata come fallback automatico quando Yahoo fallisce, o come provider scelto per singolo asset."
          >
            <div className="flex gap-2">
              <Input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="la tua chiave…"
                autoComplete="off"
              />
              <Button
                variant="outline"
                onClick={async () => {
                  await update({ twelveDataApiKey: key.trim() || undefined });
                  showToast(key.trim() ? "Chiave salvata" : "Chiave rimossa", { kind: "success" });
                }}
              >
                Salva
              </Button>
            </div>
          </Field>
        </div>
      </div>
    </Card>
  );
}

// ── Sicurezza (PIN) ─────────────────────────────────────────────────────────

function SecuritySection({
  settings: s,
  update,
  showToast,
}: {
  settings: Settings;
  update: (p: Partial<Settings>) => Promise<void>;
  showToast: (msg: string, opts?: { kind?: "info" | "success" | "error" }) => void;
}) {
  const [modal, setModal] = useState<"attiva" | "cambia" | "disattiva" | null>(null);
  const pinActive = Boolean(s.pinHash);

  return (
    <Card
      title="Sicurezza"
      subtitle="Il PIN protegge da occhi indiscreti su questo dispositivo: non è crittografia dei dati"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={pinActive ? "pos" : "neutral"}>
          <Lock className="size-3" /> PIN {pinActive ? "attivo" : "non attivo"}
        </Badge>
        {!pinActive ? (
          <Button variant="outline" onClick={() => setModal("attiva")}>
            Attiva PIN
          </Button>
        ) : (
          <>
            <Button variant="outline" onClick={() => setModal("cambia")}>
              Cambia PIN
            </Button>
            <Button variant="outline" onClick={() => setModal("disattiva")}>
              Disattiva PIN
            </Button>
          </>
        )}
      </div>
      {modal && (
        <PinModal
          mode={modal}
          settings={s}
          onClose={() => setModal(null)}
          onDone={async (patch, msg) => {
            await update(patch);
            showToast(msg, { kind: "success" });
            setModal(null);
          }}
        />
      )}
    </Card>
  );
}

function PinModal({
  mode,
  settings: s,
  onClose,
  onDone,
}: {
  mode: "attiva" | "cambia" | "disattiva";
  settings: Settings;
  onClose: () => void;
  onDone: (patch: Partial<Settings>, msg: string) => Promise<void>;
}) {
  const { showToast } = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode !== "attiva") {
      if (!s.pinHash || !s.pinSalt || !(await verifyPin(current, s.pinSalt, s.pinHash))) {
        showToast("PIN attuale errato", { kind: "error" });
        return;
      }
    }
    if (mode === "disattiva") {
      await onDone({ pinHash: undefined, pinSalt: undefined }, "PIN disattivato");
      return;
    }
    if (!/^\d{4}$/.test(next)) {
      showToast("Il PIN deve essere di 4 cifre", { kind: "error" });
      return;
    }
    if (next !== confirm) {
      showToast("I due PIN non coincidono", { kind: "error" });
      return;
    }
    const salt = randomSalt();
    const hash = await hashPin(next, salt);
    setUnlocked(true); // non bloccare subito chi lo ha appena attivato
    await onDone(
      { pinHash: hash, pinSalt: salt },
      mode === "attiva" ? "PIN attivato: usa il lucchetto in alto per bloccare" : "PIN cambiato"
    );
  }

  const pinInput = (value: string, onChange: (v: string) => void, label: string) => (
    <Field label={label}>
      <Input
        type="password"
        inputMode="numeric"
        maxLength={4}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
        placeholder="••••"
        className="tnum tracking-[0.4em]"
      />
    </Field>
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={
        mode === "attiva" ? "Attiva PIN" : mode === "cambia" ? "Cambia PIN" : "Disattiva PIN"
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {mode !== "attiva" && pinInput(current, setCurrent, "PIN attuale")}
        {mode !== "disattiva" && (
          <>
            {pinInput(next, setNext, "Nuovo PIN (4 cifre)")}
            {pinInput(confirm, setConfirm, "Ripeti nuovo PIN")}
          </>
        )}
        <ModalFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Annulla
          </Button>
          <Button type="submit" variant={mode === "disattiva" ? "danger" : "primary"}>
            {mode === "attiva" ? "Attiva" : mode === "cambia" ? "Cambia" : "Disattiva"}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

// ── Backup e dati ───────────────────────────────────────────────────────────

function BackupSection({
  settings: s,
  update,
}: {
  settings: Settings;
  update: (p: Partial<Settings>) => Promise<void>;
}) {
  const { data } = useFinancial();
  const { showToast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [wipeText, setWipeText] = useState("");
  const [importPending, setImportPending] = useState<BackupFile | null>(null);
  const [encryptOpen, setEncryptOpen] = useState(false);
  const [decryptPending, setDecryptPending] = useState<EncryptedBackupFile | null>(null);

  function download(name: string, content: string) {
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportBackup() {
    const backup = await storage.exportAll();
    download(
      `sumo-backup-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(backup, null, 2)
    );
    await update({ lastBackupAt: new Date().toISOString() });
    showToast("Backup esportato: conservalo in un posto sicuro", { kind: "success" });
  }

  async function exportEncrypted(passphrase: string) {
    const backup = await storage.exportAll();
    const encrypted = await encryptBackup(backup, passphrase);
    download(
      `sumo-backup-cifrato-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(encrypted, null, 2)
    );
    await update({ lastBackupAt: new Date().toISOString() });
    setEncryptOpen(false);
    showToast("Backup cifrato esportato: senza passphrase è illeggibile (anche per te!)", {
      kind: "success",
      duration: 8000,
    });
  }

  async function onImportFile(file: File) {
    try {
      const json = JSON.parse(await file.text());
      if (isEncryptedBackup(json)) {
        setDecryptPending(json); // chiedi la passphrase
        return;
      }
      const backup = json as BackupFile;
      if (backup.app !== "PFOS" || backup.version !== 1 || typeof backup.data !== "object") {
        throw new Error();
      }
      setImportPending(backup);
    } catch {
      showToast("File non valido: serve un backup JSON esportato dall'app", { kind: "error" });
    }
  }

  async function onDecrypt(passphrase: string) {
    if (!decryptPending) return;
    try {
      const backup = await decryptBackup(decryptPending, passphrase);
      setDecryptPending(null);
      setImportPending(backup); // prosegue con la normale conferma di sostituzione
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Decifratura fallita", { kind: "error" });
    }
  }

  async function confirmImport() {
    if (!importPending) return;
    await storage.importAll(importPending);
    setImportPending(null);
    showToast("Backup importato: tutti i dati sono stati sostituiti", { kind: "success" });
  }

  async function wipeAll() {
    if (wipeText !== "ELIMINA") {
      showToast('Scrivi esattamente "ELIMINA" per confermare', { kind: "error" });
      return;
    }
    await storage.wipeAll();
    setWipeOpen(false);
    setWipeText("");
    showToast("Tutti i dati sono stati cancellati", { kind: "success" });
  }

  const movements = data.incomes.length + data.expenses.length;

  return (
    <Card
      title="Backup e dati"
      subtitle="I dati vivono solo in questo browser: il backup JSON è anche il modo per passarli tra desktop e telefono"
    >
      <div id="backup" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-soft">
          <Badge tone="neutral">{data.snapshots.length} snapshot</Badge>
          <Badge tone="neutral">{movements} movimenti</Badge>
          <Badge tone="neutral">{data.assets.length} asset</Badge>
          <span>
            {s.lastBackupAt
              ? `Ultimo backup: ${fmtDateTime(s.lastBackupAt)}`
              : "Nessun backup ancora: fanne uno appena hai inserito i primi dati."}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={exportBackup}>
            <Download className="size-4" /> Esporta backup JSON
          </Button>
          <Button variant="outline" onClick={() => setEncryptOpen(true)}>
            <KeyRound className="size-4" /> Esporta cifrato
          </Button>
          <Button variant="outline" onClick={() => fileInput.current?.click()}>
            <Upload className="size-4" /> Importa backup
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImportFile(f);
              e.target.value = "";
            }}
          />
          <Button variant="danger" onClick={() => setWipeOpen(true)}>
            Cancella tutto
          </Button>
        </div>
        <p className="text-xs text-faint">
          Consiglio: esporta un backup almeno una volta al mese e dopo modifiche importanti.
        </p>

        <AutoBackupBlock lastAutoBackupAt={s.lastAutoBackupAt} />
      </div>

      {/* conferma import (sostituzione completa) */}
      <Modal
        open={importPending !== null}
        onClose={() => setImportPending(null)}
        title="Importare il backup?"
      >
        <p className="text-sm text-soft">
          L&apos;import <strong className="text-ink">sostituisce completamente</strong> tutti i
          dati attuali con quelli del file
          {importPending && (
            <>
              {" "}
              (esportato il {fmtDateTime(importPending.exportedAt)},{" "}
              {Object.values(importPending.data).reduce((s, rows) => s + (rows?.length ?? 0), 0)}{" "}
              record)
            </>
          )}
          . L&apos;operazione non è annullabile.
        </p>
        <ModalFooter>
          <Button variant="outline" onClick={() => setImportPending(null)}>
            Annulla
          </Button>
          <Button onClick={confirmImport}>Sostituisci tutto</Button>
        </ModalFooter>
      </Modal>

      {/* doppia conferma cancellazione */}
      <Modal
        open={wipeOpen}
        onClose={() => {
          setWipeOpen(false);
          setWipeText("");
        }}
        title="Cancellare tutti i dati?"
      >
        <p className="text-sm text-soft">
          Verranno eliminati <strong className="text-ink">definitivamente</strong> conti,
          movimenti, investimenti, impostazioni e snapshot da questo browser. Se non hai un
          backup, non c&apos;è modo di recuperarli.
        </p>
        <Field label='Scrivi "ELIMINA" per confermare'>
          <Input value={wipeText} onChange={(e) => setWipeText(e.target.value)} autoFocus />
        </Field>
        <ModalFooter>
          <Button
            variant="outline"
            onClick={() => {
              setWipeOpen(false);
              setWipeText("");
            }}
          >
            Annulla
          </Button>
          <Button variant="danger" onClick={wipeAll} disabled={wipeText !== "ELIMINA"}>
            Cancella tutto
          </Button>
        </ModalFooter>
      </Modal>

      {/* passphrase per l'export cifrato */}
      {encryptOpen && (
        <PassphraseModal
          title="Esporta backup cifrato"
          description="Il file sarà leggibile SOLO con questa passphrase (AES-256). Se la perdi, il backup è irrecuperabile: non esiste alcun recupero."
          confirmLabel="Cifra ed esporta"
          requireConfirm
          onClose={() => setEncryptOpen(false)}
          onSubmit={exportEncrypted}
        />
      )}

      {/* passphrase per l'import di un backup cifrato */}
      {decryptPending && (
        <PassphraseModal
          title="Backup cifrato: inserisci la passphrase"
          description={`File esportato il ${fmtDateTime(decryptPending.exportedAt)}.`}
          confirmLabel="Decifra"
          onClose={() => setDecryptPending(null)}
          onSubmit={onDecrypt}
        />
      )}
    </Card>
  );
}

function PassphraseModal({
  title,
  description,
  confirmLabel,
  requireConfirm = false,
  onClose,
  onSubmit,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  requireConfirm?: boolean;
  onClose: () => void;
  onSubmit: (passphrase: string) => Promise<void>;
}) {
  const { showToast } = useToast();
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pass.length < 8) {
      showToast("Usa una passphrase di almeno 8 caratteri", { kind: "error" });
      return;
    }
    if (requireConfirm && pass !== confirm) {
      showToast("Le due passphrase non coincidono", { kind: "error" });
      return;
    }
    setBusy(true);
    try {
      await onSubmit(pass);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={title}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-sm text-soft">{description}</p>
        <Field label="Passphrase (min 8 caratteri)">
          <Input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            autoFocus
            autoComplete="off"
          />
        </Field>
        {requireConfirm && (
          <Field label="Ripeti passphrase">
            <Input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
            />
          </Field>
        )}
        <ModalFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Annulla
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Elaboro…" : confirmLabel}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}


// ── Backup automatico su cartella ───────────────────────────────────────────

function AutoBackupBlock({ lastAutoBackupAt }: { lastAutoBackupAt?: string }) {
  const { showToast } = useToast();
  const [state, setState] = useState<"loading" | "off" | "on" | "unsupported">(() =>
    autoBackupSupported() ? "loading" : "unsupported"
  );
  const [dirName, setDirName] = useState("");

  const refresh = useCallback(async () => {
    if (!autoBackupSupported()) return;
    const handle = await getBackupDir();
    if (handle) {
      setDirName(handle.name);
      setState("on");
    } else {
      setState("off");
    }
  }, []);

  useEffect(() => {
    // lettura asincrona del handle da IndexedDB: gli stati arrivano dopo gli await
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  async function enable() {
    const handle = await chooseBackupDir();
    if (!handle) return;
    const res = await runAutoBackup({ force: true, requestPermission: true });
    showToast(
      res.status === "done"
        ? `Backup automatico attivo: scritto ${res.fileName} in "${handle.name}"`
        : res.status === "empty"
          ? `Cartella "${handle.name}" collegata: il primo backup partirà appena ci saranno dati`
          : `Cartella collegata, ma il backup non è riuscito: riprova da qui`,
      { kind: res.status === "error" ? "error" : "success", duration: 8000 }
    );
    refresh();
  }

  async function runNow() {
    const res = await runAutoBackup({ force: true, requestPermission: true });
    showToast(
      res.status === "done"
        ? `Backup scritto: ${res.fileName}`
        : res.status === "empty"
          ? "Niente da salvare: l'app è vuota"
          : "Backup non riuscito: controlla i permessi della cartella",
      { kind: res.status === "done" ? "success" : res.status === "empty" ? "info" : "error" }
    );
  }

  async function disable() {
    await disableAutoBackup();
    showToast("Backup automatico disattivato (i file già scritti restano)", { kind: "info" });
    refresh();
  }

  if (state === "loading") return null;

  return (
    <div className="rounded-xl bg-surface-2 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <FolderSync className="size-4 text-brand-ink" aria-hidden />
        <span className="text-sm font-semibold">Backup automatico su cartella</span>
        {state === "on" ? (
          <Badge tone="pos">attivo su &quot;{dirName}&quot;</Badge>
        ) : state === "off" ? (
          <Badge tone="neutral">non attivo</Badge>
        ) : (
          <Badge tone="warn">non supportato da questo browser</Badge>
        )}
      </div>
      {state === "unsupported" ? (
        <p className="text-xs text-faint">
          Disponibile su Chrome ed Edge desktop. Su questo browser usa l&apos;esportazione
          manuale qui sopra.
        </p>
      ) : (
        <>
          <p className="mb-3 text-xs text-soft">
            Scegli una cartella (ideale se sincronizzata con Drive/OneDrive): a ogni apertura
            l&apos;app vi salva un backup datato, massimo uno al giorno, conservando gli ultimi
            14. {lastAutoBackupAt && (
              <>Ultimo automatico: <span className="tnum">{fmtDateTime(lastAutoBackupAt)}</span>.</>
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {state === "off" ? (
              <Button variant="outline" onClick={enable}>
                Scegli cartella e attiva
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={runNow}>
                  Esegui backup ora
                </Button>
                <Button variant="outline" onClick={enable}>
                  Cambia cartella
                </Button>
                <Button variant="ghost" onClick={disable}>
                  Disattiva
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Consigli AI (BYOK) ──────────────────────────────────────────────────────

function AiSection({
  settings,
  update,
}: {
  settings: Settings;
  update: (patch: Partial<Settings>) => Promise<void>;
}) {
  const { showToast } = useToast();
  const [provider, setProvider] = useState<"gemini" | "anthropic">(
    settings.aiProvider ?? "gemini"
  );
  const [key, setKey] = useState(settings.aiApiKey ?? "");

  const configured = Boolean(settings.aiProvider && settings.aiApiKey);

  async function save() {
    const k = key.trim();
    if (!k) {
      await update({ aiProvider: undefined, aiApiKey: undefined });
      showToast("Consigli AI disattivati", { kind: "info" });
      return;
    }
    await update({ aiProvider: provider, aiApiKey: k });
    showToast("Consigli AI configurati: il sumo ti aspetta nella pagina Consigli", {
      kind: "success",
      duration: 6000,
    });
  }

  return (
    <Card
      title="Consigli AI — l'analisi del sumo"
      subtitle="Porti la TUA chiave (BYOK): la chiamata parte dal tuo browser, la chiave resta tua e nessun altro la usa"
    >
      <div className="flex flex-col gap-3 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Provider">
            <Select
              value={provider}
              onChange={(e) => setProvider(e.target.value as "gemini" | "anthropic")}
              aria-label="Provider AI"
            >
              <option value="gemini">Google Gemini — gratis (free tier)</option>
              <option value="anthropic">Anthropic Claude — pochi centesimi/analisi</option>
            </Select>
          </Field>
          <Field label="API key" hint={configured ? "Chiave salvata su questo dispositivo" : undefined}>
            <Input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={provider === "gemini" ? "AIza…" : "sk-ant-…"}
              autoComplete="off"
              aria-label="API key AI"
            />
          </Field>
        </div>
        <p className="text-xs text-faint">
          {provider === "gemini" ? (
            <>
              Chiave gratuita in 2 minuti: vai su{" "}
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                aistudio.google.com/apikey
              </a>
              , accedi col tuo account Google e premi &quot;Create API key&quot;. Il piano
              gratuito basta e avanza: l&apos;analisi usa 1-2 richieste al giorno.
            </>
          ) : (
            <>
              Chiave su{" "}
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                console.anthropic.com
              </a>
              : un&apos;analisi costa meno di un centesimo (modello Haiku).
            </>
          )}{" "}
          All&apos;AI viene inviato solo un riepilogo numerico aggregato: mai movimenti,
          descrizioni o nomi dei conti. Dettagli nella pagina Privacy.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={save}>{configured ? "Aggiorna" : "Attiva i consigli AI"}</Button>
          {configured && (
            <Button
              variant="ghost"
              onClick={async () => {
                setKey("");
                await update({ aiProvider: undefined, aiApiKey: undefined });
                showToast("Consigli AI disattivati", { kind: "info" });
              }}
            >
              Disattiva
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── Notifiche push ──────────────────────────────────────────────────────────

function PushSection() {
  const { showToast } = useToast();
  const [enabled, setEnabled] = useState(() => pushLocallyEnabled());
  const [busy, setBusy] = useState(false);
  const supported = typeof window !== "undefined" && pushSupported();
  const needsInstall = pushNeedsInstall();

  async function enable() {
    setBusy(true);
    try {
      await enablePush();
      setEnabled(true);
      showToast("Notifiche attive: promemoria la mattina delle scadenze", { kind: "success" });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Attivazione non riuscita", { kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      await disablePush();
      setEnabled(false);
      showToast("Notifiche disattivate e promemoria eliminati dal server", { kind: "info" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Notifiche push"
      subtitle="La mattina di una scadenza o di una rata ricevi un promemoria sul dispositivo"
    >
      <div className="flex flex-col gap-3 text-sm">
        {!supported ? (
          <p className="text-xs text-faint">
            Questo browser non supporta le notifiche push.
          </p>
        ) : needsInstall ? (
          <p className="text-xs text-soft">
            Su iPhone le notifiche funzionano solo con l&apos;app installata:{" "}
            <strong className="text-ink">
              Safari → condividi → &quot;Aggiungi a Home&quot;
            </strong>
            , poi riapri Sumo Finance da lì e attiva da questa pagina.
          </p>
        ) : (
          <>
            <p className="text-xs text-soft">
              Attivandole, i promemoria dei prossimi 45 giorni (titolo, data e importo di
              scadenze e rate) vengono depositati sul server per l&apos;invio programmato:
              nient&apos;altro lascia il dispositivo. Revocabile in ogni momento.
            </p>
            <div className="flex flex-wrap gap-2">
              {enabled ? (
                <>
                  <Badge tone="pos">attive</Badge>
                  <Button variant="ghost" onClick={disable} disabled={busy}>
                    Disattiva
                  </Button>
                </>
              ) : (
                <Button variant="outline" onClick={enable} disabled={busy}>
                  {busy ? "Attivazione…" : "Attiva le notifiche"}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

// ── Sync E2E tra dispositivi ────────────────────────────────────────────────

function DeviceSyncSection({ settings }: { settings: Settings }) {
  const { showToast } = useToast();
  const [hasPass, setHasPass] = useState(
    () => typeof window !== "undefined" && Boolean(localStorage.getItem("pfos-sync-pass"))
  );
  // arrivo da QR: ?synccode=… precompila il collegamento (resta solo la passphrase)
  const [scannedCode] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("synccode") ?? "";
  });
  const [mode, setMode] = useState<"idle" | "create" | "connect">(() =>
    scannedCode ? "connect" : "idle"
  );
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [codeInput, setCodeInput] = useState(scannedCode);
  const [busy, setBusy] = useState(false);
  const [lastAt, setLastAt] = useState<string | null>(() =>
    typeof window !== "undefined" ? lastSyncAt() : null
  );
  const [qr, setQr] = useState<string | null>(null);

  const enabled = Boolean(settings.syncId) && hasPass;

  // QR con l'URL di collegamento: inquadri con l'iPhone e resta solo la passphrase
  useEffect(() => {
    if (!enabled || !settings.syncId) return;
    const url = `${window.location.origin}/impostazioni?synccode=${settings.syncId}`;
    let cancelled = false;
    import("qrcode")
      .then((QR) => QR.toDataURL(url, { margin: 1, width: 220 }))
      .then((dataUrl) => {
        if (!cancelled) setQr(dataUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled, settings.syncId]);

  async function doCreate() {
    if (pass.length < 8) {
      showToast("La passphrase deve avere almeno 8 caratteri", { kind: "error" });
      return;
    }
    if (pass !== pass2) {
      showToast("Le due passphrase non coincidono", { kind: "error" });
      return;
    }
    setBusy(true);
    try {
      await createSync(pass);
      setHasPass(true);
      setLastAt(lastSyncAt());
      setMode("idle");
      setPass("");
      setPass2("");
      showToast("Sync attivato: inserisci codice e passphrase sull'altro dispositivo", {
        kind: "success",
        duration: 8000,
      });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Attivazione non riuscita", { kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function doConnect() {
    setBusy(true);
    try {
      await connectSync(codeInput, pass);
      setHasPass(true);
      setLastAt(lastSyncAt());
      setMode("idle");
      setPass("");
      setCodeInput("");
      showToast("Dispositivo collegato: dati importati dal cloud", { kind: "success" });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Collegamento non riuscito", { kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function doPushNow() {
    setBusy(true);
    try {
      await pushSync();
      setLastAt(lastSyncAt());
      showToast("Sincronizzato", { kind: "success" });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Sync non riuscito", { kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function doDisconnect(deleteRemote: boolean) {
    setBusy(true);
    try {
      await disconnectSync(deleteRemote);
      setHasPass(false);
      setLastAt(null);
      showToast(
        deleteRemote
          ? "Sync scollegato e copia cloud eliminata"
          : "Sync scollegato da questo dispositivo (la copia cloud resta per gli altri)",
        { kind: "info" }
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Sync tra dispositivi"
      subtitle="Cifratura end-to-end: sul cloud viaggia solo un blob illeggibile, la passphrase non lascia mai i tuoi dispositivi"
    >
      <div className="flex flex-col gap-3 text-sm">
        {enabled ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Link2 className="size-4 text-brand-ink" aria-hidden />
              <span className="font-semibold">Attivo</span>
              <Badge tone="pos">codice {formatSyncCode(settings.syncId ?? "")}</Badge>
              {lastAt && (
                <span className="text-xs text-faint">
                  ultimo sync: <span className="tnum">{fmtDateTime(lastAt)}</span>
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-start gap-4">
              {enabled && qr && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qr}
                  alt={`QR code di collegamento sync ${formatSyncCode(settings.syncId ?? "")}`}
                  className="size-36 rounded-lg border border-line bg-white p-1.5"
                />
              )}
              <p className="min-w-48 flex-1 text-xs text-soft">
                Sull&apos;altro dispositivo: <strong>inquadra il QR</strong> con la fotocamera
                (si apre l&apos;app col codice già inserito) e digita solo la passphrase.
                In alternativa: Impostazioni → Sync → <em>Collega dispositivo</em> e inserisci
                codice e passphrase a mano. La sincronizzazione avviene a ogni apertura e dopo
                le modifiche; vince la modifica più recente.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={doPushNow} disabled={busy}>
                Sincronizza ora
              </Button>
              <Button variant="ghost" onClick={() => doDisconnect(false)} disabled={busy}>
                Scollega dispositivo
              </Button>
              <Button variant="ghost" onClick={() => doDisconnect(true)} disabled={busy}>
                Scollega ed elimina dal cloud
              </Button>
            </div>
          </>
        ) : mode === "create" ? (
          <>
            <p className="text-xs text-soft">
              Scegli una passphrase (minimo 8 caratteri): cifra i tuoi dati prima che lascino
              il dispositivo. <strong>Se la perdi, il contenuto del cloud è irrecuperabile.</strong>
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Passphrase">
                <Input
                  type="password"
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  autoComplete="new-password"
                />
              </Field>
              <Field label="Ripeti passphrase">
                <Input
                  type="password"
                  value={pass2}
                  onChange={(e) => setPass2(e.target.value)}
                  autoComplete="new-password"
                />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={doCreate} disabled={busy}>
                {busy ? "Attivazione…" : "Attiva il sync"}
              </Button>
              <Button variant="ghost" onClick={() => setMode("idle")} disabled={busy}>
                Annulla
              </Button>
            </div>
          </>
        ) : mode === "connect" ? (
          <>
            <p className="text-xs text-soft">
              Inserisci il codice mostrato sul primo dispositivo e la stessa passphrase.
              <strong> Attenzione:</strong> i dati presenti su questo dispositivo verranno
              sostituiti da quelli del cloud.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Codice sync">
                <Input
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                  placeholder="es. abcde-fghjk-mnpqr-stvwx"
                  autoComplete="off"
                />
              </Field>
              <Field label="Passphrase">
                <Input
                  type="password"
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  autoComplete="off"
                />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={doConnect} disabled={busy}>
                {busy ? "Collegamento…" : "Collega e importa"}
              </Button>
              <Button variant="ghost" onClick={() => setMode("idle")} disabled={busy}>
                Annulla
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-soft">
              Tieni iPhone e computer allineati senza account: i dati viaggiano cifrati con
              una passphrase che conosci solo tu. Sul primo dispositivo crea il sync; sugli
              altri usa <em>Collega dispositivo</em>.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setMode("create")}>
                Crea nuovo sync
              </Button>
              <Button variant="outline" onClick={() => setMode("connect")}>
                Collega dispositivo
              </Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
