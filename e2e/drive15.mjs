// Verifica sync E2E: dispositivo A (demo) crea il sync, dispositivo B si
// collega col codice+passphrase e riceve i dati; una modifica su B torna su A.
import puppeteer from "puppeteer-core";
import { mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const BASE = "http://localhost:3000";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, "shots");
mkdirSync(SHOTS, { recursive: true });
const PASS = "passphrase-di-prova";

const consoleErrors = [];
const browser = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu"],
});

function wire(page, label) {
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(`[${label}] ${m.text()}`);
  });
  page.on("pageerror", (e) => consoleErrors.push(`[${label} pageerror] ${e.message}`));
}

const mk = async (label) => {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  wire(page, label);
  return page;
};

const waitText = (page, text, timeout = 30000) =>
  page.waitForFunction(
    (t) => document.body && document.body.innerText.toLowerCase().replace(/[  ]/g, " ").includes(t),
    { timeout },
    text.toLowerCase().replace(/[  ]/g, " ")
  );
const clickText = async (page, tag, text) => {
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

await step("A: carica la demo e attiva il sync", async () => {
  await A.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
  await clickText(A, "button", "provare subito con dati d'esempio");
  await waitText(A, "dati d'esempio caricati");
  await A.goto(`${BASE}/impostazioni`, { waitUntil: "networkidle2" });
  await clickText(A, "button", "Crea nuovo sync");
  await waitText(A, "ripeti passphrase");
  const inputs = await A.$$('input[type="password"]');
  const [p1, p2] = inputs.slice(-2);
  await p1.type(PASS);
  await p2.type(PASS);
  await clickText(A, "button", "Attiva il sync");
  await waitText(A, "sync attivato", 60000);
  await waitText(A, "codice ");
  const text = await A.evaluate(() => document.body.innerText);
  const m = text.match(/codice ([a-z2-9]{5}(?:-[a-z2-9]{5}){3})/i);
  if (!m) throw new Error("codice sync non trovato nella pagina");
  code = m[1];
  console.log(`    codice: ${code}`);
});

await step("B: si collega col codice e riceve i dati", async () => {
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
  await B.goto(`${BASE}/investimenti`, { waitUntil: "networkidle2" });
  await waitText(B, "vanguard ftse all-world");
  await waitText(B, "bitcoin");
});
if (!failed) await B.screenshot({ path: path.join(SHOTS, "44-sync-b.png") });

await step("B: aggiunge un'uscita e sincronizza", async () => {
  await B.goto(`${BASE}/uscite`, { waitUntil: "networkidle2" });
  await clickText(B, "button", "Nuova uscita");
  await waitText(B, "nuova uscita");
  await B.type('dialog[open] input[placeholder*="es."]', "Sushi test sync");
  const dec = await B.$$('dialog[open] input[inputmode="decimal"]');
  await dec[0].type("42");
  await clickText(B, "button", "Salva uscita");
  await waitText(B, "uscita aggiunta");
  await B.goto(`${BASE}/impostazioni`, { waitUntil: "networkidle2" });
  await clickText(B, "button", "Sincronizza ora");
  await waitText(B, "sincronizzato", 60000);
});

await step("A: al reload riceve la modifica di B", async () => {
  await A.reload({ waitUntil: "networkidle2" });
  await waitText(A, "dati sincronizzati dall'altro dispositivo", 60000);
  await A.goto(`${BASE}/uscite`, { waitUntil: "networkidle2" });
  await waitText(A, "sushi test sync");
});
if (!failed) await A.screenshot({ path: path.join(SHOTS, "45-sync-a.png") });

await step("pulizia: B scollega ed elimina dal cloud", async () => {
  await B.goto(`${BASE}/impostazioni`, { waitUntil: "networkidle2" });
  await clickText(B, "button", "Scollega ed elimina dal cloud");
  await waitText(B, "copia cloud eliminata", 60000);
});

console.log("\n── Errori console ──");
if (consoleErrors.length === 0) console.log("(nessuno)");
else consoleErrors.forEach((e) => console.log(e));
await browser.close();
process.exit(failed ? 1 : 0);
