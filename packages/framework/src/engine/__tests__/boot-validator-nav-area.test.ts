import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { withBootValidatorFixture } from "../../testing/boot-validator-fixture";
import { validateBoot as validateBootRaw } from "../boot-validator";
import { defineFeature } from "../define-feature";
import { createEntity, createTextField } from "../factories";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

describe("validateBoot — every screen must resolve its own nav area", () => {
  test("a screen with no nav entry, no listScreenId and no resolvable parent → Throw naming listScreenId", () => {
    const feature = defineFeature("app", (r) => {
      r.nav({ id: "home", label: "app.nav.home" });
      r.screen({ id: "orphan", type: "custom", renderer: { react: "Orphan" } });
    });
    expect(() => validateBoot([feature])).toThrow(/no nav entry and no resolvable list/);
    expect(() => validateBoot([feature])).toThrow(/listScreenId/);
  });

  test("the same screen with listScreenId set → no throw", () => {
    const feature = defineFeature("app", (r) => {
      r.nav({ id: "home", label: "app.nav.home" });
      r.screen({
        id: "orphan-list",
        type: "custom",
        renderer: { react: "List" },
        dormant: true,
      });
      r.screen({
        id: "orphan",
        type: "custom",
        renderer: { react: "Orphan" },
        listScreenId: "orphan-list",
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("resolved via a list screen's rowAction navigate target → no throw", () => {
    const feature = defineFeature("app", (r) => {
      r.queryHandler("orphan:list", z.object({}), async () => ({ rows: [], nextCursor: null }), {
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.nav({ id: "home", label: "app.nav.home", screen: "app:screen:orphan-list" });
      r.screen({
        id: "orphan-list",
        type: "projectionList",
        query: "app:query:orphan:list",
        columns: ["name"],
        rowActions: [{ kind: "navigate", id: "open", label: "Open", screen: "orphan" }],
      });
      r.screen({ id: "orphan", type: "custom", renderer: { react: "Orphan" } });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("resolved via a list screen's toolbarAction navigate target → no throw", () => {
    const feature = defineFeature("app", (r) => {
      r.queryHandler("orphan:list", z.object({}), async () => ({ rows: [], nextCursor: null }), {
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.nav({ id: "home", label: "app.nav.home", screen: "app:screen:orphan-list" });
      r.screen({
        id: "orphan-list",
        type: "projectionList",
        query: "app:query:orphan:list",
        columns: ["name"],
        toolbarActions: [{ kind: "navigate", id: "create", label: "Create", screen: "orphan" }],
      });
      r.screen({ id: "orphan", type: "custom", renderer: { react: "Orphan" } });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("resolved via an entityList screen of the same entity → no throw", () => {
    const feature = defineFeature("app", (r) => {
      r.entity(
        "widget",
        createEntity({
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
      r.nav({ id: "home", label: "app.nav.home", screen: "app:screen:widget-list" });
      r.screen({ id: "widget-list", type: "entityList", entity: "widget", columns: ["name"] });
      r.screen({
        id: "widget-edit",
        type: "entityEdit",
        entity: "widget",
        layout: { sections: [{ fields: ["name"] }] },
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("dormant: true → no throw even without any other resolution", () => {
    const feature = defineFeature("app", (r) => {
      r.nav({ id: "home", label: "app.nav.home" });
      r.screen({
        id: "orphan",
        type: "custom",
        renderer: { react: "Orphan" },
        dormant: true,
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("a feature set with no nav entries at all (sample/recipe) → the check does not run", () => {
    const feature = defineFeature("recipe", (r) => {
      r.screen({ id: "orphan", type: "custom", renderer: { react: "Orphan" } });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });
});
