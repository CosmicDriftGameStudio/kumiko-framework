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
      fields: {
        key: createTextField({ required: true, personal: false, reason: "test_fixture" }),
        userId: createTextField({ personal: false, reason: "test_fixture" }),
      },
      indexes: [{ unique: true, columns: ["key", "tenantId", "userId"] }],
    });
    const tbl = buildEntityTable("config-value", entity);
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
      fields: {
        startedAt: createTextField({ personal: false, reason: "test_fixture" }),
        endedAt: createTextField({ personal: false, reason: "test_fixture" }),
      },
      indexes: [{ columns: ["startedAt", "endedAt"] }],
    });
    const tbl = buildEntityTable("session", entity);
    const { indexes } = getTableConfig(tbl);
    const composite = indexes.find(
      (i) => i.config.name === "read_sessions_started_at_ended_at_idx",
    );
    expect(composite).toBeDefined();
    expect(composite?.config.unique).toBe(false);
  });

  test("custom name override is respected", () => {
    const entity = createEntity({
      fields: {
        slug: createTextField({ required: true, personal: false, reason: "test_fixture" }),
      },
      indexes: [{ unique: true, columns: ["slug"], name: "my_custom_idx" }],
    });
    const tbl = buildEntityTable("page", entity);
    const { indexes } = getTableConfig(tbl);
    const idx = indexes.find((i) => i.config.name === "my_custom_idx");
    expect(idx).toBeDefined();
    expect(idx?.config.unique).toBe(true);
  });

  test("an index where that is not a sql expression throws instead of building a full index", () => {
    const entity = createEntity({
      softDelete: true,
      fields: {
        slug: createTextField({ required: true, personal: false, reason: "test_fixture" }),
      },
      indexes: [{ unique: true, columns: ["slug"], where: "slug IS NOT NULL" }],
    });
    expect(() => buildEntityTable("page", entity)).toThrow(/index "[^"]+": where must be a sql/);
  });

  test("without indexes — no additional indexes, no error", () => {
    const entity = createEntity({
      fields: {
        title: createTextField({ personal: false, reason: "test_fixture" }),
      },
    });
    expect(() => buildEntityTable("widget", entity)).not.toThrow();
  });

  test("Columns that do not have a DB column (multi-files) are caught by the boot validator", () => {
    // buildEntityTable silently skips missing columns; the boot validator throws.
    const entity = createEntity({
      fields: {
        attachments: { type: "files" } as never,
      },
      indexes: [{ columns: ["attachments"] }],
    });
    // No throw at build time.
    expect(() => buildEntityTable("widget", entity)).not.toThrow();
    // But validateBoot does.
    const feature = defineFeature("widgetFeature", (r) => {
      r.entity({ name: "widget", ...entity });
    });
    expect(() => validateBoot([feature])).toThrow(/multi-value field/);
  });
});

describe("validateBoot — entity.indexes", () => {
  test("Tippfehler im column-Namen wirft", () => {
    const feature = defineFeature("widgetFeature", (r) => {
      r.entity({
        name: "widget",
        fields: { title: createTextField({ personal: false, reason: "test_fixture" }) },
        indexes: [{ columns: ["titel"] }], // typo
      });
    });
    expect(() => validateBoot([feature])).toThrow(/does not match any field/);
  });

  test("leere column-Liste wirft", () => {
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
});
