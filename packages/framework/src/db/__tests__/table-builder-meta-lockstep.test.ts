import { describe, expect, test } from "bun:test";
import { createEntity } from "../../engine/factories";
import type { ColumnMeta, IndexMeta } from "../entity-table-meta";
import { buildEntityTableMeta } from "../entity-table-meta";
import { asEntityTableMeta } from "../query";
import { buildEntityTable } from "../table-builder";

// Lock-step-Guard: buildEntityTable (Runtime-/Test-Stack-Pfad, Meta am
// KUMIKO_META_SYMBOL) und buildEntityTableMeta (Migrations-Pfad) müssen
// für dieselbe EntityDefinition identische Spalten + Indexes produzieren.
// Drift hier = Migration und Prod-Tabelle (bzw. collectTableMetas-Output)
// gehen auseinander — gefunden als #255-Follow-up: select/number/bigInt
// verloren ihre deklarierten defaults auf dem Builder-Pfad.

const entityWithDefaults = createEntity({
  table: "read_lockstep_probe",
  fields: {
    title: { type: "text", required: true, default: "untitled" },
    active: { type: "boolean", default: true },
    status: { type: "select", options: ["open", "done"], required: true, default: "open" },
    tags: { type: "multiSelect", options: ["a", "b"] },
    attempt: { type: "number", required: true, default: 1 },
    bytes: { type: "bigInt", default: 0 },
    price: { type: "money" },
    meta: { type: "embedded", fields: {} },
    startedAt: { type: "timestamp", required: true },
  },
});

function byName<T extends { name: string }>(items: readonly T[]): readonly T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}

describe("buildEntityTable ↔ buildEntityTableMeta lock-step", () => {
  const fromBuilder = asEntityTableMeta(buildEntityTable("lockstepProbe", entityWithDefaults));
  const fromMeta = buildEntityTableMeta("lockstepProbe", entityWithDefaults);

  test("builder table carries an EntityTableMeta", () => {
    expect(fromBuilder).toBeDefined();
  });

  test("identical columns (incl. declared defaults)", () => {
    expect(byName<ColumnMeta>(fromBuilder?.columns ?? [])).toEqual(
      byName<ColumnMeta>(fromMeta.columns),
    );
  });

  test("identical indexes", () => {
    expect(byName<IndexMeta>(fromBuilder?.indexes ?? [])).toEqual(
      byName<IndexMeta>(fromMeta.indexes),
    );
  });

  test("declared defaults survive the builder path", () => {
    const cols = new Map((fromBuilder?.columns ?? []).map((c) => [c.name, c]));
    expect(cols.get("status")?.defaultSql).toBe("'open'");
    expect(cols.get("attempt")?.defaultSql).toBe("1");
    expect(cols.get("bytes")?.defaultSql).toBe("0");
    expect(cols.get("title")?.defaultSql).toBe("'untitled'");
    expect(cols.get("active")?.defaultSql).toBe("true");
  });
});
