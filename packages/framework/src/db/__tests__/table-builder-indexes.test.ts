// Unit tests for entity.indexes — composite/unique-index API.
//
// Previously, apps had to maintain a separate hand-written pgTable definition
// for unique indexes spanning multiple columns, breaking the single source of
// truth and making schema drift likely. With entity.indexes, authors declare
// the constraint in the EntityDefinition; buildEntityTable renders it via
// uniqueIndex/index.

import { describe, expect, test } from "bun:test";
import {
  createBooleanField,
  createEntity,
  createReferenceField,
  createTextField,
  defineFeature,
  validateBoot,
} from "../../engine/index.ts";
import { buildEntityTable } from "../table-builder.ts";

// Native dialect equivalent of drizzle's getTableConfig: reads the
// EntityTableMeta-shape exposed on every SchemaTable.
// biome-ignore lint/suspicious/noExplicitAny: DDL index test helper
function getTableConfig(table: any): {
  indexes: Array<{ config: { name: string; unique: boolean; columns: Array<{ name: string }> } }>;
} {
  const meta = table as unknown as {
    indexes: ReadonlyArray<{ name: string; columns: readonly string[]; unique?: boolean }>;
  };
  return {
    indexes: meta.indexes.map((idx) => ({
      config: {
        name: idx.name,
        unique: idx.unique === true,
        columns: idx.columns.map((c) => ({ name: c })),
      },
    })),
  };
}

describe("buildEntityTable — entity.indexes", () => {
  test("composite unique index is recorded as unique=true in Drizzle table config", () => {
    const entity = createEntity({
      name: "config-value",
      fields: {
        key: createTextField({ required: true, personal: false, reason: "test_fixture" }),
        userId: createTextField({ personal: false, reason: "test_fixture" }),
      },
      indexes: [{ unique: true, columns: ["key", "tenantId", "userId"] }],
    });
    const tbl = buildEntityTable(entity);
    const { indexes } = getTableConfig(tbl);
    const composite = indexes.find(
      (i) => i.config.name === "read_config_values_key_tenant_id_user_id_unique",
    );
    expect(composite).toBeDefined();
    expect(composite?.config.unique).toBe(true);
    expect(composite?.config.columns.map((c) => (c as { name: string }).name)).toEqual([
      "key",
      "tenant_id",
      "user_id",
    ]);
  });

  test("composite non-unique index is recorded as unique=false in Drizzle table config", () => {
    const entity = createEntity({
      name: "session",
      fields: {
        startedAt: createTextField({ personal: false, reason: "test_fixture" }),
        endedAt: createTextField({ personal: false, reason: "test_fixture" }),
      },
      indexes: [{ columns: ["startedAt", "endedAt"] }],
    });
    const tbl = buildEntityTable(entity);
    const { indexes } = getTableConfig(tbl);
    const composite = indexes.find(
      (i) => i.config.name === "read_sessions_started_at_ended_at_idx",
    );
    expect(composite).toBeDefined();
    expect(composite?.config.unique).toBe(false);
  });

  test("custom name override is respected", () => {
    const entity = createEntity({
      name: "page",
      fields: {
        slug: createTextField({ required: true, personal: false, reason: "test_fixture" }),
      },
      indexes: [{ unique: true, columns: ["slug"], name: "my_custom_idx" }],
    });
    const tbl = buildEntityTable(entity);
    const { indexes } = getTableConfig(tbl);
    const idx = indexes.find((i) => i.config.name === "my_custom_idx");
    expect(idx).toBeDefined();
    expect(idx?.config.unique).toBe(true);
  });

  test("an index where that is not a sql expression throws instead of building a full index", () => {
    const entity = createEntity({
      name: "page",
      softDelete: true,
      fields: {
        slug: createTextField({ required: true, personal: false, reason: "test_fixture" }),
      },
      indexes: [{ unique: true, columns: ["slug"], where: "slug IS NOT NULL" }],
    });
    expect(() => buildEntityTable(entity)).toThrow(/index "[^"]+": where must be a sql/);
  });

  test("without indexes — no additional indexes, no error", () => {
    const entity = createEntity({
      name: "widget",
      fields: {
        title: createTextField({ personal: false, reason: "test_fixture" }),
      },
    });
    expect(() => buildEntityTable(entity)).not.toThrow();
  });

  test("Columns that do not have a DB column (multi-files) are caught by the boot validator", () => {
    // buildEntityTable silently skips missing columns; the boot validator throws.
    const entity = createEntity({
      name: "widget",
      fields: {
        attachments: { type: "files" } as never,
      },
      indexes: [{ columns: ["attachments"] }],
    });
    // No throw at build time.
    expect(() => buildEntityTable(entity)).not.toThrow();
    // But validateBoot does.
    const feature = defineFeature("widgetFeature", (r) => {
      r.entity(entity);
    });
    expect(() => validateBoot([feature])).toThrow(/multi-value field/);
  });
});

describe("buildEntityTable — base column indexes", () => {
  test("a base time column maps to its snake_case column", () => {
    const entity = createEntity({
      name: "timelineCase",
      fields: {
        status: createTextField({ personal: false, reason: "test_fixture" }),
      },
      indexes: [{ columns: ["tenantId", "status", "insertedAt"] }],
    });
    const table = buildEntityTable(entity);
    const index = getTableConfig(table).indexes.find(
      (i) => i.config.columns.map((c) => c.name).join(",") === "tenant_id,status,inserted_at",
    );
    expect(index?.config.unique).toBe(false);
  });
});

describe("validateBoot — entity.indexes", () => {
  test("a typo in a column name throws", () => {
    const feature = defineFeature("widgetFeature", (r) => {
      r.entity({
        name: "widget",
        fields: { title: createTextField({ personal: false, reason: "test_fixture" }) },
        indexes: [{ columns: ["titel"] }], // typo
      });
    });
    expect(() => validateBoot([feature])).toThrow(/does not match any field/);
  });

  test("an empty column list throws", () => {
    const feature = defineFeature("widgetFeature", (r) => {
      r.entity({
        name: "widget",
        fields: { title: createTextField({ personal: false, reason: "test_fixture" }) },
        indexes: [{ columns: [] as never }],
      });
    });
    expect(() => validateBoot([feature])).toThrow(/empty columns list/);
  });

  test("a single-column index on tenantId alone is redundant", () => {
    const feature = defineFeature("widgetFeature", (r) => {
      r.entity({
        name: "widget",
        fields: { title: createTextField({ personal: false, reason: "test_fixture" }) },
        indexes: [{ columns: ["tenantId"] }],
      });
    });
    expect(() => validateBoot([feature])).toThrow(/redundant/);
  });

  test("a single-column UNIQUE on tenantId is allowed (1:1 constraint)", () => {
    // The `&& !def.unique` branch in entity-handler.ts ensures that a UNIQUE index
    // on tenantId alone is not a redundant read index, but a 1:1 constraint
    // (exactly one row per tenant). Only the non-unique variant above is
    // redundant, so both sides of the condition are covered; otherwise the
    // branch could silently disappear during a revert or refactor.
    const feature = defineFeature("widgetFeature", (r) => {
      r.entity({
        name: "widget",
        fields: { title: createTextField({ personal: false, reason: "test_fixture" }) },
        indexes: [{ unique: true, columns: ["tenantId"] }],
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("a composite index with tenantId is OK (e.g. for unique across 3 columns)", () => {
    const feature = defineFeature("widgetFeature", (r) => {
      r.entity({
        name: "widget",
        fields: {
          key: createTextField({ required: true, personal: false, reason: "test_fixture" }),
          archived: createBooleanField({}),
        },
        indexes: [{ unique: true, columns: ["key", "tenantId"] }],
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("base columns (id, tenantId, version) are allowed", () => {
    const feature = defineFeature("widgetFeature", (r) => {
      r.entity({
        name: "widget",
        fields: { key: createTextField({ personal: false, reason: "test_fixture" }) },
        indexes: [{ columns: ["tenantId", "version"] }],
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("row-meta time columns are allowed in indexes", () => {
    const feature = defineFeature("widgetFeature", (r) => {
      r.entity({
        name: "widget",
        fields: { key: createTextField({ personal: false, reason: "test_fixture" }) },
        indexes: [
          { columns: ["tenantId", "insertedAt"] },
          { columns: ["tenantId", "key", "modifiedAt"] },
        ],
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("deletedAt is a base column only on softDelete entities", () => {
    const featureFor = (softDelete: boolean) =>
      defineFeature("widgetFeature", (r) => {
        r.entity({
          ...(softDelete && { softDelete: true }),
          name: "widget",
          fields: { key: createTextField({ personal: false, reason: "test_fixture" }) },
          indexes: [{ columns: ["tenantId", "deletedAt"] }],
        });
      });
    expect(() => validateBoot([featureFor(false)])).toThrow(/does not match any field/);
    expect(() => validateBoot([featureFor(true)])).not.toThrow();
  });
});

describe("buildEntityTable — reference field indexes", () => {
  const entity = createEntity({
    name: "lease",
    fields: {
      propertyId: createReferenceField({ entity: "property" }),
      tagIds: createReferenceField({ entity: "tag", multiple: true }),
      ownerId: createReferenceField({ entity: "owner" }),
      title: createTextField({ personal: false, reason: "test_fixture" }),
    },
    indexes: [{ columns: ["ownerId", "title"] }],
  });
  const { indexes } = getTableConfig(buildEntityTable(entity));

  test("a single-value reference field gets its own index", () => {
    const index = indexes.find((i) => i.config.name === "read_leases_property_id_idx");
    expect(index?.config.unique).toBe(false);
    expect(index?.config.columns.map((c) => c.name)).toEqual(["property_id"]);
  });

  test("a multi-value reference field is not indexed", () => {
    expect(indexes.some((i) => i.config.name.endsWith("_tag_ids_idx"))).toBe(false);
  });

  test("a field that leads a declared index gets no extra index", () => {
    const names = indexes.map((i) => i.config.name);
    expect(names).not.toContain("read_leases_owner_id_idx");
    expect(names).toContain("read_leases_owner_id_title_idx");
  });
});
