// Verifica end-to-end PFOS: onboarding → dashboard → persistenza → screenshot
import puppeteer from "puppeteer-core";
import { mkdirSync } from "fs";

const BASE = "http://localhost:3000";
const SHOTS = new URL("./shots/", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
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
page.on("console", (msg) => {
  if (msg.type() === "error" || msg.type() === "warning") {
    consoleErrors.push(`[${msg.type()}] ${msg.text()}`);
  }
});
page.on("pageerror", (err) => consoleErrors.push(`[pageerror] ${err.message}`));

const step = async (name, fn) => {
  try {
    await fn();
    console.log(`OK  ${name}`);
  } catch (err) {
    console.log(`FAIL ${name}: ${err.message}`);
    await page.screenshot({ path: `${SHOTS}fail-${name.replace(/\W+/g, "-")}.png` });
    throw err;
  }
};

const type = async (sel, text) => {
  await page.waitForSelector(sel, { visible: true, timeout: 8000 });
  await page.focus(sel);
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.type(sel, text);
};
const clickText = async (tag, text) => {
  await page.waitForFunction(
    (t, txt) => [...document.querySelectorAll(t)].some((el) => el.textContent.trim().includes(txt)),
    { timeout: 10000 },
    tag,
    text
  );
  await page.evaluate(
    (t, txt) => {
      const el = [...document.querySelectorAll(t)].find((e) => e.textContent.trim().includes(txt));
      el.click();
    },
    tag,
    text
  );
};
const waitText = (text, timeout = 10000) =>
  page.waitForFunction(
    (txt) => document.body && document.body.innerText.toLowerCase().includes(txt.toLowerCase()),
    { timeout },
    text
  );

// ── 1. primo avvio → redirect a onboarding ──
await step("primo avvio reindirizza all'onboarding", async () => {
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
  await waitText("Il tuo sistema operativo finanziario");
  if (!page.url().includes("/onboarding")) throw new Error(`url = ${page.url()}`);
});
await page.screenshot({ path: `${SHOTS}01-onboarding.png` });

// ── 2. wizard completo ──
await step("passo 1→2: profilo", async () => {
  await clickText("button", "Iniziamo");
  await waitText("Che investitore sei?");
});
await step("passo 2→3: conto", async () => {
  await clickText("button", "Avanti");
  await waitText("Il tuo primo conto");
  await type('input[inputmode="decimal"]', "3.500,00");
});
await step("passo 3→4: stipendio ricorrente (giorno 11 = oggi)", async () => {
  await clickText("button", "Avanti");
  await waitText("La tua entrata principale");
  await type('input[inputmode="decimal"]', "1.850,00");
  await type('input[type="number"]', "11");
});
await step("passo 4→5: spese del mese", async () => {
  await clickText("button", "Avanti");
  await waitText("Le spese di questo mese");
  const inputs = await page.$$('input[inputmode="decimal"]');
  await inputs[0].type("800"); // Casa
  await inputs[1].type("400"); // Cibo
});
await step("passo 5→6: casa e mutuo e investimento", async () => {
  await clickText("button", "Avanti");
  await waitText("Casa e investimenti");
  const dec = await page.$$('input[inputmode="decimal"]');
  await dec[0].type("220.000"); // valore casa
  await dec[1].type("130.000"); // mutuo residuo
  await dec[2].type("620"); // rata
  await page.type('input[placeholder="es. ETF azionario"]', "ETF Mondo");
  await dec[3].type("5.000");
});
await step("passo 6→7: salta PIN", async () => {
  await clickText("button", "Avanti");
  await waitText("PIN di sblocco");
});
await step("passo 7→8: riepilogo e fine", async () => {
  await clickText("button", "Avanti");
  await waitText("Tutto pronto");
  await page.screenshot({ path: `${SHOTS}02-riepilogo.png` });
  await clickText("button", "Vai alla dashboard");
  await waitText("Patrimonio netto", 20000);
});

// ── 3. dashboard con dati coerenti ──
await step("dashboard: netto 98.500 €, netto finanziario 8500 €", async () => {
  await waitText("98.500,00");
  await waitText("Netto finanziario (senza immobili): 8500");
});
await step("dashboard mostra i KPI derivati (tasso di risparmio)", async () => {
  // il valore esatto dipende dal giorno del mese (maturazione ricorrenti):
  // qui verifichiamo solo che il KPI sia presente e calcolato
  await waitText("Tasso di risparmio");
  await waitText("Oggi puoi spendere");
});
await page.screenshot({ path: `${SHOTS}03-dashboard-desktop.png`, fullPage: true });

// ── 4. persistenza dopo reload + niente duplicati ricorrenti ──
await step("reload: dati persistono, stipendio non duplicato", async () => {
  await page.reload({ waitUntil: "networkidle2" });
  await waitText("Patrimonio netto", 20000);
  await waitText("98.500,00");
  await page.goto(`${BASE}/entrate`, { waitUntil: "networkidle2" });
  await waitText("Stipendio");
  const count = await page.evaluate(
    () => (document.body.innerText.match(/Stipendio/g) || []).length
  );
  // 1 nel movimento + 1 nella sezione ricorrenti (+1 eventuale badge categoria)
  if (count > 4) throw new Error(`"Stipendio" appare ${count} volte: possibile duplicato`);
  const totals = await page.evaluate(() =>
    (document.body.innerText.match(/1850,00/g) || []).length
  );
  if (totals < 1) throw new Error("importo stipendio non trovato");
});
await page.screenshot({ path: `${SHOTS}04-entrate.png`, fullPage: true });

// ── 5. debiti: equity e LTV ──
await step("debiti: equity 90.000 e LTV 59,1%", async () => {
  await page.goto(`${BASE}/debiti`, { waitUntil: "networkidle2" });
  await waitText("equity");
  await waitText("90.000,00");
  await waitText("LTV 59,1%");
});
await page.screenshot({ path: `${SHOTS}05-debiti.png` });

// ── 6. consigli attivi ──
await step("consigli: almeno 3 card", async () => {
  await page.goto(`${BASE}/consigli`, { waitUntil: "networkidle2" });
  await waitText("Consigli");
  const n = await page.evaluate(() => document.querySelectorAll("article").length);
  if (n < 3) throw new Error(`solo ${n} consigli`);
});
await page.screenshot({ path: `${SHOTS}06-consigli.png`, fullPage: true });

// ── 7. simulazioni reattive ──
await step("simulazioni: fan chart e probabilità FIRE", async () => {
  await page.goto(`${BASE}/simulazioni`, { waitUntil: "networkidle2" });
  await waitText("Probabilità FIRE");
  await waitText("Scenario mediano", 15000).catch(() => {});
  const t0 = Date.now();
  await type('input[inputmode="decimal"]', "1.000");
  await waitText("Proiezione del patrimonio");
  if (Date.now() - t0 > 3000) throw new Error("ricalcolo lento");
});
await page.screenshot({ path: `${SHOTS}07-simulazioni.png`, fullPage: true });

// ── 8. mobile 390px ──
await step("viewport mobile 390px", async () => {
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await waitText("Patrimonio netto", 20000);
  await page.screenshot({ path: `${SHOTS}08-dashboard-mobile.png`, fullPage: true });
  // bottom bar presente + apri il menu completo
  await page.waitForSelector('nav[aria-label="Navigazione principale"]', { visible: true });
  await page.click('button[aria-label="Apri menu completo"]');
  await waitText("Calendario economico");
  await page.screenshot({ path: `${SHOTS}09-drawer-mobile.png` });
});

console.log("\n── Errori console raccolti ──");
if (consoleErrors.length === 0) console.log("(nessuno)");
else consoleErrors.forEach((e) => console.log(e));

await browser.close();
