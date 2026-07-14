// Verifica batch: dividendo, split, obiettivo→conto, prompt baseDate, tasse anno, report nav
import puppeteer from "puppeteer-core";
import { mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const BASE = "http://localhost:3000";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, "shots");
mkdirSync(SHOTS, { recursive: true });

const consoleErrors = [];
const browser = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(`[error] ${m.text()}`);
});
page.on("pageerror", (e) => consoleErrors.push(`[pageerror] ${e.message}`));

const step = async (name, fn) => {
  try {
    await fn();
    console.log(`OK  ${name}`);
  } catch (err) {
    console.log(`FAIL ${name}: ${err.message}`);
    await page.screenshot({ path: path.join(SHOTS, `f13-${name.replace(/\W+/g, "-")}.png`) });
    await browser.close();
    process.exit(1);
  }
};
const norm = (s) => s.toLowerCase().replace(/[  ]/g, " ");
const waitText = (text, timeout = 15000) =>
  page.waitForFunction(
    (t) => document.body && document.body.innerText.toLowerCase().replace(/[  ]/g, " ").includes(t),
    { timeout },
    norm(text)
  );
const clickText = async (tag, text) => {
  await page.waitForFunction(
    (t, txt) => [...document.querySelectorAll(t)].some((el) => el.textContent.includes(txt) && !el.disabled),
    { timeout: 15000 },
    tag,
    text
  );
  await page.evaluate(
    (t, txt) => [...document.querySelectorAll(t)].find((el) => el.textContent.includes(txt) && !el.disabled).click(),
    tag,
    text
  );
};

await step("salta onboarding", async () => {
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
  await clickText("button", "Salta per ora");
  await waitText("Benvenuto in Sumo Finance");
});

await step("asset manuale SENZA data di carico → card promemoria", async () => {
  await page.goto(`${BASE}/investimenti`, { waitUntil: "networkidle2" });
  await clickText("button", "Aggiungi un asset");
  await waitText("Fonte prezzo");
  await page.type('dialog[open] input[placeholder="es. Vanguard FTSE All-World"]', "ETF Acc Test");
  const selects = await page.$$("dialog[open] select");
  await selects[1].select("manuale");
  const decs = await page.$$('dialog[open] input[inputmode="decimal"]');
  await decs[0].type("10");
  await decs[1].type("100");
  await new Promise((r) => setTimeout(r, 300));
  const decs2 = await page.$$('dialog[open] input[inputmode="decimal"]');
  await decs2[2].type("120");
  // svuota la data di carico (default oggi) via setter nativo React-safe
  await page.evaluate(() => {
    const input = document.querySelector('dialog[open] input[type="date"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await clickText("button", "Salva asset");
  await waitText("Asset aggiunto");
  await waitText("1 asset senza data di carico");
  // compila la data dalla card
  await page.evaluate(() => {
    const input = document.querySelector('input[aria-label="Data di carico di ETF Acc Test"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, "2025-01-01");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await clickText("button", "Salva");
  await waitText("Data di carico salvata");
});

await step("dividendo: registrato e collegato alle entrate", async () => {
  await clickText("a", "ETF Acc Test");
  await waitText("Operazioni");
  await clickText("button", "Dividendo");
  await waitText("Importo netto incassato");
  const decs = await page.$$('dialog[open] input[inputmode="decimal"]');
  await decs[0].type("24,35");
  await clickText("button", "Registra dividendo");
  await waitText("entra nelle entrate e nell'XIRR");
  await waitText("incasso netto");
  // l'entrata collegata esiste
  await page.goto(`${BASE}/entrate`, { waitUntil: "networkidle2" });
  await waitText("Dividendo ETF Acc Test");
  await waitText("24,35");
});

await step("split ×10: quantità e PMC ricalcolati", async () => {
  await page.goto(`${BASE}/investimenti`, { waitUntil: "networkidle2" });
  await clickText("a", "ETF Acc Test");
  await waitText("Operazioni");
  await clickText("button", "Split");
  await waitText("Fattore dello split");
  const decs = await page.$$('dialog[open] input[inputmode="decimal"]');
  await decs[0].type("10");
  await waitText("100 unità a PMC 10,00");
  await clickText("button", "Applica split");
  await waitText("quantità e PMC ricalcolati");
  await waitText("100 × 120,00"); // KPI valore attuale (prezzo resta 120)
  await waitText("PMC 10,00");
  // politica dividendi dedotta dal nome ("Acc")
  await waitText("Accumulazione");
});

await step("obiettivo collegato al conto: versato = saldo", async () => {
  await page.goto(`${BASE}/conti`, { waitUntil: "networkidle2" });
  await clickText("button", "Nuovo conto");
  await waitText("Saldo attuale");
  await page.type('dialog[open] input[placeholder="es. Conto principale"]', "Deposito Viaggio");
  await page.type('dialog[open] input[inputmode="decimal"]', "1.200");
  await clickText("button", "Salva conto");
  await waitText("Conto aggiunto");
  await page.goto(`${BASE}/obiettivi`, { waitUntil: "networkidle2" });
  await clickText("button", "Crea il primo obiettivo");
  await waitText("Collega a un conto");
  await page.type('dialog[open] input[placeholder="es. Anticipo casa"]', "Viaggio Giappone");
  const decs = await page.$$('dialog[open] input[inputmode="decimal"]');
  await decs[0].type("3.000");
  const selects = await page.$$("dialog[open] select");
  const lastSelect = selects[selects.length - 1];
  await lastSelect.select(await page.evaluate((s) => {
    const opt = [...s.options].find((o) => o.textContent.includes("Deposito Viaggio"));
    return opt ? opt.value : "";
  }, lastSelect));
  await clickText("button", "Salva obiettivo");
  await waitText("Obiettivo creato");
  await waitText("segue il saldo di");
  await waitText("1200,00"); // versato = saldo conto
  const noVersa = await page.evaluate(
    () => ![...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Versa" || b.textContent.includes("Versa"))
  );
  if (!noVersa) throw new Error("il pulsante Versa non dovrebbe esserci per obiettivi collegati");
});
await page.screenshot({ path: path.join(SHOTS, "40-obiettivo-conto.png"), fullPage: true });

await step("report mensile navigabile (frecce presenti)", async () => {
  // crea un movimento del mese scorso per far comparire la card
  await page.goto(`${BASE}/uscite`, { waitUntil: "networkidle2" });
  await clickText("button", "Aggiungi un'uscita");
  await waitText("Nuova uscita");
  await page.type('dialog[open] input[placeholder="es. Spesa Esselunga"]', "Spesa storica");
  const decs = await page.$$('dialog[open] input[inputmode="decimal"]');
  await decs[0].type("100");
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  d.setDate(10);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-10`;
  await page.evaluate((v) => {
    const input = document.querySelector('dialog[open] input[type="date"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, v);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, iso);
  await clickText("button", "Salva uscita");
  await waitText("Uscita aggiunta");
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await waitText("Il tuo mese:");
  await page.click('button[aria-label="Mese precedente"]');
  await waitText("Nessun movimento registrato");
  await page.click('button[aria-label="Mese successivo"]');
  await waitText("100 €");
});

await step("tasse: selettore anno dopo vendita in anno passato", async () => {
  // vendita nel 2025 sull'asset esistente
  await page.goto(`${BASE}/investimenti`, { waitUntil: "networkidle2" });
  await clickText("a", "ETF Acc Test");
  await waitText("Operazioni");
  await clickText("button", "Vendita");
  await waitText("Registra vendita");
  const decs = await page.$$('dialog[open] input[inputmode="decimal"]');
  await decs[0].type("10");
  await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('dialog[open] input[inputmode="decimal"]')];
    inputs[1].focus();
  });
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.type("15");
  await page.evaluate(() => {
    const input = document.querySelector('dialog[open] input[type="date"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, "2025-11-10");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await clickText("button", "Registra vendita");
  await waitText("plusvalenza");
  await page.goto(`${BASE}/tasse`, { waitUntil: "networkidle2" });
  await page.waitForSelector('select[aria-label="Anno fiscale"]', { visible: true, timeout: 10000 });
  await page.select('select[aria-label="Anno fiscale"]', "2025");
  await waitText("Stime sull'anno 2025");
  await waitText("50,00"); // 10 × (15 − 10) = 50 di plusvalenza 2025
});
await page.screenshot({ path: path.join(SHOTS, "41-tasse-anno.png"), fullPage: true });

console.log("\n── Errori console ──");
if (consoleErrors.length === 0) console.log("(nessuno)");
else consoleErrors.forEach((e) => console.log(e));

await browser.close();
