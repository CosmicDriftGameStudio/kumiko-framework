import { describe, expect, test } from "bun:test";
import { createEntity } from "../../engine/factories";
import { sql } from "../dialect";
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
    rate: { type: "decimal", precision: 6, scale: 4, required: true, default: 1.5 },
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
    expect(cols.get("rate")?.defaultSql).toBe("1.5");
  });

  test("decimal field maps to numeric(precision,scale) on both paths", () => {
    const cols = new Map((fromBuilder?.columns ?? []).map((c) => [c.name, c]));
    expect(cols.get("rate")?.pgType).toBe("numeric(6,4)");
    expect(cols.get("rate")?.notNull).toBe(true);
  });
});

// Zweite Probe: softDelete + explizite Indexes (unique, partial, multi-col).
// Diese Pfade generieren zusätzliche Spalten (deleted_at/_by) bzw. Index-
// Metas — Drift hier blieb von der defaults-Probe oben unentdeckt.
const entityWithSoftDeleteAndIndexes = createEntity({
  table: "read_lockstep_probe_sd",
  fields: {
    title: { type: "text", required: true },
    ownerId: { type: "text", required: true },
    status: { type: "select", options: ["open", "done"], required: true, default: "open" },
  },
  softDelete: true,
  indexes: [
    { columns: ["ownerId"] },
    { columns: ["ownerId", "status"], unique: true },
    { columns: ["title"], unique: true, where: sql`status = 'open'`, name: "open_title_unique" },
  ],
});

describe("lock-step — softDelete + explizite Indexes", () => {
  const fromBuilder = asEntityTableMeta(
    buildEntityTable("lockstepProbeSd", entityWithSoftDeleteAndIndexes),
  );
  const fromMeta = buildEntityTableMeta("lockstepProbeSd", entityWithSoftDeleteAndIndexes);

  test("identical columns inkl. softDelete-Spalten", () => {
    expect(byName<ColumnMeta>(fromBuilder?.columns ?? [])).toEqual(
      byName<ColumnMeta>(fromMeta.columns),
    );
    const names = (fromBuilder?.columns ?? []).map((c) => c.name);
    expect(names).toContain("deleted_at");
  });

  test("identical indexes inkl. unique/partial/multi-col", () => {
    expect(byName<IndexMeta>(fromBuilder?.indexes ?? [])).toEqual(
      byName<IndexMeta>(fromMeta.indexes),
    );
    expect((fromBuilder?.indexes ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

// Dritte Probe: lookupable-Feld (#818) — bidx-Spalte, bidx-Index und das
// partielle Unique-Pendant müssen auf beiden Pfaden identisch entstehen.
const entityWithLookupable = createEntity({
  table: "read_lockstep_probe_bidx",
  fields: {
    email: { type: "text", required: true, pii: true, lookupable: true },
    tenantSlug: { type: "text", required: true },
  },
  indexes: [{ columns: ["tenantSlug", "email"], unique: true }],
});

describe("lock-step — lookupable / blind-index (#818)", () => {
  const fromBuilder = asEntityTableMeta(
    buildEntityTable("lockstepProbeBidx", entityWithLookupable),
  );
  const fromMeta = buildEntityTableMeta("lockstepProbeBidx", entityWithLookupable);

  test("identical columns inkl. nullable bidx-Spalte", () => {
    expect(byName<ColumnMeta>(fromBuilder?.columns ?? [])).toEqual(
      byName<ColumnMeta>(fromMeta.columns),
    );
    const bidx = (fromMeta.columns ?? []).find((c) => c.name === "email_bidx");
    expect(bidx).toEqual({ name: "email_bidx", pgType: "text", notNull: false });
  });

  test("identical indexes inkl. bidx-Index + partiellem Unique-Pendant", () => {
    expect(byName<IndexMeta>(fromBuilder?.indexes ?? [])).toEqual(
      byName<IndexMeta>(fromMeta.indexes),
    );
    const names = fromMeta.indexes.map((i) => i.name);
    expect(names).toContain("read_lockstep_probe_bidx_email_bidx_idx");
    const partial = fromMeta.indexes.find((i) => i.name.endsWith("_tenant_slug_email_unique_bidx"));
    expect(partial).toBeDefined();
    expect(partial?.unique).toBe(true);
    expect(partial?.columns).toEqual(["tenant_slug", "email_bidx"]);
    expect(partial?.whereSql).toBe('"email_bidx" IS NOT NULL');
  });
});
