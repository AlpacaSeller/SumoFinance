// Verifica batch: deep-link Siri (?new=1&desc=&importo=) e BTP (cedole nel calendario, YTM)
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
    await page.screenshot({ path: path.join(SHOTS, `f20-${name.replace(/\W+/g, "-")}.png`) });
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

await step("deep-link Siri: modale precompilato da URL", async () => {
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
  await clickText("button", "Salta per ora");
  await waitText("benvenuto in sumo finance");
  await page.goto(
    `${BASE}/uscite?new=1&desc=${encodeURIComponent("Caffè al bar")}&importo=1,20`,
    { waitUntil: "networkidle2" }
  );
  await waitText("nuova uscita");
  const vals = await page.evaluate(() => {
    const desc = document.querySelector('dialog[open] input[placeholder*="es."]');
    const dec = document.querySelector('dialog[open] input[inputmode="decimal"]');
    return { desc: desc?.value, amount: dec?.value };
  });
  if (vals.desc !== "Caffè al bar") throw new Error(`descrizione: ${vals.desc}`);
  if (vals.amount !== "1,2" && vals.amount !== "1,20") throw new Error(`importo: ${vals.amount}`);
  await clickText("button", "Salva uscita");
  await waitText("uscita aggiunta");
});

await step("BTP: campi cedola nel modale, cedole nel calendario, YTM", async () => {
  await page.goto(`${BASE}/investimenti`, { waitUntil: "networkidle2" });
  await clickText("button", "Aggiungi un asset");
  await waitText("fonte prezzo");
  await page.type('dialog[open] input[placeholder="es. Vanguard FTSE All-World"]', "BTP Tf 3,85% Lg34");
  // classe → Obbligazioni, fonte → manuale
  const selects = await page.$$("dialog[open] select");
  await selects[0].select("Obbligazioni");
  await selects[1].select("manuale");
  await waitText("cedola % annua lorda");
  await waitText("lotti da 100");
  const decs = await page.$$('dialog[open] input[inputmode="decimal"]');
  await decs[0].type("100"); // quantità (10.000 nominali)
  await decs[1].type("98,5"); // PMC
  await new Promise((r) => setTimeout(r, 300));
  const decs2 = await page.$$('dialog[open] input[inputmode="decimal"]');
  await decs2[2].type("97"); // prezzo attuale
  // scadenza (secondo input date del modale: il primo è la data di carico)
  await page.evaluate(() => {
    const dates = [...document.querySelectorAll('dialog[open] input[type="date"]')];
    const input = dates[dates.length - 1];
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    // scadenza a metà settembre: la cedola semestrale cade entro i 90 giorni
    setter.call(input, "2034-09-15");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  // cedola: l'ultimo input decimal dopo il re-render
  const decs3 = await page.$$('dialog[open] input[inputmode="decimal"]');
  await decs3[decs3.length - 1].type("3,85");
  await clickText("button", "Salva asset");
  await waitText("asset aggiunto");

  // dettaglio: YTM e prossima cedola
  await clickText("a", "BTP Tf 3,85%");
  await waitText("rendimento a scadenza");
  await waitText("cedola");

  // calendario: la cedola compare tra le voci
  await page.goto(`${BASE}/calendario`, { waitUntil: "networkidle2" });
  await waitText("cedola btp", 20000);
});
await page.screenshot({ path: path.join(SHOTS, "49-btp.png"), fullPage: false });

console.log("\n── Errori pagina ──");
if (consoleErrors.length === 0) console.log("(nessuno)");
else consoleErrors.forEach((e) => console.log(e));
await browser.close();
