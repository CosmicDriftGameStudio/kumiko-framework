import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import { createEntity, createTextField } from "../../factories.ts";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

  describe("entityList toolbarAction navigate", () => {
    function makeFeature(targetScreen: string, withTarget: boolean) {
      return defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          columns: ["name"],
          toolbarActions: [
            { kind: "navigate", id: "open-form", label: "actions.open", screen: targetScreen },
          ],
        });
        if (withTarget) {
          r.screen({ id: targetScreen, type: "custom", renderer: { react: "stub" } });
        }
      });
    }

    test("navigate-target → registered → no throw", () => {
      expect(() => validateBoot([makeFeature("product-form", true)])).not.toThrow();
    });

    test("navigate-target → unknown → throws with a clear message", () => {
      expect(() => validateBoot([makeFeature("ghost-form", false)])).toThrow(
        /toolbarAction "open-form" navigate-target "ghost-form" does not resolve/,
      );
    });

    test("navigate-target → screen in ANOTHER feature → no throw (cross-feature)", () => {
      const list = defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          columns: ["name"],
          toolbarActions: [
            { kind: "navigate", id: "new", label: "actions.new", screen: "product-editor" },
          ],
        });
      });
      const consumer = defineFeature("app", (r) => {
        r.screen({ id: "product-editor", type: "custom", renderer: { react: "stub" } });
      });
      expect(() => validateBoot([list, consumer])).not.toThrow();
    });
  });

  describe("entityList toolbarAction writeHandler handler-QN", () => {
    function makeFeature(handlerQn: string, register: boolean) {
      return defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          columns: ["name"],
          toolbarActions: [
            { kind: "writeHandler", id: "sync", label: "actions.sync", handler: handlerQn },
          ],
        });
        if (register) {
          r.writeHandler({
            name: "sync",
            schema: z.object({}),
            handler: async () => ({ isSuccess: true as const, data: null }),
            access: { roles: ["Admin"] },
          });
        }
      });
    }

    test("handler → registered → no throw", () => {
      expect(() => validateBoot([makeFeature("shop:write:sync", true)])).not.toThrow();
    });

    test("handler → not registered → throws with a clear message", () => {
      expect(() => validateBoot([makeFeature("shop:write:ghost", false)])).toThrow(
        /toolbarAction "sync" .*handler "shop:write:ghost" is not a registered write-handler/,
      );
    });
  });
