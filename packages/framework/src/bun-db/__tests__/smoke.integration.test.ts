// Smoke-Test: prüft dass _helpers.ts gegen die echte Test-DB funktioniert.
// Wenn dieser File grün ist, kann sql-matrix.integration.ts dranbauen.

import { afterAll, describe, expect, test } from "bun:test";
import { deleteMany, fetchOne, insertOne, selectMany } from "../query";
import { closeDb, withTable } from "./_helpers";

afterAll(async () => {
  await closeDb();
});

describe("_helpers smoke", () => {
  test("withTable creates + drops a table, insert+fetch roundtrip", async () => {
    await withTable([{ name: "label", pgType: "text", notNull: true }], async ({ db, meta }) => {
      const inserted = await insertOne<{ id: string; label: string }>(db, meta, {
        label: "hello",
      });
      expect(inserted?.label).toBe("hello");
      expect(inserted?.id).toMatch(/^[0-9a-f-]{36}$/);

      const fetched = await fetchOne<{ id: string; label: string }>(db, meta, {
        id: inserted!.id,
      });
      expect(fetched?.label).toBe("hello");
    });
  });

  test("selectMany returns all rows, deleteMany removes by where", async () => {
    await withTable([{ name: "label", pgType: "text", notNull: true }], async ({ db, meta }) => {
      await insertOne(db, meta, { label: "a" });
      await insertOne(db, meta, { label: "b" });
      await insertOne(db, meta, { label: "c" });

      const all = await selectMany<{ label: string }>(db, meta);
      expect(all.length).toBe(3);
      expect(all.map((r) => r.label).sort()).toEqual(["a", "b", "c"]);

      await deleteMany(db, meta, { label: "b" });
      const remaining = await selectMany<{ label: string }>(db, meta);
      expect(remaining.map((r) => r.label).sort()).toEqual(["a", "c"]);
    });
  });
});
