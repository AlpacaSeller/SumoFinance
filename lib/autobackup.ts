// ── Backup automatico su cartella (File System Access API) ──────────────────
// L'utente sceglie una cartella (idealmente sincronizzata con Drive/OneDrive):
// a ogni apertura l'app vi scrive un backup datato `pfos-auto-YYYY-MM-DD.json`
// (max 1 al giorno, ultimi 14 conservati). Il handle vive in IndexedDB fuori
// dal backup JSON; Chrome/Edge desktop soltanto — altrove la sezione è nascosta.

import { db } from "./db";
import { storage } from "./storage";
import type { Settings } from "./types";
import { todayISO } from "./format";

// La File System Access API non è (tutta) nelle typings standard
declare global {
  interface Window {
    showDirectoryPicker(options?: {
      id?: string;
      mode?: "read" | "readwrite";
    }): Promise<FileSystemDirectoryHandle>;
  }
  interface FileSystemDirectoryHandle {
    queryPermission(descriptor?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
    requestPermission(descriptor?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
    values(): AsyncIterableIterator<FileSystemHandle>;
    removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  }
}

const HANDLE_ID = "backup-dir";
const FILE_PREFIX = "pfos-auto-";
const KEEP_FILES = 14;

export function autoBackupSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export async function getBackupDir(): Promise<FileSystemDirectoryHandle | null> {
  const row = await db.fsHandles.get(HANDLE_ID);
  return row?.handle ?? null;
}

/** Apre il picker (serve un gesto utente), salva il handle e fa subito un backup. */
export async function chooseBackupDir(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const handle = await window.showDirectoryPicker({ id: "pfos-backup", mode: "readwrite" });
    await db.fsHandles.put({ id: HANDLE_ID, handle });
    return handle;
  } catch {
    return null; // utente ha annullato il picker
  }
}

export async function disableAutoBackup(): Promise<void> {
  await db.fsHandles.delete(HANDLE_ID);
}

export type AutoBackupStatus =
  | "done"
  | "already-done-today"
  | "no-handle"
  | "permission-needed"
  | "unsupported"
  | "empty"
  | "error";

export interface AutoBackupResult {
  status: AutoBackupStatus;
  fileName?: string;
  dirName?: string;
}

/** Esegue il backup automatico se possibile.
 *  `force` ignora il limite di 1 al giorno; `requestPermission` può essere
 *  usato solo dentro un gesto utente (click). */
export async function runAutoBackup(opts?: {
  force?: boolean;
  requestPermission?: boolean;
}): Promise<AutoBackupResult> {
  if (!autoBackupSupported()) return { status: "unsupported" };
  const handle = await getBackupDir();
  if (!handle) return { status: "no-handle" };

  const settings = await storage.get<Settings>("settings", "main");
  const today = todayISO();
  if (!opts?.force && settings?.lastAutoBackupAt?.slice(0, 10) === today) {
    return { status: "already-done-today", dirName: handle.name };
  }

  // permessi: query, poi eventualmente request (solo con gesto utente)
  let perm = await handle.queryPermission({ mode: "readwrite" });
  if (perm !== "granted" && opts?.requestPermission) {
    perm = await handle.requestPermission({ mode: "readwrite" });
  }
  if (perm !== "granted") return { status: "permission-needed", dirName: handle.name };

  const backup = await storage.exportAll();
  const hasData = Object.entries(backup.data).some(
    ([table, rows]) => table !== "settings" && table !== "taxState" && (rows?.length ?? 0) > 0
  );
  if (!hasData) return { status: "empty", dirName: handle.name };

  try {
    const fileName = `${FILE_PREFIX}${today}.json`;
    const fileHandle = await handle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(backup, null, 2));
    await writable.close();

    await pruneOldBackups(handle);

    if (settings) {
      const now = new Date().toISOString();
      await storage.put("settings", { ...settings, lastAutoBackupAt: now, lastBackupAt: now });
    }
    return { status: "done", fileName, dirName: handle.name };
  } catch {
    return { status: "error", dirName: handle.name };
  }
}

/** Conserva solo gli ultimi KEEP_FILES backup automatici (i nomi sono datati). */
async function pruneOldBackups(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    const names: string[] = [];
    for await (const entry of handle.values()) {
      if (entry.kind === "file" && entry.name.startsWith(FILE_PREFIX) && entry.name.endsWith(".json")) {
        names.push(entry.name);
      }
    }
    names.sort().reverse(); // i più recenti prima (nomi datati YYYY-MM-DD)
    for (const name of names.slice(KEEP_FILES)) {
      await handle.removeEntry(name);
    }
  } catch {
    // il pruning è best-effort: mai bloccare il backup per questo
  }
}
