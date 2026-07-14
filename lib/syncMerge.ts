// ── Sync v2: merge per riga di due backup ───────────────────────────────────
// Quando entrambi i lati hanno modifiche (locale "dirty" E remoto cambiato),
// invece del vecchio last-write-wins sull'intero dataset si fondono le RIGHE:
//   - riga presente su entrambi → vince quella con `updatedAt` più recente
//   - riga presente su un solo lato → si tiene, A MENO CHE esista un tombstone
//     di eliminazione più recente della riga (la cancellazione si propaga)
//   - i tombstone si uniscono (più recente per id) e si potano dopo 90 giorni
// Nessun lato perde più i propri inserimenti per un conflitto.

import type { BackupFile, Deletion } from "./types";

const TOMBSTONE_TTL_DAYS = 90;

interface Row {
  id: string;
  updatedAt?: string;
}

function rowTime(r: Row): number {
  return r.updatedAt ? new Date(r.updatedAt).getTime() : 0;
}

function asRows(data: Record<string, unknown[]>, table: string): Row[] {
  const rows = data[table];
  return Array.isArray(rows) ? (rows as Row[]) : [];
}

function mergeDeletions(a: Deletion[], b: Deletion[]): Deletion[] {
  const merged = new Map<string, Deletion>();
  for (const d of [...a, ...b]) {
    const cur = merged.get(d.id);
    if (!cur || d.deletedAt > cur.deletedAt) merged.set(d.id, d);
  }
  const cutoff = new Date(Date.now() - TOMBSTONE_TTL_DAYS * 86400000).toISOString();
  return [...merged.values()].filter((d) => d.deletedAt >= cutoff);
}

function mergeTable(local: Row[], remote: Row[], tombstones: Map<string, string>): Row[] {
  const out = new Map<string, Row>();
  for (const r of local) out.set(r.id, r);
  for (const r of remote) {
    const cur = out.get(r.id);
    if (!cur || rowTime(r) > rowTime(cur)) out.set(r.id, r);
  }
  // le eliminazioni vincono solo se più recenti dell'ultima modifica della riga
  return [...out.values()].filter((r) => {
    const deletedAt = tombstones.get(r.id);
    return !deletedAt || rowTime(r) > new Date(deletedAt).getTime();
  });
}

/** Fonde due backup riga per riga. Ordine degli argomenti indifferente per le
 *  righe (vince il timestamp); i metadati (exportedAt) sono quelli correnti. */
export function mergeBackups(local: BackupFile, remote: BackupFile): BackupFile {
  const deletions = mergeDeletions(
    asRows(local.data, "deletions") as Deletion[],
    asRows(remote.data, "deletions") as Deletion[]
  );

  const tables = new Set([...Object.keys(local.data), ...Object.keys(remote.data)]);
  tables.delete("deletions");

  const data: Record<string, unknown[]> = { deletions };
  for (const table of tables) {
    const tombstones = new Map<string, string>();
    for (const d of deletions) {
      if (d.table === table) tombstones.set(d.rowId, d.deletedAt);
    }
    data[table] = mergeTable(asRows(local.data, table), asRows(remote.data, table), tombstones);
  }

  return { app: "PFOS", version: 1, exportedAt: new Date().toISOString(), data };
}
