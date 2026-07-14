import { db, TABLE_NAMES, type TableName } from "../db";
import type { BackupFile } from "../types";
import type { StorageAdapter } from "./StorageAdapter";
import { markSyncDirty } from "../syncDirty";

/** Cache locali: non sono "dati dell'utente", non fanno scattare il sync. */
const CACHE_TABLES = new Set<TableName>(["priceHistoryCache", "economicEventsCache"]);

/** Tabelle senza timbro updatedAt né tombstone (cache + i tombstone stessi). */
const UNSTAMPED = new Set<TableName>(["priceHistoryCache", "economicEventsCache", "deletions"]);

function stamp<T extends { id: string }>(item: T): T {
  return { ...item, updatedAt: new Date().toISOString() };
}

export class DexieAdapter implements StorageAdapter {
  async list<T>(table: TableName): Promise<T[]> {
    return (await db.table(table).toArray()) as T[];
  }

  async get<T>(table: TableName, id: string): Promise<T | undefined> {
    return (await db.table(table).get(id)) as T | undefined;
  }

  async put<T extends { id: string }>(table: TableName, item: T): Promise<void> {
    await db.table(table).put(UNSTAMPED.has(table) ? item : stamp(item));
    if (!CACHE_TABLES.has(table)) markSyncDirty();
  }

  async bulkPut<T extends { id: string }>(table: TableName, items: T[]): Promise<void> {
    await db.table(table).bulkPut(UNSTAMPED.has(table) ? items : items.map(stamp));
    if (!CACHE_TABLES.has(table)) markSyncDirty();
  }

  async remove(table: TableName, id: string): Promise<void> {
    await db.table(table).delete(id);
    if (!UNSTAMPED.has(table)) {
      // tombstone: il sync v2 propaga la cancellazione invece di risuscitarla
      await db.deletions.put({
        id: `${table}:${id}`,
        table,
        rowId: id,
        deletedAt: new Date().toISOString(),
      });
    }
    if (!CACHE_TABLES.has(table)) markSyncDirty();
  }

  async findBy<T>(table: TableName, field: string, value: unknown): Promise<T | undefined> {
    const t = db.table(table);
    const hasIndex = t.schema.indexes.some((i) => i.name === field);
    if (hasIndex) {
      return (await t.where(field).equals(value as string).first()) as T | undefined;
    }
    return (await t.filter((row) => (row as Record<string, unknown>)[field] === value).first()) as
      | T
      | undefined;
  }

  async exportAll(): Promise<BackupFile> {
    const data: Record<string, unknown[]> = {};
    for (const name of TABLE_NAMES) {
      data[name] = await db.table(name).toArray();
    }
    return { app: "PFOS", version: 1, exportedAt: new Date().toISOString(), data };
  }

  async importAll(backup: BackupFile): Promise<void> {
    if (backup.app !== "PFOS" || backup.version !== 1 || typeof backup.data !== "object") {
      throw new Error("File di backup non valido: attesi app=PFOS e version=1.");
    }
    await db.transaction("rw", TABLE_NAMES.map((n) => db.table(n)), async () => {
      for (const name of TABLE_NAMES) {
        await db.table(name).clear();
        const rows = backup.data[name];
        if (Array.isArray(rows) && rows.length > 0) {
          await db.table(name).bulkPut(rows as { id: string }[]);
        }
      }
    });
    markSyncDirty();
  }

  async wipeAll(): Promise<void> {
    await db.transaction("rw", TABLE_NAMES.map((n) => db.table(n)), async () => {
      for (const name of TABLE_NAMES) {
        await db.table(name).clear();
      }
    });
    // "Cancella tutto" spegne anche il backup automatico: evita che un backup
    // vuoto post-cancellazione venga scritto nella cartella scelta
    await db.fsHandles.clear();
  }
}
