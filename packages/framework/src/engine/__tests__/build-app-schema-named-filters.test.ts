import { describe, expect, test } from "bun:test";
import { buildAppSchema, findNonJsonSafePath } from "../build-app-schema.ts";
import { defineFeature } from "../define-feature.ts";
import { createEntity, createTextField } from "../factories.ts";
import { createRegistry } from "../registry.ts";

describe("buildAppSchema — named list filters", () => {
  test("function-valued namedFilters never reach the client schema", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity({
        name: "ticket",
        ...createEntity({
          fields: { status: createTextField({ personal: false, reason: "test_fixture" }) },
          namedFilters: {
            open: { filters: () => [{ field: "status", op: "eq", value: "open" }] },
          },
        }),
      });
    });
    const app = buildAppSchema(createRegistry([feature]));
    const projected = app.features[0]?.entities["ticket"];

    expect(projected).toBeDefined();
    expect(projected).not.toHaveProperty("namedFilters");
    expect(findNonJsonSafePath(app, "app")).toBeNull();
  });
});

describe("buildAppSchema — named filter roles on entityList screens", () => {
  const ticketFeature = (
    refs: readonly { id: string; label: string; roles?: readonly string[] }[],
  ) =>
    defineFeature("shop", (r) => {
      r.entity({
        name: "ticket",
        ...createEntity({
          fields: { status: createTextField({ personal: false, reason: "test_fixture" }) },
          namedFilters: {
            open: { filters: () => [] },
            audit: { access: { roles: ["Auditor"] }, filters: () => [] },
            everyone: { access: { openToAll: { reason: "test_fixture" } }, filters: () => [] },
          },
        }),
      });
      r.screen({
        id: "ticket-list",
        type: "entityList",
        entity: "ticket",
        columns: ["status"],
        namedFilters: refs,
      });
    });

  function projectedRefs(refs: Parameters<typeof ticketFeature>[0]) {
    const app = buildAppSchema(createRegistry([ticketFeature(refs)]));
    const screen = app.features[0]?.screens.find((s) => s.type === "entityList");
    return screen?.type === "entityList" ? screen.namedFilters : undefined;
  }

  test("the entity filter's role rule becomes roles on the ref, openToAll and no rule stay open", () => {
    expect(
      projectedRefs([
        { id: "open", label: "a" },
        { id: "audit", label: "b" },
        { id: "everyone", label: "c" },
      ]),
    ).toEqual([
      { id: "open", label: "a" },
      { id: "audit", label: "b", roles: ["Auditor"] },
      { id: "everyone", label: "c" },
    ]);
  });

  test("an authored roles value cannot widen the entity's rule", () => {
    expect(projectedRefs([{ id: "audit", label: "b", roles: ["User"] }])).toEqual([
      { id: "audit", label: "b", roles: ["Auditor"] },
    ]);
  });
});
