// Unit-Tests für entity.indexes — Composite-/Unique-Index-API.
//
// Vorher mussten Apps für unique-indices über mehrere Spalten daneben eine
// hand-written pgTable-Definition halten — Single-Source-of-Truth gebrochen,
// Schema-Drift programmiert. Mit entity.indexes pflegen Author die
// Constraint deklarativ in der EntityDefinition; buildDrizzleTable rendert
// sie via uniqueIndex/index.

import { describe, expect, test } from "vitest";
import {
  createBooleanField,
  createEntity,
  createTextField,
  defineFeature,
  validateBoot,
} from "../../engine";
import { buildDrizzleTable } from "../table-builder";

// Native dialect equivalent of drizzle's getTableConfig: reads the
// EntityTableMeta-shape exposed on every SchemaTable.
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

describe("buildDrizzleTable — entity.indexes", () => {
  test("composite unique-index landet als unique=true in Drizzle table-config", () => {
    const entity = createEntity({
      fields: {
        key: createTextField({ required: true }),
        userId: createTextField({}),
      },
      indexes: [{ unique: true, columns: ["key", "tenantId", "userId"] }],
    });
    const tbl = buildDrizzleTable("config-value", entity);
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
        startedAt: createTextField({}),
        endedAt: createTextField({}),
      },
      indexes: [{ columns: ["startedAt", "endedAt"] }],
    });
    const tbl = buildDrizzleTable("session", entity);
    const { indexes } = getTableConfig(tbl);
    const composite = indexes.find(
      (i) => i.config.name === "read_sessions_started_at_ended_at_idx",
    );
    expect(composite).toBeDefined();
    expect(composite?.config.unique).toBe(false);
  });

  test("custom name override wird respektiert", () => {
    const entity = createEntity({
      fields: { slug: createTextField({ required: true }) },
      indexes: [{ unique: true, columns: ["slug"], name: "my_custom_idx" }],
    });
    const tbl = buildDrizzleTable("page", entity);
    const { indexes } = getTableConfig(tbl);
    const idx = indexes.find((i) => i.config.name === "my_custom_idx");
    expect(idx).toBeDefined();
    expect(idx?.config.unique).toBe(true);
  });

  test("ohne indexes — keine zusätzlichen Indices, kein Error", () => {
    const entity = createEntity({
      fields: {
        title: createTextField({}),
      },
    });
    expect(() => buildDrizzleTable("widget", entity)).not.toThrow();
  });

  test("Spalten die keine DB-Spalte haben (multi-files) werden via Boot-Validator gecatched", () => {
    // buildDrizzleTable selbst überspringt fehlende Columns silently —
    // der Boot-Validator wirft.
    const entity = createEntity({
      fields: {
        attachments: { type: "files" } as never,
      },
      indexes: [{ columns: ["attachments"] }],
    });
    // No throw at build time.
    expect(() => buildDrizzleTable("widget", entity)).not.toThrow();
    // But validateBoot does.
    const feature = defineFeature("widgetFeature", (r) => {
      r.entity("widget", entity);
    });
    expect(() => validateBoot([feature])).toThrow(/multi-value field/);
  });
});

describe("validateBoot — entity.indexes", () => {
  test("Tippfehler im column-Namen wirft", () => {
    const feature = defineFeature("widgetFeature", (r) => {
      r.entity("widget", {
        fields: { title: createTextField({}) },
        indexes: [{ columns: ["titel"] }], // typo
      });
    });
    expect(() => validateBoot([feature])).toThrow(/does not match any field/);
  });

  test("leere column-Liste wirft", () => {
    const feature = defineFeature("widgetFeature", (r) => {
      r.entity("widget", {
        fields: { title: createTextField({}) },
        indexes: [{ columns: [] as never }],
      });
    });
    expect(() => validateBoot([feature])).toThrow(/empty columns list/);
  });

  test("single-column index nur auf tenantId ist redundant", () => {
    const feature = defineFeature("widgetFeature", (r) => {
      r.entity("widget", {
        fields: { title: createTextField({}) },
        indexes: [{ columns: ["tenantId"] }],
      });
    });
    expect(() => validateBoot([feature])).toThrow(/redundant/);
  });

  test("composite mit tenantId ist OK (z.B. für unique über 3 Cols)", () => {
    const feature = defineFeature("widgetFeature", (r) => {
      r.entity("widget", {
        fields: {
          key: createTextField({ required: true }),
          archived: createBooleanField({}),
        },
        indexes: [{ unique: true, columns: ["key", "tenantId"] }],
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("base columns (id, tenantId, version) sind erlaubt", () => {
    const feature = defineFeature("widgetFeature", (r) => {
      r.entity("widget", {
        fields: { key: createTextField({}) },
        indexes: [{ columns: ["tenantId", "version"] }],
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });
});
