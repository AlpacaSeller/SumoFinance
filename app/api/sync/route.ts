// ── Deposito dei blob di sync E2E ───────────────────────────────────────────
// Il client cifra il backup con la passphrase PRIMA di chiamare queste API:
// qui (e su Supabase) transita solo un blob illeggibile. L'id è un codice ad
// alta entropia (~100 bit) generato sul dispositivo: chi non lo conosce non
// può nemmeno scaricare il blob cifrato. Nessun account, nessun dato in
// chiaro, nessun log dei contenuti.

import { NextRequest, NextResponse } from "next/server";

const SUPABASE_URL = process.env.SUPABASE_URL?.trim();
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
const ID_RE = /^[a-z2-9]{20}$/; // 20 caratteri base32-crockford minuscoli
const MAX_BLOB = 3_500_000; // ~3,5 MB: sotto il limite body delle function

function sb(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY as string,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
  });
}

function notConfigured(): NextResponse | null {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return NextResponse.json({ error: "Sync non configurato sul server" }, { status: 503 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const err = notConfigured();
  if (err) return err;
  const id = req.nextUrl.searchParams.get("id") || "";
  if (!ID_RE.test(id)) {
    return NextResponse.json({ error: "Codice sync non valido" }, { status: 400 });
  }
  try {
    const res = await sb(`sync_blobs?id=eq.${id}&select=blob,updated_at`);
    if (!res.ok) {
      return NextResponse.json({ error: "Deposito non raggiungibile" }, { status: 502 });
    }
    const rows = (await res.json()) as { blob: string; updated_at: string }[];
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "Nessun sync con questo codice" }, { status: 404 });
    }
    return NextResponse.json({ blob: rows[0].blob, updatedAt: rows[0].updated_at });
  } catch {
    return NextResponse.json({ error: "Deposito non raggiungibile" }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const err = notConfigured();
  if (err) return err;
  let body: { id?: unknown; blob?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  const blob = typeof body.blob === "string" ? body.blob : "";
  if (!ID_RE.test(id)) {
    return NextResponse.json({ error: "Codice sync non valido" }, { status: 400 });
  }
  if (!blob || blob.length > MAX_BLOB) {
    return NextResponse.json({ error: "Blob mancante o troppo grande" }, { status: 400 });
  }
  // accettiamo SOLO envelope cifrati: mai dati in chiaro nel deposito
  try {
    const parsed = JSON.parse(blob) as { format?: string };
    if (parsed.format !== "encrypted-backup") throw new Error();
  } catch {
    return NextResponse.json({ error: "Il blob deve essere un backup cifrato" }, { status: 400 });
  }
  const updatedAt = new Date().toISOString();
  try {
    // quota anti-griefing: gli id NUOVI vengono rifiutati oltre la soglia
    // (gli aggiornamenti di blob esistenti passano sempre)
    const existing = await sb(`sync_blobs?id=eq.${id}&select=id`);
    const isNew = existing.ok && ((await existing.json()) as unknown[]).length === 0;
    if (isNew) {
      const head = await sb("sync_blobs?select=id&limit=1", {
        headers: { Prefer: "count=exact" },
      });
      const total = Number(head.headers.get("content-range")?.split("/")[1] ?? 0);
      if (total >= 2000) {
        return NextResponse.json(
          { error: "Deposito sync al completo: riprova più avanti" },
          { status: 503 }
        );
      }
    }
    const res = await sb("sync_blobs?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify([{ id, blob, updated_at: updatedAt }]),
    });
    if (!res.ok) {
      return NextResponse.json({ error: "Deposito non raggiungibile" }, { status: 502 });
    }
    return NextResponse.json({ updatedAt });
  } catch {
    return NextResponse.json({ error: "Deposito non raggiungibile" }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest) {
  const err = notConfigured();
  if (err) return err;
  const id = req.nextUrl.searchParams.get("id") || "";
  if (!ID_RE.test(id)) {
    return NextResponse.json({ error: "Codice sync non valido" }, { status: 400 });
  }
  try {
    const res = await sb(`sync_blobs?id=eq.${id}`, { method: "DELETE" });
    if (!res.ok) {
      return NextResponse.json({ error: "Deposito non raggiungibile" }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Deposito non raggiungibile" }, { status: 502 });
  }
}
