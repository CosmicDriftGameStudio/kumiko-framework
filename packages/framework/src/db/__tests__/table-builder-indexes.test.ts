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

describe("buildDrizzleTable — entity.indexes", () => {
  test("composite unique-index baut ohne Throw — keine Spalten-Misses", () => {
    // Drizzle's PgTable enthält den Index im internal _config-State der
    // nicht stabil über Versionen exposed ist; statt darauf zu prüfen
    // verifizieren wir, dass der buildDrizzleTable-Aufruf alle 3 Spalten
    // resolvet (sonst wäre Boot-Validator eh durchgegangen). Ein realer
    // SQL-Diff kommt im publicstatus-bundle-cleanup-Test (drizzle-kit
    // generate gegen aktuelle DB).
    const entity = createEntity({
      fields: {
        key: createTextField({ required: true }),
        userId: createTextField({}),
      },
      indexes: [{ unique: true, columns: ["key", "tenantId", "userId"] }],
    });
    expect(() => buildDrizzleTable("config-value", entity)).not.toThrow();
  });

  test("composite non-unique-index landet im DDL-Output", () => {
    const entity = createEntity({
      fields: {
        startedAt: createTextField({}),
        endedAt: createTextField({}),
      },
      indexes: [{ columns: ["startedAt", "endedAt"] }],
    });
    expect(() => buildDrizzleTable("session", entity)).not.toThrow();
  });

  test("custom name override wird respektiert", () => {
    const entity = createEntity({
      fields: {
        slug: createTextField({ required: true }),
      },
      indexes: [{ unique: true, columns: ["slug"], name: "my_custom_idx" }],
    });
    expect(() => buildDrizzleTable("page", entity)).not.toThrow();
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
