import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { withBootValidatorFixture } from "../../testing/boot-validator-fixture";
import { validateBoot as validateBootRaw } from "../boot-validator";
import { defineFeature } from "../define-feature";
import { createEntity, createTextField } from "../factories";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

// fw#2166: projectionDetail screens can declare header `actions`, reusing
// RowAction (the displayed record stands in for the row). `rowClick` has no
// row to target on a detail screen and is rejected outright; navigate/
// writeHandler actions get the same existence checks as entityList/
// projectionList rowActions/toolbarActions.
describe("validateBoot — projectionDetail actions (fw#2166)", () => {
  test("navigate action with rowClick: true throws, naming the screen and action", () => {
    const feature = defineFeature("app", (r) => {
      r.screen({
        id: "rent-detail",
        type: "projectionDetail",
        query: "app:query:rent:detail",
        layout: { sections: [{ title: "s", fields: ["description"] }] },
        actions: [
          {
            kind: "navigate",
            id: "edit",
            label: "actions.edit",
            screen: "rent-edit",
            rowClick: true,
          },
        ],
      });
      r.screen({ id: "rent-edit", type: "custom", renderer: { react: "stub" } });
    });
    expect(() => validateBoot([feature])).toThrow(
      /Screen "app:screen:rent-detail" \(projectionDetail\) action "edit" sets rowClick: true/,
    );
  });

  test("valid navigate + writeHandler actions boot cleanly", () => {
    const feature = defineFeature("app", (r) => {
      r.writeHandler(
        "archive",
        z.object({ id: z.string() }),
        async () => ({ isSuccess: true as const, data: {} }),
        { access: { openToAll: true } },
      );
      r.screen({
        id: "rent-detail",
        type: "projectionDetail",
        query: "app:query:rent:detail",
        layout: { sections: [{ title: "s", fields: ["description"] }] },
        actions: [
          { kind: "navigate", id: "edit", label: "actions.edit", screen: "rent-edit" },
          {
            kind: "writeHandler",
            id: "archive",
            label: "actions.archive",
            handler: "app:write:archive",
          },
        ],
      });
      r.screen({ id: "rent-edit", type: "custom", renderer: { react: "stub" } });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("navigate action to an unregistered screen throws, via the same existence check as entityList/projectionList", () => {
    const feature = defineFeature("app", (r) => {
      r.screen({
        id: "rent-detail",
        type: "projectionDetail",
        query: "app:query:rent:detail",
        layout: { sections: [{ title: "s", fields: ["description"] }] },
        actions: [{ kind: "navigate", id: "edit", label: "actions.edit", screen: "ghost-screen" }],
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /action "edit" navigate-target "ghost-screen" does not resolve to a registered screen/,
    );
  });

  test("navigate action with params targeting an entityEdit of the SAME entity (via detailFor) throws — params are a no-op on an update target (review finding 3b)", () => {
    const feature = defineFeature("app", (r) => {
      r.entity("rent", createEntity({ fields: { name: createTextField() } }));
      r.screen({
        id: "rent-detail",
        type: "projectionDetail",
        query: "app:query:rent:detail",
        layout: { sections: [{ title: "s", fields: ["description"] }] },
        detailFor: "rent",
        actions: [
          {
            kind: "navigate",
            id: "edit",
            label: "actions.edit",
            screen: "rent-edit",
            params: { pick: ["name"] },
          },
        ],
      });
      r.screen({
        id: "rent-edit",
        type: "entityEdit",
        entity: "rent",
        layout: { sections: [{ columns: 1, fields: ["name"] }] },
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /rowAction "edit" sets params on navigate-target "rent-edit" which resolves to UPDATE mode \(same entity "rent" auto-fills row\["id"\]\)/,
    );
  });

  test("writeHandler action referencing an unregistered handler QN throws", () => {
    const feature = defineFeature("app", (r) => {
      r.screen({
        id: "rent-detail",
        type: "projectionDetail",
        query: "app:query:rent:detail",
        layout: { sections: [{ title: "s", fields: ["description"] }] },
        actions: [
          {
            kind: "writeHandler",
            id: "archive",
            label: "actions.archive",
            handler: "app:write:ghost",
          },
        ],
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /action "archive" handler "app:write:ghost" is not a registered write-handler/,
    );
  });
});
