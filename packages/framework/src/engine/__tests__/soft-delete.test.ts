import { describe, expect, test } from "vitest";
import { createApp, createEntity, createTextField, defineFeature } from "../index";
import { isSoftDeleteEnabled, SOFT_DELETE_FIELDS } from "../soft-delete";

describe("soft delete", () => {
  test("entity with softDelete: true is enabled", () => {
    const entity = createEntity({ table: "T", fields: {}, softDelete: true });
    expect(isSoftDeleteEnabled(entity, false)).toBe(true);
  });

  test("entity with softDelete: false is disabled even with global default true", () => {
    const entity = createEntity({ table: "T", fields: {}, softDelete: false });
    expect(isSoftDeleteEnabled(entity, true)).toBe(false);
  });

  test("entity without softDelete uses global default (true)", () => {
    const entity = createEntity({ table: "T", fields: {} });
    // createEntity sets softDelete: false by default in factory
    // But raw EntityDefinition without softDelete should use global
    const raw = { table: "T", fields: {}, searchWeight: 1 } as const;
    expect(isSoftDeleteEnabled(raw, true)).toBe(true);
  });

  test("entity without softDelete uses global default (false)", () => {
    const raw = { table: "T", fields: {}, searchWeight: 1 } as const;
    expect(isSoftDeleteEnabled(raw, false)).toBe(false);
  });

  test("SOFT_DELETE_FIELDS has expected field names", () => {
    expect(SOFT_DELETE_FIELDS.isDeleted).toBe("isDeleted");
    expect(SOFT_DELETE_FIELDS.deletedAt).toBe("deletedAt");
    expect(SOFT_DELETE_FIELDS.deletedById).toBe("deletedById");
  });

  test("createApp exposes softDeleteDefault", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("item", createEntity({ table: "Items", fields: { name: createTextField() } }));
    });

    const app1 = createApp({ roles: ["Admin"], features: [feature] });
    expect(app1.softDeleteDefault).toBe(true); // default

    const app2 = createApp({ roles: ["Admin"], features: [feature], softDelete: false });
    expect(app2.softDeleteDefault).toBe(false);
  });
});
