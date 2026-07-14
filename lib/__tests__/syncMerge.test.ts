import { describe, expect, it } from "vitest";
import { mergeBackups } from "../syncMerge";
import type { BackupFile, Deletion } from "../types";

function backup(data: Record<string, unknown[]>): BackupFile {
  return { app: "PFOS", version: 1, exportedAt: "2026-07-14T10:00:00Z", data };
}

const row = (id: string, updatedAt: string, extra: Record<string, unknown> = {}) => ({
  id,
  updatedAt,
  ...extra,
});

describe("mergeBackups (sync v2)", () => {
  it("riga su entrambi: vince la più recente, in entrambe le direzioni", () => {
    const local = backup({ expenses: [row("a", "2026-07-14T09:00:00Z", { amount: 10 })] });
    const remote = backup({ expenses: [row("a", "2026-07-14T11:00:00Z", { amount: 99 })] });
    const m1 = mergeBackups(local, remote);
    expect((m1.data.expenses as { amount: number }[])[0].amount).toBe(99);
    const m2 = mergeBackups(remote, local);
    expect((m2.data.expenses as { amount: number }[])[0].amount).toBe(99);
  });

  it("inserimenti solo-locale e solo-remoto sopravvivono entrambi", () => {
    const local = backup({ expenses: [row("locale", "2026-07-14T09:00:00Z")] });
    const remote = backup({ expenses: [row("remoto", "2026-07-14T08:00:00Z")] });
    const m = mergeBackups(local, remote);
    const ids = (m.data.expenses as { id: string }[]).map((r) => r.id).sort();
    expect(ids).toEqual(["locale", "remoto"]);
  });

  it("un'eliminazione remota più recente rimuove la riga locale", () => {
    const del: Deletion = {
      id: "expenses:a",
      table: "expenses",
      rowId: "a",
      deletedAt: "2026-07-14T12:00:00Z",
    };
    const local = backup({ expenses: [row("a", "2026-07-14T09:00:00Z")] });
    const remote = backup({ expenses: [], deletions: [del] });
    const m = mergeBackups(local, remote);
    expect(m.data.expenses).toHaveLength(0);
    expect((m.data.deletions as Deletion[])[0].id).toBe("expenses:a");
  });

  it("una riga ricreata DOPO l'eliminazione sopravvive (undo/ripristino)", () => {
    const del: Deletion = {
      id: "expenses:a",
      table: "expenses",
      rowId: "a",
      deletedAt: "2026-07-14T12:00:00Z",
    };
    const local = backup({ expenses: [row("a", "2026-07-14T13:00:00Z")] }); // ricreata dopo
    const remote = backup({ expenses: [], deletions: [del] });
    const m = mergeBackups(local, remote);
    expect(m.data.expenses).toHaveLength(1);
  });

  it("il tombstone di una tabella non tocca le altre", () => {
    const del: Deletion = {
      id: "expenses:a",
      table: "expenses",
      rowId: "a",
      deletedAt: "2026-07-14T12:00:00Z",
    };
    const local = backup({ incomes: [row("a", "2026-07-14T09:00:00Z")], deletions: [del] });
    const remote = backup({ incomes: [] });
    const m = mergeBackups(local, remote);
    expect(m.data.incomes).toHaveLength(1);
  });

  it("righe senza updatedAt (dati storici) perdono contro righe timbrate", () => {
    const local = backup({ expenses: [{ id: "a", amount: 1 }] });
    const remote = backup({ expenses: [row("a", "2026-07-14T09:00:00Z", { amount: 2 })] });
    const m = mergeBackups(local, remote);
    expect((m.data.expenses as { amount: number }[])[0].amount).toBe(2);
  });

  it("i tombstone più vecchi di 90 giorni vengono potati", () => {
    const vecchio: Deletion = {
      id: "expenses:x",
      table: "expenses",
      rowId: "x",
      deletedAt: "2020-01-01T00:00:00Z",
    };
    const m = mergeBackups(backup({ deletions: [vecchio] }), backup({}));
    expect(m.data.deletions).toHaveLength(0);
  });

  it("i singleton (settings) seguono la stessa regola newer-wins", () => {
    const local = backup({ settings: [row("main", "2026-07-14T09:00:00Z", { riskProfile: "prudente" })] });
    const remote = backup({ settings: [row("main", "2026-07-14T10:00:00Z", { riskProfile: "dinamico" })] });
    const m = mergeBackups(local, remote);
    expect((m.data.settings as { riskProfile: string }[])[0].riskProfile).toBe("dinamico");
  });
});
