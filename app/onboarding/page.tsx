"use client";

// ── Onboarding: dashboard viva in 5 minuti, saltabile in ogni momento ───────

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ShieldCheck } from "lucide-react";
import { storage } from "@/lib/storage";
import { DEFAULT_SETTINGS, DEFAULT_TAX_STATE } from "@/lib/defaults";
import {
  ACCOUNT_TYPES,
  EXPENSE_CATEGORIES,
  uid,
  type Account,
  type AccountType,
  type Asset,
  type Debt,
  type Expense,
  type RecurringTransaction,
  type RiskProfile,
  type Settings,
} from "@/lib/types";
import { hashPin, randomSalt, setUnlocked } from "@/lib/pin";
import { parseItAmount, todayISO } from "@/lib/format";
import { registerRecurringMovements, takeDailySnapshot } from "@/lib/boot";
import { Button, Field, Input, Select } from "@/components/ui";
import { useToast } from "@/components/toast";
import { SumoMascot } from "@/components/Mascot";

const STEPS = [
  "Benvenuto",
  "Profilo",
  "Primo conto",
  "Entrata ricorrente",
  "Spese del mese",
  "Casa & investimenti",
  "PIN",
  "Riepilogo",
];

export default function OnboardingPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [step, setStep] = useState(0);

  // stato raccolto lungo il wizard
  const [risk, setRisk] = useState<RiskProfile>("bilanciato");
  const [inflation, setInflation] = useState("2");
  const [accName, setAccName] = useState("Conto principale");
  const [accType, setAccType] = useState<AccountType>("conto corrente");
  const [accBalance, setAccBalance] = useState("");
  const [salaryAmount, setSalaryAmount] = useState("");
  const [salaryDay, setSalaryDay] = useState("27");
  const [expenseEstimates, setExpenseEstimates] = useState<Record<string, string>>({});
  const [homeValue, setHomeValue] = useState("");
  const [mortgageResidual, setMortgageResidual] = useState("");
  const [mortgagePayment, setMortgagePayment] = useState("");
  const [invName, setInvName] = useState("");
  const [invValue, setInvValue] = useState("");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const checklist = useMemo(
    () => [
      { label: "Profilo di rischio", done: true },
      { label: "Primo conto liquido", done: parseItAmount(accBalance) != null && accName.trim() !== "" },
      { label: "Entrata ricorrente (stipendio)", done: (parseItAmount(salaryAmount) ?? 0) > 0 },
      {
        label: "Spese principali del mese",
        done: Object.values(expenseEstimates).some((v) => (parseItAmount(v) ?? 0) > 0),
      },
      { label: "Casa e mutuo", done: (parseItAmount(homeValue) ?? 0) > 0 },
      { label: "Primo investimento", done: (parseItAmount(invValue) ?? 0) > 0 },
      { label: "PIN di sblocco", done: /^\d{4}$/.test(pin) && pin === pinConfirm },
    ],
    [accBalance, accName, salaryAmount, expenseEstimates, homeValue, invValue, pin, pinConfirm]
  );

  async function finish(skipAll = false) {
    setSaving(true);
    try {
      const existing = await storage.get<Settings>("settings", "main");
      let settings: Settings = {
        ...DEFAULT_SETTINGS,
        ...existing,
        onboardingDone: true,
      };

      if (!skipAll) {
        settings = {
          ...settings,
          riskProfile: risk,
          expectedInflation: parseItAmount(inflation) ?? 2,
        };

        const balance = parseItAmount(accBalance);
        if (accName.trim() && balance != null) {
          const account: Account = {
            id: uid(),
            name: accName.trim(),
            type: accType,
            balance,
          };
          await storage.put("accounts", account);
        }

        const salary = parseItAmount(salaryAmount);
        if (salary != null && salary > 0) {
          const rec: RecurringTransaction = {
            id: uid(),
            description: "Stipendio",
            category: "Stipendio",
            amount: salary,
            type: "entrata",
            cadence: "mensile",
            day: Math.min(28, Math.max(1, Number(salaryDay) || 27)),
            active: true,
            startDate: todayISO(),
          };
          await storage.put("recurringTransactions", rec);
        }

        const today = todayISO();
        const expenses: Expense[] = [];
        for (const [cat, raw] of Object.entries(expenseEstimates)) {
          const v = parseItAmount(raw);
          if (v != null && v > 0) {
            expenses.push({
              id: uid(),
              description: `Stima ${cat.toLowerCase()} del mese`,
              category: cat,
              amount: v,
              date: today,
              source: "manuale",
            });
          }
        }
        if (expenses.length > 0) await storage.bulkPut("expenses", expenses);

        const hv = parseItAmount(homeValue);
        let homeId: string | undefined;
        if (hv != null && hv > 0) {
          homeId = uid();
          const home: Asset = {
            id: homeId,
            name: "Casa",
            assetClass: "Immobili",
            quantity: 1,
            avgCost: hv,
            baseQuantity: 1,
            baseAvgCost: hv,
            baseDate: today,
            currentPrice: hv,
            priceSource: "manuale",
            taxRegime: "standard",
          };
          await storage.put("assets", home);
        }
        const mr = parseItAmount(mortgageResidual);
        if (mr != null && mr > 0) {
          const debt: Debt = {
            id: uid(),
            name: "Mutuo casa",
            type: "mutuo",
            residual: mr,
            tan: 0,
            monthlyPayment: parseItAmount(mortgagePayment) ?? 0,
            linkedAssetId: homeId,
            paymentDay: 1,
            // senza TAN l'ammortamento sarebbe impreciso: si attiva dalla
            // pagina Debiti dopo aver inserito il tasso
            amortize: false,
          };
          await storage.put("debts", debt);
        }

        const iv = parseItAmount(invValue);
        if (iv != null && iv > 0 && invName.trim()) {
          const inv: Asset = {
            id: uid(),
            name: invName.trim(),
            assetClass: "ETF",
            quantity: 1,
            avgCost: iv,
            baseQuantity: 1,
            baseAvgCost: iv,
            baseDate: today,
            currentPrice: iv,
            priceSource: "manuale",
            taxRegime: "standard",
          };
          await storage.put("assets", inv);
        }

        if (/^\d{4}$/.test(pin) && pin === pinConfirm) {
          const salt = randomSalt();
          settings = { ...settings, pinSalt: salt, pinHash: await hashPin(pin, salt) };
          setUnlocked(true);
        }
      }

      await storage.put("settings", settings);
      const tax = await storage.get("taxState", "main");
      if (!tax) await storage.put("taxState", { ...DEFAULT_TAX_STATE });

      // registra subito ricorrenti maturati e primo snapshot
      await registerRecurringMovements();
      await takeDailySnapshot();

      showToast(skipAll ? "Puoi configurare tutto con calma dalle varie pagine" : "Benvenuto in Sumo Finance! 🎉", {
        kind: "success",
      });
      router.replace("/");
    } finally {
      setSaving(false);
    }
  }

  const progress = ((step + 1) / STEPS.length) * 100;

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      {/* header wizard */}
      <header className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-1.5">
          <SumoMascot size={34} />
          <span className="font-display text-lg font-semibold">Sumo Finance</span>
        </div>
        <button
          onClick={() => finish(step === 0)}
          disabled={saving}
          className="min-h-11 rounded-xl px-3 text-sm font-medium text-soft hover:text-ink"
        >
          Salta per ora
        </button>
      </header>
      <div className="mx-5 h-1 overflow-hidden rounded-full bg-line/60">
        <div className="h-full bg-brand transition-all duration-300" style={{ width: `${progress}%` }} />
      </div>

      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-5 py-8">
        <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-faint">
          Passo {step + 1} di {STEPS.length}
        </div>

        {step === 0 && (
          <StepShell title="Il tuo sistema operativo finanziario">
            <div className="flex justify-center">
              <SumoMascot size={110} />
            </div>
            <p className="text-soft">
              Sumo Finance mette in un unico posto conti, investimenti, debiti, budget e
              obiettivi — e trasforma i tuoi numeri in metriche e consigli chiari. Solido e
              ben piantato, come un sumo.
            </p>
            <div className="flex items-start gap-3 rounded-2xl bg-pos-soft p-4 text-sm text-pos">
              <ShieldCheck className="mt-0.5 size-5 shrink-0" />
              <p>
                <strong>Promessa privacy:</strong> i tuoi dati restano su questo dispositivo, nel
                browser. Nessun server, nessun account. Verso internet transitano solo i ticker
                per aggiornare i prezzi di mercato.
              </p>
            </div>
            <p className="text-sm text-faint">
              Bastano 5 minuti per una dashboard viva. Puoi saltare qualsiasi passo.
            </p>
          </StepShell>
        )}

        {step === 1 && (
          <StepShell title="Che investitore sei?">
            <Field
              label="Profilo di rischio"
              hint="Regola le soglie dei consigli (concentrazione, quota crypto): potrai cambiarlo quando vuoi."
            >
              <Select value={risk} onChange={(e) => setRisk(e.target.value as RiskProfile)}>
                <option value="prudente">Prudente — priorità alla stabilità</option>
                <option value="bilanciato">Bilanciato — crescita con equilibrio</option>
                <option value="dinamico">Dinamico — accetto oscillazioni ampie</option>
              </Select>
            </Field>
            <Field label="Inflazione attesa (%)">
              <Input
                inputMode="decimal"
                value={inflation}
                onChange={(e) => setInflation(e.target.value)}
              />
            </Field>
          </StepShell>
        )}

        {step === 2 && (
          <StepShell title="Il tuo primo conto">
            <Field label="Nome">
              <Input value={accName} onChange={(e) => setAccName(e.target.value)} autoFocus />
            </Field>
            <Field label="Tipo">
              <Select value={accType} onChange={(e) => setAccType(e.target.value as AccountType)}>
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Saldo attuale (€)">
              <Input
                inputMode="decimal"
                value={accBalance}
                onChange={(e) => setAccBalance(e.target.value)}
                placeholder="es. 3.500,00"
              />
            </Field>
          </StepShell>
        )}

        {step === 3 && (
          <StepShell title="La tua entrata principale">
            <p className="text-sm text-soft">
              Lo stipendio si registrerà da solo ogni mese alla data che indichi — senza
              duplicati, promesso.
            </p>
            <Field label="Importo mensile netto (€)">
              <Input
                inputMode="decimal"
                value={salaryAmount}
                onChange={(e) => setSalaryAmount(e.target.value)}
                placeholder="es. 1.850,00"
                autoFocus
              />
            </Field>
            <Field label="Giorno del mese in cui arriva (1–28)">
              <Input
                type="number"
                min={1}
                max={28}
                value={salaryDay}
                onChange={(e) => setSalaryDay(e.target.value)}
              />
            </Field>
          </StepShell>
        )}

        {step === 4 && (
          <StepShell title="Le spese di questo mese">
            <p className="text-sm text-soft">
              Anche stime approssimative vanno benissimo: servono a dare vita a budget e tasso di
              risparmio. Lascia vuoto ciò che non ti riguarda.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {EXPENSE_CATEGORIES.filter((c) => c !== "Altro").map((cat) => (
                <Field key={cat} label={`${cat} (€)`}>
                  <Input
                    inputMode="decimal"
                    value={expenseEstimates[cat] ?? ""}
                    onChange={(e) =>
                      setExpenseEstimates((v) => ({ ...v, [cat]: e.target.value }))
                    }
                    placeholder="—"
                  />
                </Field>
              ))}
            </div>
          </StepShell>
        )}

        {step === 5 && (
          <StepShell title="Casa e investimenti (opzionale)">
            <Field label="Valore della casa di proprietà (€)" hint="Entra come immobile a valore manuale">
              <Input
                inputMode="decimal"
                value={homeValue}
                onChange={(e) => setHomeValue(e.target.value)}
                placeholder="es. 220.000"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Mutuo residuo (€)">
                <Input
                  inputMode="decimal"
                  value={mortgageResidual}
                  onChange={(e) => setMortgageResidual(e.target.value)}
                  placeholder="es. 130.000"
                />
              </Field>
              <Field label="Rata mensile (€)">
                <Input
                  inputMode="decimal"
                  value={mortgagePayment}
                  onChange={(e) => setMortgagePayment(e.target.value)}
                  placeholder="es. 620"
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Primo investimento (nome)">
                <Input
                  value={invName}
                  onChange={(e) => setInvName(e.target.value)}
                  placeholder="es. ETF azionario"
                />
              </Field>
              <Field label="Valore attuale (€)">
                <Input
                  inputMode="decimal"
                  value={invValue}
                  onChange={(e) => setInvValue(e.target.value)}
                  placeholder="es. 5.000"
                />
              </Field>
            </div>
            <p className="text-xs text-faint">
              Potrai aggiungere ticker e sync automatica dei prezzi dalla pagina Investimenti.
            </p>
          </StepShell>
        )}

        {step === 6 && (
          <StepShell title="PIN di sblocco (opzionale)">
            <p className="text-sm text-soft">
              Un PIN a 4 cifre protegge l&apos;app da occhi indiscreti su questo dispositivo (non
              è crittografia dei dati).
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="PIN (4 cifre)">
                <Input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                  placeholder="••••"
                  className="tnum tracking-[0.4em]"
                />
              </Field>
              <Field label="Ripeti PIN">
                <Input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={pinConfirm}
                  onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, ""))}
                  placeholder="••••"
                  className="tnum tracking-[0.4em]"
                />
              </Field>
            </div>
            {pin && pinConfirm && pin !== pinConfirm && (
              <p className="text-sm text-neg">I due PIN non coincidono.</p>
            )}
          </StepShell>
        )}

        {step === 7 && (
          <StepShell title="Tutto pronto">
            <ul className="flex flex-col gap-2">
              {checklist.map((c) => (
                <li key={c.label} className="flex items-center gap-2.5 text-sm">
                  <span
                    className={`flex size-5 items-center justify-center rounded-full ${
                      c.done ? "bg-pos text-on-fill" : "border border-line-strong text-faint"
                    }`}
                  >
                    {c.done && <Check className="size-3.5" />}
                  </span>
                  <span className={c.done ? "text-ink" : "text-faint"}>{c.label}</span>
                  {!c.done && <span className="text-xs text-faint">— potrai farlo dopo</span>}
                </li>
              ))}
            </ul>
            <p className="text-sm text-soft">
              Quello che manca si aggiunge in un attimo dalle pagine dell&apos;app. Ricorda di
              fare un backup dei dati da Impostazioni quando hai finito di inserirli.
            </p>
          </StepShell>
        )}

        {/* navigazione */}
        <div className="mt-8 flex justify-between gap-3">
          <Button
            variant="outline"
            onClick={() => setStep((sv) => Math.max(0, sv - 1))}
            disabled={step === 0 || saving}
            className={step === 0 ? "invisible" : ""}
          >
            Indietro
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep((sv) => sv + 1)} disabled={saving}>
              {step === 0 ? "Iniziamo" : "Avanti"}
            </Button>
          ) : (
            <Button onClick={() => finish(false)} disabled={saving}>
              {saving ? "Salvo…" : "Vai alla dashboard"}
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}

function StepShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-3xl font-semibold tracking-tight">{title}</h1>
      {children}
    </div>
  );
}
