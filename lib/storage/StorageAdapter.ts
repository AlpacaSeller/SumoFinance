// ── Interfaccia astratta di persistenza ─────────────────────────────────────
// Tutta l'app parla SOLO con questa interfaccia (via lib/storage), mai con
// Dexie direttamente. Un futuro CloudAdapter (sync multi-dispositivo) dovrà
// solo implementare questa interfaccia: vedi DECISIONS.md.

import type { TableName } from "../db";
import type { BackupFile } from "../types";

export interface StorageAdapter {
  list<T>(table: TableName): Promise<T[]>;
  get<T>(table: TableName, id: string): Promise<T | undefined>;
  put<T extends { id: string }>(table: TableName, item: T): Promise<void>;
  bulkPut<T extends { id: string }>(table: TableName, items: T[]): Promise<void>;
  remove(table: TableName, id: string): Promise<void>;
  /** Prima voce con campo `field` === value (usa indici dove possibile) */
  findBy<T>(table: TableName, field: string, value: unknown): Promise<T | undefined>;
  exportAll(): Promise<BackupFile>;
  importAll(backup: BackupFile): Promise<void>;
  wipeAll(): Promise<void>;
}
