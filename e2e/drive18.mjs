// Verifica abbonamenti auto-rilevati: 3 addebiti mensili identici → suggerimento
// → "È un abbonamento" lo crea con partenza dal mese prossimo → Ignora persiste
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
    await page.screenshot({ path: path.join(SHOTS, `f18-${name.replace(/\W+/g, "-")}.png`) });
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

const setDate = (iso) =>
  page.evaluate((v) => {
    const input = document.querySelector('dialog[open] input[type="date"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, v);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, iso);

await step("setup: 3 addebiti mensili identici", async () => {
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
  await clickText("button", "Salta per ora");
  await waitText("benvenuto in sumo finance");
  const d = new Date();
  for (const back of [3, 2, 1]) {
    await page.goto(`${BASE}/uscite`, { waitUntil: "networkidle2" });
    await clickText("button", "Nuova uscita");
    await waitText("descrizione");
    await page.type('dialog[open] input[placeholder*="es."]', "Disney Plus");
    const dec = await page.$$('dialog[open] input[inputmode="decimal"]');
    await dec[0].type("8,99");
    const m = new Date(d.getFullYear(), d.getMonth() - back, 12);
    await setDate(
      `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}-12`
    );
    await clickText("button", "Salva uscita");
    await waitText("uscita aggiunta");
  }
});

await step("suggerimento in Abbonamenti → creazione", async () => {
  await page.goto(`${BASE}/abbonamenti`, { waitUntil: "networkidle2" });
  await waitText("possibili abbonamenti rilevati");
  await waitText("disney plus");
  await clickText("button", "È un abbonamento");
  await waitText("dagli addebiti dal mese prossimo");
  // ora è in lista come abbonamento attivo
  await waitText("addebito il giorno 12");
  // il suggerimento è sparito
  const gone = await page.evaluate(
    () => !document.body.innerText.toLowerCase().includes("possibili abbonamenti rilevati")
  );
  if (!gone) throw new Error("il suggerimento doveva sparire dopo la creazione");
});
await page.screenshot({ path: path.join(SHOTS, "48-sub-detect.png") });

console.log("\n── Errori pagina ──");
if (consoleErrors.length === 0) console.log("(nessuno)");
else consoleErrors.forEach((e) => console.log(e));
await browser.close();
