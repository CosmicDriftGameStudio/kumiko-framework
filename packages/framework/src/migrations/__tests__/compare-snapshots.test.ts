// Unit-Tests für compareSnapshots — der Diff-Algorithmus zwischen zwei
// Drizzle-Snapshots. Production-Behavior: bei Schema-Drift einer
// Projection-Tabelle muss der Detector die richtigen Tabellen-Namen
// melden, damit migrate apply den richtigen Rebuild triggert.

import { describe, expect, test } from "vitest";
import { compareSnapshots } from "../projection-detection";
import type { Snapshot, SnapshotTable } from "../schema-drift";

function snapshot(tables: Record<string, Partial<SnapshotTable>>): Snapshot {
  const out: Record<string, SnapshotTable> = {};
  for (const [key, partial] of Object.entries(tables)) {
    out[key] = {
      schema: partial.schema ?? "",
      name: partial.name ?? key.replace(/^public\./, ""),
      columns: partial.columns ?? {},
    };
  }
  return { tables: out };
}

const userTable: SnapshotTable = {
  schema: "",
  name: "users",
  columns: {
    id: { name: "id", type: "uuid", primaryKey: true, notNull: true },
    email: { name: "email", type: "text", notNull: true },
  },
};

describe("compareSnapshots", () => {
  test("prev=null → all current tables marked as added", () => {
    const current = snapshot({ "public.users": userTable });
    const changes = compareSnapshots(null, current);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ tableName: "users", kind: "added" });
  });

  test("identical snapshots → no changes", () => {
    const s = snapshot({ "public.users": userTable });
    expect(compareSnapshots(s, s)).toHaveLength(0);
  });

  test("table appears in current → kind=added", () => {
    const prev = snapshot({});
    const current = snapshot({ "public.users": userTable });
    const changes = compareSnapshots(prev, current);
    expect(changes).toEqual([{ fullName: "users", tableName: "users", kind: "added" }]);
  });

  test("table missing in current → kind=removed", () => {
    const prev = snapshot({ "public.users": userTable });
    const current = snapshot({});
    const changes = compareSnapshots(prev, current);
    expect(changes).toEqual([{ fullName: "users", tableName: "users", kind: "removed" }]);
  });

  test("column added → kind=modified", () => {
    const prev = snapshot({ "public.users": userTable });
    const current = snapshot({
      "public.users": {
        ...userTable,
        columns: { ...userTable.columns, name: { name: "name", type: "text" } },
      },
    });
    const changes = compareSnapshots(prev, current);
    expect(changes).toEqual([{ fullName: "users", tableName: "users", kind: "modified" }]);
  });

  test("column type changed → kind=modified", () => {
    const prev = snapshot({ "public.users": userTable });
    const current = snapshot({
      "public.users": {
        ...userTable,
        columns: {
          ...userTable.columns,
          email: { name: "email", type: "varchar(255)", notNull: true },
        },
      },
    });
    expect(compareSnapshots(prev, current)).toEqual([
      { fullName: "users", tableName: "users", kind: "modified" },
    ]);
  });

  test("notNull flipped → kind=modified", () => {
    const prev = snapshot({ "public.users": userTable });
    const current = snapshot({
      "public.users": {
        ...userTable,
        columns: { ...userTable.columns, email: { name: "email", type: "text", notNull: false } },
      },
    });
    expect(compareSnapshots(prev, current)).toEqual([
      { fullName: "users", tableName: "users", kind: "modified" },
    ]);
  });

  test("default value changed → kind=modified", () => {
    const prev = snapshot({
      "public.users": {
        ...userTable,
        columns: {
          ...userTable.columns,
          status: { name: "status", type: "text", default: "'active'" },
        },
      },
    });
    const current = snapshot({
      "public.users": {
        ...userTable,
        columns: {
          ...userTable.columns,
          status: { name: "status", type: "text", default: "'pending'" },
        },
      },
    });
    expect(compareSnapshots(prev, current)).toEqual([
      { fullName: "users", tableName: "users", kind: "modified" },
    ]);
  });

  test("schema-prefix in fullName when set", () => {
    const prev = snapshot({});
    const current = snapshot({
      "auth.users": { ...userTable, schema: "auth" },
    });
    const changes = compareSnapshots(prev, current);
    expect(changes[0]?.fullName).toBe("auth.users");
  });

  test("multiple changes preserved with stable kind classification", () => {
    const tableA: SnapshotTable = { ...userTable, name: "a" };
    const tableB: SnapshotTable = { ...userTable, name: "b" };
    const tableC: SnapshotTable = { ...userTable, name: "c" };
    const prev = snapshot({
      "public.a": tableA,
      "public.b": tableB,
    });
    const current = snapshot({
      "public.a": tableA, // unchanged
      "public.c": tableC, // added
      // b removed
    });
    const changes = compareSnapshots(prev, current);
    expect(changes).toHaveLength(2);
    expect(changes.find((c) => c.tableName === "c")?.kind).toBe("added");
    expect(changes.find((c) => c.tableName === "b")?.kind).toBe("removed");
  });
});
