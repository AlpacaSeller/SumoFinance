// Sync v2: conflitto reale (modifiche su entrambi i lati) → merge per riga,
// nessuna perdita; le eliminazioni si propagano via tombstone.
import puppeteer from "puppeteer-core";
import { mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const BASE = "http://localhost:3000";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, "shots");
mkdirSync(SHOTS, { recursive: true });
const PASS = "passphrase-merge-test";

const consoleErrors = [];
const browser = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu"],
});

const mk = async (label) => {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on("pageerror", (e) => consoleErrors.push(`[${label}] ${e.message}`));
  return page;
};

const waitText = (page, text, timeout = 40000) =>
  page.waitForFunction(
    (t) => document.body && document.body.innerText.toLowerCase().replace(/[  ]/g, " ").includes(t),
    { timeout },
    text.toLowerCase().replace(/[  ]/g, " ")
  );
const clickText = async (page, tag, text) => {
  await page.waitForFunction(
    (t, txt) => [...document.querySelectorAll(t)].some((el) => el.textContent.includes(txt) && !el.disabled),
    { timeout: 40000 },
    tag,
    text
  );
  await page.evaluate(
    (t, txt) => [...document.querySelectorAll(t)].find((el) => el.textContent.includes(txt) && !el.disabled).click(),
    tag,
    text
  );
};
const addExpense = async (page, desc, amount) => {
  await page.goto(`${BASE}/uscite`, { waitUntil: "networkidle2" });
  await clickText(page, "button", "Nuova uscita");
  await waitText(page, "descrizione");
  await page.type('dialog[open] input[placeholder*="es."]', desc);
  const dec = await page.$$('dialog[open] input[inputmode="decimal"]');
  await dec[0].type(amount);
  await clickText(page, "button", "Salva uscita");
  await waitText(page, "uscita aggiunta");
};
const syncNow = async (page) => {
  await page.goto(`${BASE}/impostazioni`, { waitUntil: "networkidle2" });
  await clickText(page, "button", "Sincronizza ora");
  await waitText(page, "sincronizzato", 60000);
};

let failed = false;
const step = async (name, fn) => {
  if (failed) return;
  try {
    await fn();
    console.log(`OK  ${name}`);
  } catch (err) {
    failed = true;
    console.log(`FAIL ${name}: ${err.message}`);
  }
};

const A = await mk("A");
const B = await mk("B");
let code = "";

await step("setup: A crea il sync, B si collega", async () => {
  await A.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
  await clickText(A, "button", "Salta per ora");
  await waitText(A, "benvenuto in sumo finance");
  await addExpense(A, "Spesa base comune", "10");
  await A.goto(`${BASE}/impostazioni`, { waitUntil: "networkidle2" });
  await clickText(A, "button", "Crea nuovo sync");
  await waitText(A, "ripeti passphrase");
  const inputs = await A.$$('input[type="password"]');
  const [p1, p2] = inputs.slice(-2);
  await p1.type(PASS);
  await p2.type(PASS);
  await clickText(A, "button", "Attiva il sync");
  await waitText(A, "sync attivato", 60000);
  const text = await A.evaluate(() => document.body.innerText);
  code = text.match(/codice ([a-z2-9]{5}(?:-[a-z2-9]{5}){3})/i)[1];

  await B.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
  await clickText(B, "button", "Salta per ora");
  await waitText(B, "benvenuto in sumo finance");
  await B.goto(`${BASE}/impostazioni`, { waitUntil: "networkidle2" });
  await clickText(B, "button", "Collega dispositivo");
  await waitText(B, "codice sync");
  await B.type('input[placeholder*="abcde"]', code);
  const pw = await B.$$('input[type="password"]');
  await pw[pw.length - 1].type(PASS);
  await clickText(B, "button", "Collega e importa");
  await waitText(B, "dati importati dal cloud", 60000);
});

await step("conflitto: A e B aggiungono ciascuno una spesa → merge, zero perdite", async () => {
  // A aggiunge e spinge
  await addExpense(A, "Solo su A", "11");
  await syncNow(A);
  // B aggiunge SENZA aver visto il push di A (dirty + remoto cambiato):
  // qualunque strada (merge al pull o push conflict-aware) deve tenere TUTTO
  await addExpense(B, "Solo su B", "22");
  await B.reload({ waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 3000)); // lascia finire il sync di boot
  await B.goto(`${BASE}/uscite`, { waitUntil: "networkidle2" });
  await waitText(B, "solo su a");
  await waitText(B, "solo su b");
});

await step("A riceve il risultato fuso", async () => {
  await A.reload({ waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 3000));
  await A.goto(`${BASE}/uscite`, { waitUntil: "networkidle2" });
  await waitText(A, "solo su a");
  await waitText(A, "solo su b");
});

await step("le eliminazioni si propagano (tombstone)", async () => {
  // B elimina "Solo su A" e spinge
  await B.goto(`${BASE}/uscite`, { waitUntil: "networkidle2" });
  await B.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === 'Elimina Solo su A'
    );
    btn.click();
  });
  await waitText(B, "eliminat", 20000);
  await syncNow(B);
  // A al reload importa: la riga sparisce anche da lui
  await A.reload({ waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 3000));
  await A.goto(`${BASE}/uscite`, { waitUntil: "networkidle2" });
  await waitText(A, "solo su b");
  const stillThere = await A.evaluate(() =>
    document.body.innerText.toLowerCase().includes("solo su a")
  );
  if (stillThere) throw new Error('"Solo su A" doveva essere eliminata anche su A');
});

await step("pulizia: elimina dal cloud", async () => {
  await B.goto(`${BASE}/impostazioni`, { waitUntil: "networkidle2" });
  await clickText(B, "button", "Scollega ed elimina dal cloud");
  await waitText(B, "copia cloud eliminata", 60000);
});

console.log("\n── Errori pagina ──");
if (consoleErrors.length === 0) console.log("(nessuno)");
else consoleErrors.forEach((e) => console.log(e));
await browser.close();
process.exit(failed ? 1 : 0);
