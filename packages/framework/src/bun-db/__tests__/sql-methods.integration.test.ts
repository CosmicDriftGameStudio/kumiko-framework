// sql-methods.integration.ts — verhaltens-Beweis für alle bun-db query-API-Methoden.
// Abgedeckt: selectMany, fetchOne, insertMany, updateMany, deleteMany, transaction.
//
// Known limitation: nested transactions (transaction() inside another transaction())
// werden von Bun.sql NICHT unterstützt — "cannot call begin inside a transaction use
// savepoint() instead". Test weggelassen, da query.ts keine savepoint()-Abstraktion
// hat. transaction() kann nur von einem Top-Level-db-Handle aufgerufen werden.
//
// deleteMany({}) ohne WHERE-Clause: query.ts rendert keinen WHERE-Clause wenn
// where-object leer ist → löscht ALLE Zeilen. Das ist ein Footgun; das Verhalten
// ist hier explizit dokumentiert und getestet.
import { afterAll, describe, expect, test } from "bun:test";
import {
  deleteMany,
  fetchOne,
  insertMany,
  insertOne,
  selectMany,
  transaction,
  updateMany,
} from "../query";
import { closeDb, withTable } from "./_helpers";

afterAll(async () => {
  await closeDb();
});

const textCols = [{ name: "val", pgType: "text" as const, notNull: true }] as const;

describe("selectMany", () => {
  test("leere Tabelle returnt []", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      const rows = await selectMany(db, meta);
      expect(rows).toEqual([]);
    });
  });

  test("ohne where gibt alle Zeilen zurück", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      await insertOne(db, meta, { val: "a" });
      await insertOne(db, meta, { val: "b" });
      await insertOne(db, meta, { val: "c" });
      const rows = await selectMany(db, meta);
      expect(rows.length).toBe(3);
    });
  });

  test("mit where filtert korrekt", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      await insertOne(db, meta, { val: "match" });
      await insertOne(db, meta, { val: "no-match" });
      const rows = await selectMany(db, meta, { val: "match" });
      expect(rows.length).toBe(1);
      expect((rows[0] as { val: string }).val).toBe("match");
    });
  });

  test("orderBy asc", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      await insertMany(db, meta, [{ val: "c" }, { val: "a" }, { val: "b" }]);
      const rows = (await selectMany(db, meta, {}, { orderBy: { col: "val", direction: "asc" } })) as readonly { val: string }[];
      expect(rows.map((r) => r.val)).toEqual(["a", "b", "c"]);
    });
  });

  test("orderBy desc", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      await insertMany(db, meta, [{ val: "a" }, { val: "c" }, { val: "b" }]);
      const rows = (await selectMany(db, meta, {}, { orderBy: { col: "val", direction: "desc" } })) as readonly { val: string }[];
      expect(rows.map((r) => r.val)).toEqual(["c", "b", "a"]);
    });
  });

  test("limit begrenzt Anzahl Ergebnisse", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      await insertMany(db, meta, [{ val: "x" }, { val: "y" }, { val: "z" }]);
      const rows = await selectMany(db, meta, {}, { limit: 2 });
      expect(rows.length).toBe(2);
    });
  });
});

describe("fetchOne", () => {
  test("gefundene Zeile zurückgeben", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      const inserted = await insertOne<{ id: string; val: string }>(db, meta, { val: "find-me" });
      const row = await fetchOne<{ id: string; val: string }>(db, meta, { id: inserted!.id });
      expect(row).toBeDefined();
      expect(row!.val).toBe("find-me");
    });
  });

  test("nicht-gefunden gibt undefined zurück", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      const row = await fetchOne(db, meta, { id: "00000000-0000-4000-8000-000000000001" });
      expect(row).toBeUndefined();
    });
  });
});

describe("insertMany", () => {
  test("0 rows = no-op, gibt [] zurück", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      const result = await insertMany(db, meta, []);
      expect(result).toEqual([]);
      const rows = await selectMany(db, meta);
      expect(rows.length).toBe(0);
    });
  });

  test("1 row", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      const result = await insertMany<{ id: string; val: string }>(db, meta, [{ val: "single" }]);
      expect(result.length).toBe(1);
      expect(result[0]!.val).toBe("single");
    });
  });

  test("5 rows auf einmal", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      const input = Array.from({ length: 5 }, (_, i) => ({ val: `row-${i}` }));
      const result = await insertMany<{ id: string; val: string }>(db, meta, input);
      expect(result.length).toBe(5);
      const all = await selectMany(db, meta);
      expect(all.length).toBe(5);
    });
  });
});

describe("updateMany", () => {
  test("zero match gibt [] zurück + keine Änderung", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      await insertOne(db, meta, { val: "unchanged" });
      const result = await updateMany(db, meta, { val: "new" }, { id: "00000000-0000-4000-8000-000000000001" });
      expect(result).toEqual([]);
      const rows = await selectMany<{ val: string }>(db, meta);
      expect(rows[0]!.val).toBe("unchanged");
    });
  });

  test("single match updatet genau eine Zeile", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      const ins = await insertOne<{ id: string }>(db, meta, { val: "before" });
      await updateMany(db, meta, { val: "after" }, { id: ins!.id });
      const row = await fetchOne<{ val: string }>(db, meta, { id: ins!.id });
      expect(row!.val).toBe("after");
    });
  });

  test("multi-row update ändert alle matches", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      await insertMany(db, meta, [{ val: "old" }, { val: "old" }, { val: "keep" }]);
      const result = await updateMany(db, meta, { val: "updated" }, { val: "old" });
      expect(result.length).toBe(2);
      const all = await selectMany<{ val: string }>(db, meta, { val: "updated" });
      expect(all.length).toBe(2);
    });
  });
});

describe("deleteMany", () => {
  test("zero match = keine Änderung", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      await insertOne(db, meta, { val: "stay" });
      await deleteMany(db, meta, { id: "00000000-0000-4000-8000-000000000001" });
      const rows = await selectMany(db, meta);
      expect(rows.length).toBe(1);
    });
  });

  test("single delete entfernt genau eine Zeile (verifiziert mit selectMany)", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      const ins = await insertOne<{ id: string }>(db, meta, { val: "delete-me" });
      await insertOne(db, meta, { val: "keep" });
      await deleteMany(db, meta, { id: ins!.id });
      const rows = await selectMany(db, meta);
      expect(rows.length).toBe(1);
    });
  });

  test("deleteMany({}) löscht alle Zeilen (FOOTGUN: kein WHERE-Clause)", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      await insertMany(db, meta, [{ val: "a" }, { val: "b" }, { val: "c" }]);
      await deleteMany(db, meta, {});
      const rows = await selectMany(db, meta);
      expect(rows.length).toBe(0);
    });
  });
});

describe("transaction", () => {
  test("commit: writes sind danach in DB sichtbar", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      await transaction(db, async (tx) => {
        await insertOne(tx, meta, { val: "committed" });
      });
      const rows = await selectMany<{ val: string }>(db, meta);
      expect(rows.length).toBe(1);
      expect(rows[0]!.val).toBe("committed");
    });
  });

  test("rollback bei throw: writes sind WEG (verifiziert mit selectMany)", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      await expect(
        transaction(db, async (tx) => {
          await insertOne(tx, meta, { val: "should-vanish" });
          throw new Error("forced rollback");
        }),
      ).rejects.toThrow("forced rollback");
      // Verifizieren dass die Zeile tatsächlich nicht da ist
      const rows = await selectMany(db, meta);
      expect(rows.length).toBe(0);
    });
  });
});
