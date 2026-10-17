import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import { validateBoot as validateBootRaw } from "../boot-validator.js";
import { defineFeature } from "../define-feature.js";
import { createEntity, createTextField } from "../factories.js";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

function rentEntity() {
  return createEntity({
    fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
  });
}

describe("validateBoot — entityEdit actions", () => {
  test("navigate action with rowClick: true throws", () => {
    const feature = defineFeature("app", (r) => {
      r.entity({ name: "rent", ...rentEntity() });
      r.screen({
        id: "rent-edit",
        type: "entityEdit",
        entity: "rent",
        layout: { sections: [{ columns: 1, fields: ["name"] }] },
        actions: [
          { kind: "navigate", id: "back", label: "actions.back", screen: "other", rowClick: true },
        ],
      });
      r.screen({ id: "other", type: "custom", renderer: { react: "stub" } });
    });
    expect(() => validateBoot([feature])).toThrow(/action "back" sets rowClick: true/);
  });

  test("writeHandler action referencing an unregistered handler throws", () => {
    const feature = defineFeature("app", (r) => {
      r.entity({ name: "rent", ...rentEntity() });
      r.screen({
        id: "rent-edit",
        type: "entityEdit",
        entity: "rent",
        layout: { sections: [{ columns: 1, fields: ["name"] }] },
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
    expect(() => validateBoot([feature])).toThrow(/ghost/);
  });

  test("valid navigate + writeHandler actions boot cleanly", () => {
    const feature = defineFeature("app", (r) => {
      r.entity({ name: "rent", ...rentEntity() });
      r.writeHandler({
        name: "archive",
        schema: z.object({ id: z.string() }),
        handler: async () => ({ isSuccess: true as const, data: {} }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.screen({
        id: "rent-edit",
        type: "entityEdit",
        entity: "rent",
        layout: { sections: [{ columns: 1, fields: ["name"] }] },
        actions: [
          { kind: "navigate", id: "back", label: "actions.back", screen: "other" },
          {
            kind: "writeHandler",
            id: "archive",
            label: "actions.archive",
            handler: "app:write:archive",
          },
        ],
      });
      r.screen({ id: "other", type: "custom", renderer: { react: "stub" } });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });
});
