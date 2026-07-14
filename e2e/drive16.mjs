// Verifica LlmAdvisor: promo card, configurazione BYOK, errore con key finta
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
    await page.screenshot({ path: path.join(SHOTS, `f16-${name.replace(/\W+/g, "-")}.png`) });
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

await step("demo + promo AI nella pagina Consigli", async () => {
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
  await clickText("button", "provare subito con dati d'esempio");
  await waitText("dati d'esempio caricati");
  await page.goto(`${BASE}/consigli`, { waitUntil: "networkidle2" });
  await waitText("il sumo può analizzare i tuoi numeri");
  await waitText("attiva in impostazioni");
});

await step("configura Gemini con una key finta", async () => {
  await page.goto(`${BASE}/impostazioni`, { waitUntil: "networkidle2" });
  await waitText("consigli ai — l'analisi del sumo");
  await waitText("aistudio.google.com"); // guida alla key gratuita presente
  await page.type('input[aria-label="API key AI"]', "AIzaFintaChiaveDiProva123");
  await clickText("button", "Attiva i consigli AI");
  await waitText("consigli ai configurati");
});

await step("key non valida → errore gestito, niente crash", async () => {
  await page.goto(`${BASE}/consigli`, { waitUntil: "networkidle2" });
  await waitText("l'analisi del sumo");
  await waitText("chiave gemini non valida", 60000);
  await waitText("controlla la chiave in impostazioni");
});
await page.screenshot({ path: path.join(SHOTS, "46-ai-section.png"), fullPage: false });

await step("chiedi al sumo: input presente, errore gestito con key finta", async () => {
  await page.waitForSelector('input[aria-label="Fai una domanda al sumo"]', {
    visible: true,
    timeout: 30000,
  });
  await new Promise((r) => setTimeout(r, 500));
  await page.click('input[aria-label="Fai una domanda al sumo"]');
  await page.keyboard.type("Posso permettermi 200 euro al mese di PAC?");
  await page.waitForFunction(
    () => document.querySelector('input[aria-label="Fai una domanda al sumo"]').value.length > 10,
    { timeout: 10000 }
  );
  await clickText("button", "Chiedi");
  // la sezione della domanda mostra il SUO errore (secondo box, stesso testo)
  await page.waitForFunction(
    () => document.querySelectorAll(".bg-warn-soft").length >= 2,
    { timeout: 60000 }
  );
});

await step("disattiva → torna la promo", async () => {
  await page.goto(`${BASE}/impostazioni`, { waitUntil: "networkidle2" });
  await clickText("button", "Disattiva");
  await waitText("consigli ai disattivati");
  await page.goto(`${BASE}/consigli`, { waitUntil: "networkidle2" });
  await waitText("attiva in impostazioni");
});

console.log("\n── Errori pagina ──");
if (consoleErrors.length === 0) console.log("(nessuno)");
else consoleErrors.forEach((e) => console.log(e));
await browser.close();
