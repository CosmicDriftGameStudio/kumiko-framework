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
  test("composite unique-index landet als unique=true in Drizzle table-config", () => {
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

  test("composite non-unique-index landet als unique=false in Drizzle table-config", () => {
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

  test("custom name override wird respektiert", () => {
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

  test("ohne indexes — keine zusätzlichen Indices, kein Error", () => {
    const entity = createEntity({
      fields: {
        title: createTextField({ personal: false, reason: "test_fixture" }),
      },
    });
    expect(() => buildEntityTable("widget", entity)).not.toThrow();
  });

  test("Spalten die keine DB-Spalte haben (multi-files) werden via Boot-Validator gecatched", () => {
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

  test("single-column index nur auf tenantId ist redundant", () => {
    const feature = defineFeature("widgetFeature", (r) => {
      r.entity({
        name: "widget",
        fields: { title: createTextField({ personal: false, reason: "test_fixture" }) },
        indexes: [{ columns: ["tenantId"] }],
      });
    });
    expect(() => validateBoot([feature])).toThrow(/redundant/);
  });

  test("single-column UNIQUE auf tenantId ist erlaubt (1:1-Constraint)", () => {
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

  test("composite mit tenantId ist OK (z.B. für unique über 3 Cols)", () => {
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

  test("base columns (id, tenantId, version) sind erlaubt", () => {
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
