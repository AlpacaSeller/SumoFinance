"use client";

// ── Import CSV estratti conto: wizard in 3 passi ────────────────────────────
// 1. Caricamento e parsing  2. Mappatura colonne (+ profili banca)
// 3. Categorizzazione con regole + deduplica obbligatoria

import { useMemo, useRef, useState } from "react";
import { FileUp, Sparkles } from "lucide-react";
import { storage } from "@/lib/storage";
import {
  applyRules,
  fingerprint,
  mapRows,
  parseCsv,
  readCsvFile,
  type MappedMovement,
  type ParsedCsv,
} from "@/lib/csv";
import {
  uid,
  type Expense,
  type ImportProfile,
  type ImportRule,
  type Income,
  type Settings,
} from "@/lib/types";
import { fmtDate, fmtEUR } from "@/lib/format";
import { useToast } from "./toast";
import { Badge, Button, Field, Input, Modal, ModalFooter, Select } from "./ui";

interface Props {
  open: boolean;
  onClose: () => void;
  incomeCategories: string[];
  expenseCategories: string[];
  rules: ImportRule[];
  profiles: ImportProfile[];
  existingFingerprints: Set<string>;
}

type Convention = "signed" | "debitCredit";

interface RowState extends MappedMovement {
  index: number;
  categoryFinal: string;
  fromRule: boolean;
  duplicate: boolean;
  include: boolean;
}

export function CsvImportWizard({
  open,
  onClose,
  incomeCategories,
  expenseCategories,
  rules,
  profiles,
  existingFingerprints,
}: Props) {
  const { showToast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(1);
  const [fileName, setFileName] = useState("");
  const [rawText, setRawText] = useState("");
  const [separator, setSeparator] = useState<string>("");
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);

  // passo 2: mappatura
  const [dateCol, setDateCol] = useState("");
  const [descCol, setDescCol] = useState("");
  const [amountCol, setAmountCol] = useState("");
  const [debitCol, setDebitCol] = useState("");
  const [creditCol, setCreditCol] = useState("");
  const [convention, setConvention] = useState<Convention>("signed");
  const [profileName, setProfileName] = useState("");

  // passo 3: righe
  const [rows, setRows] = useState<RowState[]>([]);
  const [aiBusy, setAiBusy] = useState(false);

  /** Righe valide rimaste in "Altro" senza regola: candidate per l'AI. */
  const aiCandidates = rows.filter(
    (r) => r.valid && !r.duplicate && !r.fromRule && r.categoryFinal === "Altro"
  );

  async function categorizeWithAi() {
    setAiBusy(true);
    try {
      const settings = await storage.get<Settings>("settings", "main");
      if (!settings?.aiProvider || !settings.aiApiKey) {
        showToast("Configura i Consigli AI in Impostazioni per usare la categorizzazione", {
          kind: "error",
          duration: 7000,
        });
        return;
      }
      const { categorizeDescriptions } = await import("@/lib/engine/llmAdvisor");
      const proposals = await categorizeDescriptions(
        settings,
        aiCandidates.map((r) => r.description.trim()),
        [...new Set([...expenseCategories, ...incomeCategories])]
      );
      let applied = 0;
      setRows((prev) =>
        prev.map((r) => {
          const cat = proposals[r.description.trim()];
          if (
            cat &&
            cat !== "Altro" &&
            r.valid &&
            !r.duplicate &&
            !r.fromRule &&
            r.categoryFinal === "Altro"
          ) {
            applied++;
            return { ...r, categoryFinal: cat };
          }
          return r;
        })
      );
      showToast(
        applied > 0
          ? `L'AI ha proposto la categoria per ${applied} righe: controlla e correggi dove serve`
          : "L'AI non ha trovato categorie migliori di «Altro» per queste righe",
        { kind: applied > 0 ? "success" : "info", duration: 7000 }
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Categorizzazione non riuscita", {
        kind: "error",
      });
    } finally {
      setAiBusy(false);
    }
  }
  const [localRules, setLocalRules] = useState<ImportRule[]>(rules);
  const [ruleFor, setRuleFor] = useState<RowState | null>(null);

  function reset() {
    setStep(1);
    setFileName("");
    setRawText("");
    setParsed(null);
    setDateCol("");
    setDescCol("");
    setAmountCol("");
    setDebitCol("");
    setCreditCol("");
    setConvention("signed");
    setProfileName("");
    setRows([]);
  }

  function close() {
    reset();
    onClose();
  }

  async function onFile(file: File) {
    const text = await readCsvFile(file);
    setFileName(file.name);
    setRawText(text);
    const p = parseCsv(text, separator || undefined);
    setParsed(p);
    if (p.headers.length < 2) {
      showToast(
        "Il file non sembra un CSV valido: servono almeno 2 colonne. Prova a cambiare separatore.",
        { kind: "error", duration: 7000 }
      );
    }
    // pre-compila la mappatura con euristiche sui nomi delle colonne
    const lower = p.headers.map((h) => h.toLowerCase());
    const find = (...keys: string[]) => {
      const i = lower.findIndex((h) => keys.some((k) => h.includes(k)));
      return i >= 0 ? p.headers[i] : "";
    };
    setDateCol(find("data", "date"));
    setDescCol(find("descriz", "causale", "descr", "operaz", "description"));
    const imp = find("importo", "amount", "€");
    setAmountCol(imp);
    const dare = find("dare", "addebit", "uscite", "debit");
    const avere = find("avere", "accredit", "entrate", "credit");
    setDebitCol(dare);
    setCreditCol(avere);
    if (!imp && dare && avere) setConvention("debitCredit");
  }

  function applyProfile(p: ImportProfile) {
    setDateCol(p.mapping.dateCol);
    setDescCol(p.mapping.descCol);
    setAmountCol(p.mapping.amountCol ?? "");
    setDebitCol(p.mapping.debitCol ?? "");
    setCreditCol(p.mapping.creditCol ?? "");
    setConvention(p.amountConvention);
    if (rawText) {
      const reparsed = parseCsv(rawText, p.separator || undefined);
      setParsed(reparsed);
    }
    showToast(`Profilo "${p.name}" applicato`, { kind: "success" });
  }

  async function saveProfile() {
    if (!profileName.trim()) {
      showToast("Dai un nome al profilo (es. il nome della banca)", { kind: "error" });
      return;
    }
    const profile: ImportProfile = {
      id: uid(),
      name: profileName.trim(),
      mapping: {
        dateCol,
        descCol,
        amountCol: amountCol || undefined,
        debitCol: debitCol || undefined,
        creditCol: creditCol || undefined,
      },
      separator: parsed?.detectedSeparator ?? ";",
      dateFormat: "gg/mm/aaaa",
      amountConvention: convention,
    };
    await storage.put("importProfiles", profile);
    showToast(`Profilo "${profile.name}" salvato: al prossimo import basta un clic`, {
      kind: "success",
    });
  }

  function goToStep3() {
    if (!parsed) return;
    if (!dateCol || !descCol || (convention === "signed" ? !amountCol : !debitCol && !creditCol)) {
      showToast("Completa la mappatura: data, descrizione e importo sono obbligatori", {
        kind: "error",
      });
      return;
    }
    const mapped = mapRows(parsed.rows, {
      dateCol,
      descCol,
      amountCol: amountCol || undefined,
      debitCol: debitCol || undefined,
      creditCol: creditCol || undefined,
    }, convention);
    const seen = new Set<string>();
    const rowStates: RowState[] = mapped.map((m, index) => {
      const fp = m.valid ? fingerprint(m.date, m.amount, m.description) : "";
      const duplicate = m.valid && (existingFingerprints.has(fp) || seen.has(fp));
      if (m.valid) seen.add(fp);
      const ruleCat = m.valid ? applyRules(m.description, m.amount > 0, localRules) : null;
      return {
        ...m,
        index,
        categoryFinal: m.category || ruleCat || "Altro",
        fromRule: Boolean(ruleCat && !m.category),
        duplicate,
        include: m.valid && !duplicate,
      };
    });
    setRows(rowStates);
    setStep(3);
  }

  async function doImport() {
    const toImport = rows.filter((r) => r.include && r.valid && !r.duplicate);
    const batch = uid(); // lotto: permette l'annullo dell'intero import
    const incomes: Income[] = [];
    const expenses: Expense[] = [];
    for (const r of toImport) {
      const fp = fingerprint(r.date, r.amount, r.description);
      const base = {
        id: uid(),
        description: r.description,
        category: r.categoryFinal,
        amount: Math.abs(r.amount),
        date: r.date,
        source: "import" as const,
        fingerprint: fp,
        importBatch: batch,
      };
      if (r.amount > 0) incomes.push(base);
      else expenses.push(base);
    }
    if (incomes.length > 0) await storage.bulkPut("incomes", incomes);
    if (expenses.length > 0) await storage.bulkPut("expenses", expenses);
    const dupCount = rows.filter((r) => r.duplicate).length;
    const invalid = rows.filter((r) => !r.valid).length;
    showToast(
      `Importati ${incomes.length + expenses.length} movimenti (${incomes.length} entrate, ${expenses.length} uscite). ` +
        `${dupCount} duplicati ignorati${invalid > 0 ? `, ${invalid} righe non valide` : ""}.`,
      {
        kind: "success",
        duration: 12000,
        actionLabel: "Annulla import",
        action: async () => {
          for (const i of incomes) await storage.remove("incomes", i.id);
          for (const e of expenses) await storage.remove("expenses", e.id);
          showToast(
            `Import annullato: rimossi ${incomes.length + expenses.length} movimenti`,
            { kind: "info" }
          );
        },
      }
    );
    close();
  }

  const previewRows = useMemo(() => parsed?.rows.slice(0, 5) ?? [], [parsed]);
  const allCategories = useMemo(
    () => [...new Set([...expenseCategories, ...incomeCategories])],
    [expenseCategories, incomeCategories]
  );

  return (
    <Modal open={open} onClose={close} title={`Importa CSV — passo ${step} di 3`} wide>
      {/* ── Passo 1: caricamento ── */}
      {step === 1 && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-soft">
            Carica l&apos;estratto conto in CSV della tua banca. Sono gestiti separatori{" "}
            <code>;</code> e <code>,</code>, encoding UTF-8 e Latin-1, date italiane
            (gg/mm/aaaa) e importi con la virgola.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => fileInput.current?.click()}>
              <FileUp className="size-4" /> Scegli file CSV
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
              }}
            />
            {fileName && <Badge tone="brand">{fileName}</Badge>}
            <Field label="Separatore">
              <Select
                value={separator}
                onChange={(e) => {
                  setSeparator(e.target.value);
                  if (rawText) setParsed(parseCsv(rawText, e.target.value || undefined));
                }}
                className="!w-40"
              >
                <option value="">auto</option>
                <option value=";">punto e virgola ;</option>
                <option value=",">virgola ,</option>
              </Select>
            </Field>
          </div>
          {parsed && parsed.headers.length >= 2 && (
            <>
              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full text-xs">
                  <thead className="bg-surface-2 text-left">
                    <tr>
                      {parsed.headers.map((h) => (
                        <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {previewRows.map((r, i) => (
                      <tr key={i}>
                        {parsed.headers.map((h) => (
                          <td key={h} className="whitespace-nowrap px-3 py-1.5 text-soft">
                            {r[h]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-faint">
                {`Anteprima delle prime ${previewRows.length} righe · ${parsed.rows.length} righe totali · separatore rilevato "${parsed.detectedSeparator}"`}
              </p>
            </>
          )}
          <ModalFooter>
            <Button variant="outline" onClick={close}>
              Annulla
            </Button>
            <Button disabled={!parsed || parsed.headers.length < 2} onClick={() => setStep(2)}>
              Avanti: mappa le colonne
            </Button>
          </ModalFooter>
        </div>
      )}

      {/* ── Passo 2: mappatura ── */}
      {step === 2 && parsed && (
        <div className="flex flex-col gap-4">
          {profiles.length > 0 && (
            <div className="rounded-xl bg-accent-soft p-3">
              <div className="mb-2 text-xs font-semibold text-accent">
                Profili banca salvati — un clic e la mappatura è fatta
              </div>
              <div className="flex flex-wrap gap-2">
                {profiles.map((p) => (
                  <Button key={p.id} variant="outline" onClick={() => applyProfile(p)}>
                    {p.name}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Colonna data">
              <ColSelect headers={parsed.headers} value={dateCol} onChange={setDateCol} />
            </Field>
            <Field label="Colonna descrizione">
              <ColSelect headers={parsed.headers} value={descCol} onChange={setDescCol} />
            </Field>
            <Field label="Convenzione importo">
              <Select
                value={convention}
                onChange={(e) => setConvention(e.target.value as Convention)}
              >
                <option value="signed">Colonna unica con segno (+/−)</option>
                <option value="debitCredit">Dare / Avere su colonne separate</option>
              </Select>
            </Field>
            {convention === "signed" ? (
              <Field label="Colonna importo">
                <ColSelect headers={parsed.headers} value={amountCol} onChange={setAmountCol} />
              </Field>
            ) : (
              <>
                <Field label="Colonna dare (uscite)">
                  <ColSelect headers={parsed.headers} value={debitCol} onChange={setDebitCol} />
                </Field>
                <Field label="Colonna avere (entrate)">
                  <ColSelect headers={parsed.headers} value={creditCol} onChange={setCreditCol} />
                </Field>
              </>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-2 rounded-xl bg-surface-2 p-3">
            <Field label="Salva questa mappatura come profilo banca" hint="es. Intesa, Revolut">
              <Input
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder="Nome banca"
                className="!w-52"
              />
            </Field>
            <Button variant="outline" onClick={saveProfile}>
              Salva profilo
            </Button>
          </div>
          <ModalFooter>
            <Button variant="outline" onClick={() => setStep(1)}>
              Indietro
            </Button>
            <Button onClick={goToStep3}>Avanti: categorie</Button>
          </ModalFooter>
        </div>
      )}

      {/* ── Passo 3: categorizzazione e import ── */}
      {step === 3 && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-soft">
            <Sparkles className="size-4 text-accent" />
            Le regole hanno categorizzato{" "}
            <strong>{rows.filter((r) => r.fromRule).length}</strong> righe. Correggi a mano dove
            serve: da ogni correzione puoi creare una nuova regola.
            <Badge tone="warn">{rows.filter((r) => r.duplicate).length} duplicati ignorati</Badge>
            {rows.some((r) => !r.valid) && (
              <Badge tone="neg">{rows.filter((r) => !r.valid).length} righe non valide</Badge>
            )}
            {aiCandidates.length > 0 && (
              <Button variant="outline" onClick={() => void categorizeWithAi()} disabled={aiBusy}>
                <Sparkles className="size-4" />
                {aiBusy ? "Il sumo classifica…" : `Categorizza con l'AI (${aiCandidates.length})`}
              </Button>
            )}
          </div>
          {/* mobile: card list */}
          <ul className="flex max-h-96 flex-col gap-2 overflow-y-auto sm:hidden">
            {rows.map((r) => (
              <li
                key={r.index}
                className={`rounded-xl border border-line p-3 ${
                  r.duplicate || !r.valid ? "opacity-50" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium" title={r.description}>
                      {r.description}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-faint">
                      <span>{r.valid ? fmtDate(r.date) : "—"}</span>
                      {r.duplicate && <Badge tone="warn">duplicato</Badge>}
                      {!r.valid && <Badge tone="neg">{r.error}</Badge>}
                    </div>
                  </div>
                  <span
                    className={`tnum shrink-0 text-sm font-semibold ${
                      r.amount > 0 ? "text-pos" : "text-neg"
                    }`}
                  >
                    {fmtEUR(r.amount)}
                  </span>
                </div>
                {r.valid && !r.duplicate && (
                  <div className="mt-2 flex items-center gap-2">
                    <select
                      value={r.categoryFinal}
                      onChange={(e) =>
                        setRows((rs) =>
                          rs.map((x) =>
                            x.index === r.index
                              ? { ...x, categoryFinal: e.target.value, fromRule: false }
                              : x
                          )
                        )
                      }
                      className="min-h-9 flex-1 rounded-lg border border-line bg-surface px-2 py-1 text-xs"
                      aria-label={`Categoria per ${r.description}`}
                    >
                      {[...new Set([...allCategories, r.categoryFinal])].map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <button
                      className="shrink-0 text-xs font-medium text-accent hover:underline"
                      onClick={() => setRuleFor(r)}
                    >
                      crea regola
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>

          {/* desktop: tabella */}
          <div className="hidden max-h-96 overflow-x-auto overflow-y-auto rounded-xl border border-line sm:block">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface-2 text-left">
                <tr>
                  <th className="px-3 py-2 font-semibold">Data</th>
                  <th className="px-3 py-2 font-semibold">Descrizione</th>
                  <th className="px-3 py-2 text-right font-semibold">Importo</th>
                  <th className="px-3 py-2 font-semibold">Categoria</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.index} className={r.duplicate || !r.valid ? "opacity-45" : ""}>
                    <td className="whitespace-nowrap px-3 py-1.5">
                      {r.valid ? fmtDate(r.date) : "—"}
                    </td>
                    <td className="max-w-56 truncate px-3 py-1.5" title={r.description}>
                      {r.description}
                      {r.duplicate && (
                        <Badge tone="warn" className="ml-1.5">
                          duplicato
                        </Badge>
                      )}
                      {!r.valid && (
                        <Badge tone="neg" className="ml-1.5">
                          {r.error}
                        </Badge>
                      )}
                    </td>
                    <td
                      className={`tnum whitespace-nowrap px-3 py-1.5 text-right font-medium ${
                        r.amount > 0 ? "text-pos" : "text-neg"
                      }`}
                    >
                      {fmtEUR(r.amount)}
                    </td>
                    <td className="px-3 py-1.5">
                      {r.valid && !r.duplicate ? (
                        <select
                          value={r.categoryFinal}
                          onChange={(e) =>
                            setRows((rs) =>
                              rs.map((x) =>
                                x.index === r.index
                                  ? { ...x, categoryFinal: e.target.value, fromRule: false }
                                  : x
                              )
                            )
                          }
                          className="rounded-lg border border-line bg-surface px-2 py-1 text-xs"
                          aria-label={`Categoria per ${r.description}`}
                        >
                          {[...new Set([...allCategories, r.categoryFinal])].map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5">
                      {r.valid && !r.duplicate && (
                        <button
                          className="text-accent hover:underline"
                          onClick={() => setRuleFor(r)}
                        >
                          crea regola
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ModalFooter>
            <Button variant="outline" onClick={() => setStep(2)}>
              Indietro
            </Button>
            <Button onClick={doImport} disabled={rows.every((r) => !r.include)}>
              Importa {rows.filter((r) => r.include && r.valid && !r.duplicate).length} movimenti
            </Button>
          </ModalFooter>
        </div>
      )}

      {ruleFor && (
        <RuleModal
          row={ruleFor}
          categories={allCategories}
          onClose={() => setRuleFor(null)}
          onCreated={(rule) => {
            setLocalRules((rs) => [...rs, rule]);
            // riapplica la nuova regola alle righe non corrette a mano
            setRows((rs) =>
              rs.map((r) => {
                if (!r.valid || r.duplicate) return r;
                if (
                  r.description.toLowerCase().includes(rule.pattern.toLowerCase()) &&
                  (rule.type === "entrambi" ||
                    (rule.type === "entrata" && r.amount > 0) ||
                    (rule.type === "uscita" && r.amount < 0))
                ) {
                  return { ...r, categoryFinal: rule.category, fromRule: true };
                }
                return r;
              })
            );
            setRuleFor(null);
          }}
        />
      )}
    </Modal>
  );
}

function ColSelect({
  headers,
  value,
  onChange,
}: {
  headers: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— scegli —</option>
      {headers.map((h) => (
        <option key={h} value={h}>
          {h}
        </option>
      ))}
    </Select>
  );
}

function RuleModal({
  row,
  categories,
  onClose,
  onCreated,
}: {
  row: RowState;
  categories: string[];
  onClose: () => void;
  onCreated: (rule: ImportRule) => void;
}) {
  const { showToast } = useToast();
  const [pattern, setPattern] = useState(row.description.split(/\s+/)[0] ?? "");
  const [category, setCategory] = useState(row.categoryFinal);
  const [type, setType] = useState<ImportRule["type"]>(row.amount > 0 ? "entrata" : "uscita");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!pattern.trim()) {
      showToast("Serve un testo da cercare nella descrizione", { kind: "error" });
      return;
    }
    const rule: ImportRule = {
      id: uid(),
      pattern: pattern.trim(),
      category,
      type,
      active: true,
    };
    await storage.put("importRules", rule);
    showToast(`Regola creata: "${rule.pattern}" → ${rule.category}`, { kind: "success" });
    onCreated(rule);
  }

  return (
    <Modal open onClose={onClose} title="Crea regola da questa correzione">
      <form onSubmit={save} className="flex flex-col gap-4">
        <p className="text-xs text-soft">
          Ai prossimi import, ogni movimento la cui descrizione contiene questo testo verrà
          categorizzato automaticamente.
        </p>
        <Field label="Testo cercato nella descrizione">
          <Input value={pattern} onChange={(e) => setPattern(e.target.value)} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Categoria assegnata">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {[...new Set([...categories, category])].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Si applica a">
            <Select value={type} onChange={(e) => setType(e.target.value as ImportRule["type"])}>
              <option value="entrambi">entrate e uscite</option>
              <option value="entrata">solo entrate</option>
              <option value="uscita">solo uscite</option>
            </Select>
          </Field>
        </div>
        <ModalFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Annulla
          </Button>
          <Button type="submit">Crea regola</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
