// ── Punto di accesso unico alla persistenza ─────────────────────────────────
// `storage` è l'istanza StorageAdapter usata da tutta l'app.
// `useTable` è l'unico hook reattivo: internamente usa Dexie liveQuery
// (dettaglio dell'adapter corrente), ma le pagine vedono solo dati tipizzati.

"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db, type TableName } from "../db";
import { DexieAdapter } from "./DexieAdapter";
import type { StorageAdapter } from "./StorageAdapter";

export const storage: StorageAdapter = new DexieAdapter();
export type { StorageAdapter };
export type { TableName };

/** Contenuto reattivo di una tabella; undefined finché non è caricata. */
export function useTable<T>(table: TableName): T[] | undefined {
  return useLiveQuery(() => db.table(table).toArray() as Promise<T[]>, [table]);
}
