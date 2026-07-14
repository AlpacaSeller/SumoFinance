// Verifica PFOS parte 2: sync prezzi, import CSV + dedupe, undo, PIN, backup
import puppeteer from "puppeteer-core";
import { mkdirSync, readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const BASE = "http://localhost:3000";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, "shots");
const DOWNLOADS = path.join(HERE, "downloads");
mkdirSync(SHOTS, { recursive: true });
mkdirSync(DOWNLOADS, { recursive: true });

const CSV = path.join(HERE, "..", "esempi", "estratto-conto-prova.csv");

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
const cdp = await page.createCDPSession();
await cdp.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: DOWNLOADS });

const step = async (name, fn) => {
  try {
    await fn();
    console.log(`OK  ${name}`);
  } catch (err) {
    console.log(`FAIL ${name}: ${err.message}`);
    await page.screenshot({ path: path.join(SHOTS, `f2-${name.replace(/\W+/g, "-")}.png`) });
    await browser.close();
    process.exit(1);
  }
};
const waitText = (text, timeout = 15000) =>
  page.waitForFunction(
    (t) => document.body && document.body.innerText.toLowerCase().includes(t.toLowerCase()),
    { timeout },
    text
  );
const waitGone = (text, timeout = 15000) =>
  page.waitForFunction(
    (t) => document.body && !document.body.innerText.toLowerCase().includes(t.toLowerCase()),
    { timeout },
    text
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
const type = async (sel, text, { scope } = {}) => {
  const root = scope ?? page;
  const el = await root.waitForSelector(sel, { visible: true, timeout: 8000 });
  await el.focus();
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await el.type(text);
};

// ── setup: salta onboarding ──
await step("salta onboarding", async () => {
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
  await waitText("Salta per ora");
  await clickText("button", "Salta per ora");
  await waitText("Benvenuto in Sumo Finance");
});

// ── sync prezzi: crypto via CoinGecko ──
await step("nuovo asset BTC (CoinGecko)", async () => {
  await page.goto(`${BASE}/investimenti`, { waitUntil: "networkidle2" });
  await clickText("button", "Nuovo asset");
  await waitText("Fonte prezzo");
  const dialog = await page.$("dialog[open]");
  await type('input[placeholder="es. Vanguard FTSE All-World"]', "Bitcoin", { scope: dialog });
  await page.select("dialog[open] select", "Crypto");
  const selects = await page.$$("dialog[open] select");
  await selects[1].select("coingecko");
  await type('dialog[open] input[placeholder="bitcoin"]', "bitcoin");
  const decs = await page.$$('dialog[open] input[inputmode="decimal"]');
  await decs[0].type("0,1"); // quantità
  await decs[1].type("50.000"); // PMC
  await clickText("button", "Salva asset");
  await waitText("Asset aggiunto");
});

await step("nuovo asset VWCE.MI (Yahoo)", async () => {
  await clickText("button", "Nuovo asset");
  await waitText("Fonte prezzo");
  const dialog = await page.$("dialog[open]");
  await type('input[placeholder="es. Vanguard FTSE All-World"]', "VWCE", { scope: dialog });
  // classe ETF (default), fonte yahoo (default)
  await type('dialog[open] input[placeholder="VWCE.MI"]', "VWCE.MI");
  const decs = await page.$$('dialog[open] input[inputmode="decimal"]');
  await decs[0].type("10");
  await decs[1].type("100");
  await clickText("button", "Salva asset");
  await waitText("Asset aggiunto");
});

await step("sincronizza prezzi: BTC da CoinGecko, VWCE via proxy Yahoo", async () => {
  await clickText("button", "Sincronizza prezzi");
  await waitText("Prezzi aggiornati per 2 asset", 30000);
  // i prezzi live cambiano: verifica strutturale (sync avvenuta + tasse latenti)
  await waitText("tasse se vendi");
  await page.waitForFunction(() => /sync \d+ \w+/.test(document.body.innerText), { timeout: 10000 });
  const btcOk = await page.evaluate(() => !document.body.innerText.includes("5000,00 €"));
  if (!btcOk) throw new Error("il prezzo BTC non risulta aggiornato dal PMC iniziale");
});
await page.screenshot({ path: path.join(SHOTS, "10-investimenti-sync.png"), fullPage: true });

await step("dettaglio asset: storico 1 anno", async () => {
  await clickText("a", "VWCE");
  await waitText("Storico prezzo — 1 anno", 20000);
  await waitText("Fonte Yahoo Finance", 20000);
});
await page.screenshot({ path: path.join(SHOTS, "11-dettaglio-asset.png"), fullPage: true });

// ── import CSV ──
await step("import CSV passo 1: caricamento e anteprima", async () => {
  await page.goto(`${BASE}/entrate`, { waitUntil: "networkidle2" });
  await clickText("button", "Importa CSV");
  await waitText("Scegli file CSV");
  const input = await page.$('dialog[open] input[type="file"]');
  await input.uploadFile(CSV);
  await waitText("BONIFICO STIPENDIO");
  await waitText("9 righe totali");
  await waitText('separatore rilevato ";"');
});

await step("import CSV passo 2: mappatura auto + profilo banca", async () => {
  await clickText("button", "Avanti: mappa le colonne");
  await waitText("Convenzione importo");
  const mapped = await page.evaluate(() => {
    const sels = [...document.querySelectorAll("dialog[open] select")];
    return sels.map((s) => s.value).join("|");
  });
  if (!mapped.includes("Data") || !mapped.includes("Descrizione")) {
    throw new Error(`euristica mappatura fallita: ${mapped}`);
  }
  await type('dialog[open] input[placeholder="Nome banca"]', "Banca Test");
  await clickText("button", "Salva profilo");
  await waitText("salvato: al prossimo import basta un clic");
});

await step("import CSV passo 3: regola da correzione + import", async () => {
  await clickText("button", "Avanti: categorie");
  await waitText("duplicati ignorati");
  // crea una regola dalla riga ESSELUNGA
  await page.evaluate(() => {
    const row = [...document.querySelectorAll("dialog[open] tbody tr")].find((r) =>
      r.innerText.includes("ESSELUNGA")
    );
    [...row.querySelectorAll("button")].find((b) => b.textContent.includes("crea regola")).click();
  });
  await waitText("Crea regola da questa correzione");
  await type('dialog[open] dialog[open] input, dialog[open] input[value]', "ESSELUNGA").catch(async () => {
    // fallback: primo input della modale regola
    const inputs = await page.$$("dialog[open] input");
    await inputs[inputs.length ? 0 : 0].focus();
  });
  // imposta pattern e categoria nella modale regola (ultima dialog aperta)
  await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll("dialog[open]")];
    const d = dialogs[dialogs.length - 1];
    const sel = d.querySelector("select");
    sel.value = "Cibo";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await clickText("button", "Crea regola");
  await waitText("Regola creata");
  await clickText("button", "Importa 9 movimenti");
  await waitText("Importati 9 movimenti", 20000);
});

await step("re-import: tutti i 9 duplicati saltati", async () => {
  await clickText("button", "Importa CSV");
  const input = await page.$('dialog[open] input[type="file"]');
  await input.uploadFile(CSV);
  await waitText("9 righe totali");
  await clickText("button", "Avanti: mappa le colonne");
  // usa il profilo banca salvato
  await clickText("dialog[open] button", "Banca Test");
  await waitText("applicato");
  await clickText("button", "Avanti: categorie");
  await waitText("9 duplicati ignorati");
  const disabled = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("dialog[open] button")].find((b) =>
      b.textContent.includes("Importa 0 movimenti")
    );
    return btn ? btn.disabled : null;
  });
  if (disabled !== true) throw new Error("bottone import non disabilitato con 0 movimenti");
  await page.keyboard.press("Escape");
  await waitGone("Importa 0 movimenti");
});
await page.screenshot({ path: path.join(SHOTS, "12-entrate-import.png"), fullPage: true });

// ── undo eliminazione ──
await step("elimina movimento → Annulla lo ripristina", async () => {
  await waitText("BONIFICO STIPENDIO");
  const rowCount = () =>
    page.evaluate(
      () =>
        [...document.querySelectorAll("li")].filter((li) =>
          li.innerText.includes("BONIFICO STIPENDIO LUGLIO")
        ).length
    );
  const before = await rowCount();
  if (before < 1) throw new Error("riga stipendio non trovata prima del delete");
  await page.evaluate(() => {
    [...document.querySelectorAll('button[aria-label^="Elimina BONIFICO"]')][0].click();
  });
  await waitText("eliminato");
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("li")].filter((li) =>
        li.innerText.includes("BONIFICO STIPENDIO LUGLIO")
      ).length === 0,
    { timeout: 8000 }
  );
  // clicca l'"Annulla" ESATTO del toast di eliminazione (non "Annulla import")
  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent.trim() === "Annulla")
      .click();
  });
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("li")].filter((li) =>
        li.innerText.includes("BONIFICO STIPENDIO LUGLIO")
      ).length >= 1,
    { timeout: 8000 }
  );
});

// ── PIN: attiva, blocca, sblocca, cambia, disattiva ──
await step("PIN: attivazione", async () => {
  await page.goto(`${BASE}/impostazioni`, { waitUntil: "networkidle2" });
  await clickText("button", "Attiva PIN");
  await waitText("Nuovo PIN");
  const pins = await page.$$('dialog[open] input[type="password"]');
  await pins[0].type("1234");
  await pins[1].type("1234");
  await page.evaluate(() => {
    const d = document.querySelector("dialog[open]");
    [...d.querySelectorAll("button")].find((b) => b.textContent.trim() === "Attiva").click();
  });
  await waitText("PIN attivato");
});

await step("PIN: blocco col lucchetto e sblocco", async () => {
  await page.click('button[aria-label="Blocca l\'app"]');
  await waitText("Entra");
  await page.type('input[aria-label="PIN a 4 cifre"]', "9999");
  await clickText("button", "Entra");
  await waitText("PIN errato");
  await page.type('input[aria-label="PIN a 4 cifre"]', "1234");
  await clickText("button", "Entra");
  await waitText("Impostazioni");
});

await step("PIN: cambio e disattivazione", async () => {
  await clickText("button", "Cambia PIN");
  await waitText("PIN attuale");
  let pins = await page.$$('dialog[open] input[type="password"]');
  await pins[0].type("1234");
  await pins[1].type("5678");
  await pins[2].type("5678");
  await page.evaluate(() => {
    const d = document.querySelector("dialog[open]");
    [...d.querySelectorAll("button")].find((b) => b.textContent.trim() === "Cambia").click();
  });
  await waitText("PIN cambiato");
  await clickText("button", "Disattiva PIN");
  await waitText("PIN attuale");
  pins = await page.$$('dialog[open] input[type="password"]');
  await pins[0].type("5678");
  await page.evaluate(() => {
    const d = document.querySelector("dialog[open]");
    [...d.querySelectorAll("button")].find((b) => b.textContent.trim() === "Disattiva").click();
  });
  await waitText("PIN disattivato");
});

// ── backup → cancella tutto → import → stato identico ──
let backupFile;
await step("esporta backup JSON", async () => {
  await clickText("button", "Esporta backup JSON");
  await waitText("Backup esportato");
  await new Promise((r) => setTimeout(r, 1500));
  const files = readdirSync(DOWNLOADS).filter((f) => f.startsWith("sumo-backup"));
  if (files.length === 0) throw new Error("file di backup non scaricato");
  backupFile = path.join(DOWNLOADS, files[files.length - 1]);
});

await step("cancella tutto con doppia conferma", async () => {
  await clickText("button", "Cancella tutto");
  await waitText('Scrivi "ELIMINA"');
  await page.type("dialog[open] input", "ELIMINA");
  await page.evaluate(() => {
    const d = document.querySelector("dialog[open]");
    [...d.querySelectorAll("button")].find((b) => b.textContent.trim() === "Cancella tutto").click();
  });
  await waitText("Tutti i dati sono stati cancellati");
  await page.goto(BASE, { waitUntil: "networkidle2" });
  // app vuota → torna all'onboarding
  await waitText("Salta per ora", 20000);
  await clickText("button", "Salta per ora");
  await waitText("Benvenuto in Sumo Finance");
});

await step("importa backup → stato ripristinato", async () => {
  await page.goto(`${BASE}/impostazioni`, { waitUntil: "networkidle2" });
  await waitText("Importa backup");
  const inputs = await page.$$('input[type="file"]');
  await inputs[0].uploadFile(backupFile);
  await waitText("Sostituisci tutto");
  await clickText("button", "Sostituisci tutto");
  await waitText("Backup importato");
  await page.goto(`${BASE}/investimenti`, { waitUntil: "networkidle2" });
  await waitText("Bitcoin");
  await waitText("VWCE");
  await waitText("tasse se vendi"); // valori BTC ripristinati dal backup
  await page.goto(`${BASE}/entrate`, { waitUntil: "networkidle2" });
  await waitText("BONIFICO STIPENDIO");
});

console.log("\n── Errori console raccolti ──");
if (consoleErrors.length === 0) console.log("(nessuno)");
else consoleErrors.forEach((e) => console.log(e));

await browser.close();
