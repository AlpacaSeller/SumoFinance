// Verifica Livello 1: modalità demo (onboarding → dashboard viva → azzera) + pagina privacy
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
    await page.screenshot({ path: path.join(SHOTS, `f14-${name.replace(/\W+/g, "-")}.png`) });
    await browser.close();
    process.exit(1);
  }
};
const waitText = (text, timeout = 20000) =>
  page.waitForFunction(
    (t) => document.body && document.body.innerText.toLowerCase().replace(/[  ]/g, " ").includes(t),
    { timeout },
    text.toLowerCase().replace(/[  ]/g, " ")
  );
const clickText = async (tag, text) => {
  await page.waitForFunction(
    (t, txt) => [...document.querySelectorAll(t)].some((el) => el.textContent.includes(txt) && !el.disabled),
    { timeout: 20000 },
    tag,
    text
  );
  await page.evaluate(
    (t, txt) => [...document.querySelectorAll(t)].find((el) => el.textContent.includes(txt) && !el.disabled).click(),
    tag,
    text
  );
};

await step("onboarding: link 'prova subito con dati d'esempio'", async () => {
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
  await waitText("provare subito con dati d'esempio");
  await clickText("button", "provare subito con dati d'esempio");
  await waitText("dati d'esempio caricati");
});

await step("dashboard viva: patrimonio, grafici e banner demo", async () => {
  await waitText("patrimonio netto");
  await waitText("stai guardando dati d'esempio");
  await waitText("indice di salute finanziaria");
  await waitText("andamento patrimonio");
  await waitText("il tuo mese"); // report mensile automatico popolato
});

await step("dati distribuiti: uscite, investimenti, obiettivi", async () => {
  await page.goto(`${BASE}/uscite`, { waitUntil: "networkidle2" });
  await waitText("affitto");
  await waitText("budget per categoria");
  await page.goto(`${BASE}/investimenti`, { waitUntil: "networkidle2" });
  await waitText("vanguard ftse all-world");
  await waitText("bitcoin");
  await page.goto(`${BASE}/obiettivi`, { waitUntil: "networkidle2" });
  await waitText("fondo emergenza");
  await waitText("segue il saldo di");
});
await page.screenshot({ path: path.join(SHOTS, "42-demo-dashboard.png"), fullPage: false });

await step("pagina privacy raggiungibile dalla sidebar", async () => {
  await page.goto(`${BASE}/privacy`, { waitUntil: "networkidle2" });
  await waitText("i tuoi dati non lasciano mai il tuo dispositivo");
  await waitText("niente tracciamento");
  await waitText("termini d'uso");
});
await page.screenshot({ path: path.join(SHOTS, "43-privacy.png"), fullPage: true });

await step("azzera e ricomincia: torna all'onboarding pulito", async () => {
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await clickText("button", "Azzera e ricomincia");
  await page.waitForFunction(() => location.pathname === "/onboarding", { timeout: 20000 });
  await waitText("il tuo sistema operativo finanziario");
  // il banner demo non c'è più
  const banner = await page.evaluate(() =>
    document.body.innerText.toLowerCase().includes("dati d'esempio caricati")
  );
  if (banner) throw new Error("il banner demo non dovrebbe più esserci");
});

console.log("\n── Errori console ──");
if (consoleErrors.length === 0) console.log("(nessuno)");
else consoleErrors.forEach((e) => console.log(e));

await browser.close();
