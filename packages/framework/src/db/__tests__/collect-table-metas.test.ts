import { describe, expect, test } from "bun:test";
import { defineFeature } from "../../engine/define-feature";
import { createEntity, createTextField } from "../../engine/factories";
import { collectTableMetas } from "../collect-table-metas";
import { integer, jsonb, type SchemaTable, table, text, uniqueIndex, uuid } from "../dialect";
import { defineUnmanagedTable } from "../entity-table-meta";
import { asEntityTableMeta } from "../query";
import { buildBaseColumns, buildEntityTable } from "../table-builder";

function exampleEntity() {
  return createEntity({
    table: "read_units",
    fields: { name: createTextField() },
  });
}

const counterTable = table("read_unit_counters", {
  id: uuid("id").primaryKey(),
  count: integer("count").notNull().default(0),
}) as unknown as SchemaTable;

describe("collectTableMetas (#255)", () => {
  test("collects entity, projection, MSP and rawTable tables — same sources as the test-stack auto-push", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("unit", exampleEntity());
      r.projection({
        name: "unit-counters",
        source: "unit",
        table: counterTable,
        apply: {},
      });
      r.multiStreamProjection({
        name: "unit-audit",
        table: table("read_unit_audit", {
          id: uuid("id").primaryKey(),
          detail: text("detail"),
        }) as unknown as SchemaTable,
        apply: { "unit.created": async () => {} },
      });
      // side-effect-only MSP — no table, must be skipped without throwing
      r.multiStreamProjection({ name: "unit-notify", apply: { "unit.created": async () => {} } });
      r.rawTable(
        "cache",
        table("unit_cache", {
          id: uuid("id").primaryKey(),
        }) as unknown as SchemaTable,
        { reason: "test fixture" },
      );
      r.unmanagedTable(
        defineUnmanagedTable({
          tableName: "read_unit_log",
          columns: [{ name: "id", pgType: "serial", notNull: true, primaryKey: true }],
        }),
        { reason: "test fixture" },
      );
    });

    const names = collectTableMetas([feature]).map((m) => m.tableName);
    expect(names).toContain("read_units"); // entity
    expect(names).toContain("read_unit_counters"); // r.projection
    expect(names).toContain("read_unit_audit"); // r.multiStreamProjection
    expect(names).toContain("unit_cache"); // r.rawTable
    expect(names).toContain("read_unit_log"); // r.unmanagedTable
    expect(names).toHaveLength(5);
  });

  test("dedupes a projection that materializes into an entity table — entity meta wins", () => {
    const entity = exampleEntity();
    const feature = defineFeature("test", (r) => {
      r.entity("unit", entity);
      r.projection({
        name: "unit-alt",
        source: "unit",
        table: buildEntityTable("unit", entity) as unknown as SchemaTable,
        apply: {},
      });
    });

    const metas = collectTableMetas([feature]);
    expect(metas.filter((m) => m.tableName === "read_units")).toHaveLength(1);
  });

  test("throws when two table-bearing registrations declare the same table with diverging columns", () => {
    const a = defineFeature("feat-a", (r) => {
      r.entity("unit", exampleEntity());
      r.projection({
        name: "conflict-a",
        source: "unit",
        table: table("read_conflict", {
          id: uuid("id").primaryKey(),
          count: integer("count").notNull(),
        }) as unknown as SchemaTable,
        apply: {},
      });
    });
    const b = defineFeature("feat-b", (r) => {
      r.entity("thing", exampleEntity());
      r.projection({
        name: "conflict-b",
        source: "thing",
        table: table("read_conflict", {
          id: uuid("id").primaryKey(),
          label: text("label").notNull(),
        }) as unknown as SchemaTable,
        apply: {},
      });
    });

    expect(() => collectTableMetas([a, b])).toThrow(/read_conflict.*diverging/);
  });

  test("throws when a projection table carries no EntityTableMeta", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("unit", exampleEntity());
      r.projection({
        name: "broken",
        source: "unit",
        // System-Grenze: absichtlich kaputtes table-Objekt — der Cast
        // simuliert eine fremd-konstruierte Tabelle ohne kumiko-Meta.
        table: { tableName: "read_broken" } as unknown as SchemaTable,
        apply: {},
      });
    });

    expect(() => collectTableMetas([feature])).toThrow(/no EntityTableMeta/);
  });
});

describe("collectTableMetas — r.entity backing table (#347)", () => {
  const richWidgetTable = table(
    "read_widgets",
    {
      ...buildBaseColumns(false, "uuid"),
      name: text("name").notNull(),
      tag: jsonb("tag").notNull(), // ride-along: no entity field declares this
    },
    (t) => [uniqueIndex("read_widgets_name_unique").on(t.name)],
  ) as unknown as SchemaTable;

  function widgetEntity() {
    return createEntity({
      table: "read_widgets",
      fields: { name: createTextField({ required: true }) },
    });
  }

  test("ride-along column + index from the backing table reach the generated meta", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("widget", widgetEntity(), { table: richWidgetTable });
    });
    const meta = collectTableMetas([feature]).find((m) => m.tableName === "read_widgets");
    expect(meta?.columns.map((c) => c.name)).toContain("tag");
    expect(meta?.indexes.map((i) => i.name)).toContain("read_widgets_name_unique");
  });

  test("generate draws from the backing table itself — one source (the #255 invariant)", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("widget", widgetEntity(), { table: richWidgetTable });
    });
    const meta = collectTableMetas([feature]).find((m) => m.tableName === "read_widgets");
    // Identical to the table the test-stack push + executor use → they cannot drift.
    expect(meta).toEqual(asEntityTableMeta(richWidgetTable));
  });

  test("throws when the backing table is missing a field's column (superset violated)", () => {
    const thin = createEntity({
      table: "read_widgets",
      fields: { name: createTextField({ required: true }) },
    });
    const rich = createEntity({
      table: "read_widgets",
      fields: {
        name: createTextField({ required: true }),
        extra: createTextField({ required: true }),
      },
    });
    // Backing table built from the THIN entity lacks the `extra` column.
    const backing = buildEntityTable("widget", thin) as unknown as SchemaTable;
    const feature = defineFeature("test", (r) => {
      r.entity("widget", rich, { table: backing });
    });
    expect(() => collectTableMetas([feature])).toThrow(/missing column "extra"/);
  });
});
