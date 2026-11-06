import { describe, expect, test } from "bun:test";
import type { AccessRule } from "@cosmicdrift/kumiko-types/handlers";
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
  const ticketFeature = (refs: readonly { id: string; label: string; access?: AccessRule }[]) =>
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

  test("the entity filter's full access rule rides on the ref, no rule stays open", () => {
    expect(
      projectedRefs([
        { id: "open", label: "a" },
        { id: "audit", label: "b" },
        { id: "everyone", label: "c" },
      ]),
    ).toEqual([
      { id: "open", label: "a" },
      { id: "audit", label: "b", access: { roles: ["Auditor"] } },
      { id: "everyone", label: "c", access: { openToAll: { reason: "test_fixture" } } },
    ]);
  });

  test("an authored access value cannot widen the entity's rule", () => {
    expect(projectedRefs([{ id: "audit", label: "b", access: { roles: ["User"] } }])).toEqual([
      { id: "audit", label: "b", access: { roles: ["Auditor"] } },
    ]);
    expect(projectedRefs([{ id: "open", label: "a", access: { roles: ["User"] } }])).toEqual([
      { id: "open", label: "a" },
    ]);
  });
});
