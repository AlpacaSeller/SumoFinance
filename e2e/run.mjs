// ── Runner della suite e2e ──────────────────────────────────────────────────
// Prerequisiti: `npm run build` già eseguito e Chrome installato (override con
// env CHROME_PATH). Avvia `npm start`, aspetta :3000, esegue i driver in
// sequenza (ognuno col suo browser e profilo pulito) e spegne il server.
//
//   npm run e2e             → tutti i driver
//   npm run e2e drive13     → solo alcuni (nomi separati da spazio)
//   E2E_SKIP=drive15 npm run e2e → salta driver (es. sync: serve Supabase)

import { spawn } from "child_process";
import { readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const BASE = "http://localhost:3000";

const wanted = process.argv.slice(2);
const skip = new Set((process.env.E2E_SKIP || "").split(",").map((s) => s.trim()).filter(Boolean));
const drivers = readdirSync(HERE)
  .filter((f) => /^drive\d+\.mjs$/.test(f))
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
  .map((f) => f.replace(".mjs", ""))
  .filter((name) => (wanted.length === 0 || wanted.includes(name)) && !skip.has(name));

async function serverUp() {
  try {
    const res = await fetch(BASE, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

let server = null;
if (await serverUp()) {
  console.log("server già attivo su :3000, lo riuso");
} else {
  console.log("avvio npm start…");
  server = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["start"], {
    cwd: ROOT,
    stdio: "ignore",
    shell: process.platform === "win32",
    detached: false,
  });
  let ok = false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await serverUp()) {
      ok = true;
      break;
    }
  }
  if (!ok) {
    console.error("il server non è partito: hai eseguito `npm run build`?");
    server?.kill();
    process.exit(1);
  }
}

const results = [];
for (const name of drivers) {
  console.log(`\n════ ${name} ════`);
  const code = await new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(HERE, `${name}.mjs`)], {
      stdio: "inherit",
      cwd: HERE,
    });
    p.on("close", resolve);
  });
  results.push({ name, ok: code === 0 });
}

server?.kill();

console.log("\n════ RIEPILOGO ════");
for (const r of results) console.log(`${r.ok ? "OK  " : "FAIL"} ${r.name}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
