// Audit mobile permanente: overflow orizzontale, input sotto i 16px (causa
// dello zoom automatico iOS) e tap target piccoli, su tutte le pagine (demo).
import puppeteer from "puppeteer-core";
import { mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const BASE = "http://localhost:3000";
const HERE = path.dirname(fileURLToPath(import.meta.url));
mkdirSync(path.join(HERE, "shots"), { recursive: true });

const browser = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu"],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

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
const waitText = (text, timeout = 30000) =>
  page.waitForFunction(
    (t) => document.body && document.body.innerText.toLowerCase().replace(/[  ]/g, " ").includes(t),
    { timeout },
    text.toLowerCase().replace(/[  ]/g, " ")
  );

await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
await clickText("button", "provare subito con dati d'esempio");
await waitText("dati d'esempio caricati");

const PAGES = ["/", "/conti", "/entrate", "/uscite", "/investimenti", "/obiettivi", "/debiti", "/abbonamenti", "/simulazioni", "/tasse", "/calendario", "/calendario-economico", "/consigli", "/impostazioni", "/privacy"];
const problems = [];

async function auditCurrentView(label) {
  const check = await page.evaluate(() => {
    const overflowX = document.documentElement.scrollWidth - window.innerWidth;
    const wide = [];
    if (overflowX > 1) {
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.right > window.innerWidth + 1 && r.width < window.innerWidth * 2) {
          let p = el.parentElement, scrollable = false;
          while (p) {
            const o = getComputedStyle(p).overflowX;
            if (o === "auto" || o === "scroll") { scrollable = true; break; }
            p = p.parentElement;
          }
          if (!scrollable) wide.push(`${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 3).join(".")}`);
          if (wide.length >= 3) break;
        }
      }
    }
    // input sotto i 16px = zoom automatico iOS alla messa a fuoco
    const smallFont = [];
    for (const el of document.querySelectorAll("input, select, textarea")) {
      if (el.type === "checkbox" || el.type === "radio" || el.type === "file") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 16) {
        smallFont.push(`${el.tagName.toLowerCase()}[${el.getAttribute("aria-label") || el.placeholder || el.type}] ${fs}px`);
        if (smallFont.length >= 4) break;
      }
    }
    const smallTap = [];
    for (const el of document.querySelectorAll("button, a, [role=button]")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 32 && r.width < 32) {
        smallTap.push(`${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 25)}"`);
        if (smallTap.length >= 3) break;
      }
    }
    return { overflowX, wide, smallFont, smallTap };
  });
  if (check.overflowX > 1) problems.push(`${label}: OVERFLOW-X ${check.overflowX}px -> ${check.wide.join(", ")}`);
  if (check.smallFont.length) problems.push(`${label}: FONT <16px -> ${check.smallFont.join(" | ")}`);
  if (check.smallTap.length) problems.push(`${label}: tap piccoli -> ${check.smallTap.join(" | ")}`);
}

for (const theme of ["light", "dark"]) {
  await page.evaluate((t) => localStorage.setItem("pfos-theme", t), theme);
  for (const route of PAGES) {
    await page.goto(BASE + route, { waitUntil: "networkidle2", timeout: 60000 });
    await new Promise((r) => setTimeout(r, 600));
    await auditCurrentView(`${theme} ${route}`);
  }
}

// il modale con i campi (il posto dove lo zoom iOS colpiva di più)
await page.goto(`${BASE}/uscite`, { waitUntil: "networkidle2" });
await clickText("button", "Nuova uscita");
await waitText("descrizione");
await auditCurrentView("light /uscite [modale]");

console.log(problems.length === 0 ? "AUDIT MOBILE PULITO" : "PROBLEMI:");
problems.forEach((p) => console.log("  " + p));
await browser.close();
process.exit(problems.length === 0 ? 0 : 1);
