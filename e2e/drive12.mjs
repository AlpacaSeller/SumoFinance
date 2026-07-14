// Verifica: ricerca asset, aliquota auto, crypto nella ricostruzione, dedup manuale
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
    await page.screenshot({ path: path.join(SHOTS, `f12-${name.replace(/\W+/g, "-")}.png`) });
    await browser.close();
    process.exit(1);
  }
};
const norm = (s) => s.toLowerCase().replace(/[  ]/g, " ");
const waitText = (text, timeout = 15000) =>
  page.waitForFunction(
    (t) => document.body && document.body.innerText.toLowerCase().replace(/[  ]/g, " ").includes(t),
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
const monthDate = (offset, day = 12) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  d.setDate(day);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};
const clearAndType = async (sel, text) => {
  const el = await page.$(sel);
  await el.focus();
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await el.type(text);
};

await step("salta onboarding", async () => {
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
  await clickText("button", "Salta per ora");
  await waitText("Benvenuto in Sumo Finance");
});

await step("ricerca asset 'apple' → auto-compilazione + aliquota 26%", async () => {
  await page.goto(`${BASE}/investimenti`, { waitUntil: "networkidle2" });
  await clickText("button", "Aggiungi un asset");
  await waitText("Cerca l'asset");
  await page.type('input[aria-label="Cerca un asset"]', "apple");
  await page.waitForFunction(
    () => [...document.querySelectorAll("dialog[open] ul li button")].some((b) => b.textContent.includes("Apple Inc") && b.textContent.includes("Azioni")),
    { timeout: 15000 }
  );
  await page.evaluate(() => {
    [...document.querySelectorAll("dialog[open] ul li button")].find((b) => b.textContent.includes("Apple Inc") && b.textContent.includes("Azioni")).click();
  });
  // il nome deve essersi compilato
  await page.waitForFunction(
    () => document.querySelector('dialog[open] input[placeholder="es. Vanguard FTSE All-World"]')?.value?.includes("Apple"),
    { timeout: 5000 }
  );
  await waitText("aliquota 26%");
});

await step("salva asset da ricerca → prezzo sincronizzato in automatico", async () => {
  const decs = await page.$$('dialog[open] input[inputmode="decimal"]');
  await decs[0].type("5"); // quantità
  await decs[1].type("100"); // PMC
  await clickText("button", "Salva asset");
  // feedback: toast con prezzo di Apple in EUR
  await waitText("Apple Inc.:", 30000);
  await waitText("Azioni"); // badge classe nella lista
});
await page.screenshot({ path: path.join(SHOTS, "38-ricerca-apple.png"), fullPage: true });

await step("ricerca 'bitcoin' → classe Crypto, aliquota 33%, provider CoinGecko", async () => {
  await clickText("button", "Nuovo asset");
  await waitText("Cerca l'asset");
  await page.type('input[aria-label="Cerca un asset"]', "bitcoin");
  await page.waitForFunction(
    () => [...document.querySelectorAll("dialog[open] ul li button")].some((b) => /bitcoin/i.test(b.textContent) && b.textContent.includes("Crypto")),
    { timeout: 15000 }
  );
  await page.evaluate(() => {
    [...document.querySelectorAll("dialog[open] ul li button")].find((b) => /^bitcoin/i.test(b.textContent.trim()) && b.textContent.includes("Crypto")).click();
  });
  await waitText("aliquota 33%");
  // data di carico retrodatata per la ricostruzione storica
  const decs = await page.$$('dialog[open] input[inputmode="decimal"]');
  await decs[0].type("0,1");
  await decs[1].type("40.000");
  const dateInput = await page.$('dialog[open] input[type="date"]');
  await clearAndType('dialog[open] input[type="date"]', "");
  await dateInput.type(monthDate(-8, 1).split("/").reverse().join("-"));
  await clickText("button", "Salva asset");
  await waitText("Bitcoin:", 30000);
});
await page.screenshot({ path: path.join(SHOTS, "39-ricerca-bitcoin.png"), fullPage: true });

await step("crypto inclusa nella ricostruzione valore investimenti", async () => {
  await waitText("Valore investimenti — ultimi 12 mesi", 20000);
  // bitcoin NON deve essere tra gli esclusi
  const excluded = await page.evaluate(() => {
    const el = [...document.querySelectorAll("p")].find((p) => p.textContent.includes("Esclusi"));
    return el ? el.textContent : "";
  });
  if (/bitcoin/i.test(excluded)) throw new Error("Bitcoin risulta escluso dalla ricostruzione");
});

await step("dedup manuale: uscita identica avvisata", async () => {
  await page.goto(`${BASE}/uscite`, { waitUntil: "networkidle2" });
  for (let i = 0; i < 2; i++) {
    await clickText("button", i === 0 ? "Aggiungi un'uscita" : "Nuova uscita");
    await waitText("Nuova uscita");
    await page.type('dialog[open] input[placeholder="es. Spesa Esselunga"]', "Caffè bar");
    const decs = await page.$$('dialog[open] input[inputmode="decimal"]');
    await decs[0].type("1,50");
    if (i === 0) {
      await clickText("button", "Salva uscita");
      await waitText("Uscita aggiunta");
    } else {
      // secondo inserimento identico → deve avvisare
      await clickText("button", "Salva uscita");
      await waitText("sembra un movimento già presente", 8000);
      // chiudo senza duplicare
      await page.keyboard.press("Escape");
    }
    await new Promise((r) => setTimeout(r, 400));
  }
});

console.log("\n── Errori console ──");
if (consoleErrors.length === 0) console.log("(nessuno)");
else consoleErrors.forEach((e) => console.log(e));

await browser.close();
