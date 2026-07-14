// Verifica batch: TWR, tag sui movimenti, report annuale, sezione push
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
page.on("pageerror", (e) => consoleErrors.push(`[pageerror] ${e.message}`));

const step = async (name, fn) => {
  try {
    await fn();
    console.log(`OK  ${name}`);
  } catch (err) {
    console.log(`FAIL ${name}: ${err.message}`);
    await page.screenshot({ path: path.join(SHOTS, `f17-${name.replace(/\W+/g, "-")}.png`) });
    await browser.close();
    process.exit(1);
  }
};
const waitText = (text, timeout = 30000) =>
  page.waitForFunction(
    (t) => document.body && document.body.innerText.toLowerCase().replace(/[  ]/g, " ").includes(t),
    { timeout },
    text.toLowerCase().replace(/[  ]/g, " ")
  );
const clickText = async (tag, text) => {
  await page.waitForFunction(
    (t, txt) => [...document.querySelectorAll(t)].some((el) => el.textContent.includes(txt) && !el.disabled),
    { timeout: 30000 },
    tag,
    text
  );
  await page.evaluate(
    (t, txt) => [...document.querySelectorAll(t)].find((el) => el.textContent.includes(txt) && !el.disabled).click(),
    tag,
    text
  );
};

await step("demo + KPI TWR in Investimenti", async () => {
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
  await clickText("button", "provare subito con dati d'esempio");
  await waitText("dati d'esempio caricati");
  await page.goto(`${BASE}/investimenti`, { waitUntil: "networkidle2" });
  await waitText("twr");
  // con la demo (9 mesi di snapshot + flussi) il TWR deve essere computabile
  await waitText("annualizzato su");
});

await step("tag: uscita etichettata, chip e totali per tag", async () => {
  await page.goto(`${BASE}/uscite`, { waitUntil: "networkidle2" });
  await clickText("button", "Nuova uscita");
  await waitText("tag (facoltativi)");
  await page.type('dialog[open] input[placeholder*="es. Spesa"]', "Ryokan Kyoto");
  const dec = await page.$$('dialog[open] input[inputmode="decimal"]');
  await dec[0].type("180");
  await page.type('dialog[open] input[placeholder*="vacanza giappone"]', "Vacanza Giappone, viaggi");
  await clickText("button", "Salva uscita");
  await waitText("uscita aggiunta");
  await waitText("#vacanza giappone");
  await waitText("totali per tag");
  // click sul tag → filtra la ricerca
  await clickText("button", "#viaggi");
  await waitText("risultat");
  await waitText("ryokan kyoto");
});
await page.screenshot({ path: path.join(SHOTS, "47-tag.png"), fullPage: false });

await step("report annuale: si apre la finestra stampabile", async () => {
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await waitText("il tuo mese");
  const targetPromise = new Promise((resolve) => browser.once("targetcreated", resolve));
  await clickText("button", "Report 2026");
  const target = await targetPromise;
  const reportPage = await target.page();
  await reportPage.waitForFunction(
    () => document.body && document.body.innerText.includes("Report annuale 2026"),
    { timeout: 20000 }
  );
  const text = await reportPage.evaluate(() => document.body.innerText);
  if (!text.includes("Uscite per categoria")) throw new Error("sezione categorie mancante");
  if (!text.includes("Abbonamenti attivi")) throw new Error("sezione abbonamenti mancante");
  await reportPage.close();
});

await step("impostazioni: sezione notifiche push presente", async () => {
  await page.goto(`${BASE}/impostazioni`, { waitUntil: "networkidle2" });
  await waitText("notifiche push");
  await waitText("attiva le notifiche");
});

console.log("\n── Errori pagina ──");
if (consoleErrors.length === 0) console.log("(nessuno)");
else consoleErrors.forEach((e) => console.log(e));
await browser.close();
