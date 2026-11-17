import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import { registerStubQueryHandler } from "../../__tests__/stub-query-handler.ts";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import { createEmbeddedListField, createEntity, createTextField } from "../../factories.ts";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

  describe("reference field", () => {
    test("reference to an existing Entity → no throw", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity(createEntity({
              name: "customer",
              fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
            }));
          registerStubQueryHandler(r, "customer:list");
          r.entity(createEntity({
              name: "order",
              fields: {
                customerId: { type: "reference", entity: "customer", labelField: "name" },
              },
            }));
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("reference to unknown Entity → Throw", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity(createEntity({
              name: "order",
              fields: {
                customerId: { type: "reference", entity: "ghost-entity" },
              },
            }));
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /Reference field "customerId" on entity "order" targets unknown entity "ghost-entity"/,
      );
    });

    test("reference labelField on unknown Field → Throw", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity(createEntity({
              name: "customer",
              fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
            }));
          r.entity(createEntity({
              name: "order",
              fields: {
                customerId: { type: "reference", entity: "customer", labelField: "ghost-field" },
              },
            }));
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /references labelField "ghost-field" which does not exist on entity "customer"/,
      );
    });

    test("reference labelField=id is always valid (PK)", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity(createEntity({
              name: "customer",
              fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
            }));
          registerStubQueryHandler(r, "customer:list");
          r.entity(createEntity({
              name: "order",
              fields: {
                customerId: { type: "reference", entity: "customer", labelField: "id" },
              },
            }));
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("self-reference (entity → entity) → no throw", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity(createEntity({
              name: "category",
              fields: {
                name: createTextField({ personal: false, reason: "test_fixture" }),
                parentId: { type: "reference", entity: "category", labelField: "name" },
              },
            }));
          registerStubQueryHandler(r, "category:list");
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("reference with multiple: true → no throw", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity(createEntity({
              name: "tag",
              fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
            }));
          registerStubQueryHandler(r, "tag:list");
          r.entity(createEntity({
              name: "post",
              fields: {
                title: createTextField({ personal: false, reason: "test_fixture" }),
                tagIds: {
                  type: "reference",
                  entity: "tag",
                  labelField: "name",
                  multiple: true,
                },
              },
            }));
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    // --- Cross-Feature: "feature:entity" Form ---
    test("cross-feature reference (feature:entity) → no throw", () => {
      const features = [
        defineFeature("users", (r) => {
          r.entity(createEntity({
              name: "user",
              fields: { email: createTextField({ personal: false, reason: "test_fixture" }) },
            }));
          registerStubQueryHandler(r, "user:list");
        }),
        defineFeature("shop", (r) => {
          r.entity(createEntity({
              name: "order",
              fields: {
                customerId: { type: "reference", entity: "users:user", labelField: "email" },
              },
            }));
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("cross-feature reference without a list-handler → throws", () => {
      const features = [
        defineFeature("users", (r) => {
          r.entity(createEntity({
              name: "user",
              fields: { email: createTextField({ personal: false, reason: "test_fixture" }) },
            }));
          // No stub list handler is registered intentionally; its absence is the condition under
          // test.
        }),
        defineFeature("shop", (r) => {
          r.entity(createEntity({
              name: "order",
              fields: {
                customerId: { type: "reference", entity: "users:user" },
              },
            }));
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /no list-query-handler is registered there\. Add r\.queryHandler\(defineEntityListHandler\("user"/,
      );
    });

    test("cross-feature reference to an unknown feature → throws with a clear message", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity(createEntity({
              name: "order",
              fields: {
                customerId: { type: "reference", entity: "ghost-feature:user" },
              },
            }));
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /targets unknown feature "ghost-feature" via "ghost-feature:user"/,
      );
    });

    test("cross-feature reference to an unknown entity → throws with feature context", () => {
      const features = [
        defineFeature("users", (r) => {
          r.entity(createEntity({
              name: "user",
              fields: { email: createTextField({ personal: false, reason: "test_fixture" }) },
            }));
        }),
        defineFeature("shop", (r) => {
          r.entity(createEntity({
              name: "order",
              fields: {
                customerId: { type: "reference", entity: "users:ghost-entity" },
              },
            }));
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /targets unknown entity "ghost-entity" in feature "users"/,
      );
    });

    test("cross-feature labelField on unknown Field → Throw", () => {
      const features = [
        defineFeature("users", (r) => {
          r.entity(createEntity({
              name: "user",
              fields: { email: createTextField({ personal: false, reason: "test_fixture" }) },
            }));
        }),
        defineFeature("shop", (r) => {
          r.entity(createEntity({
              name: "order",
              fields: {
                customerId: {
                  type: "reference",
                  entity: "users:user",
                  labelField: "ghost-field",
                },
              },
            }));
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /references labelField "ghost-field" which does not exist on entity "user"/,
      );
    });
  });

  // --- Reference sub-fields of an embedded-list field get the
  // same target/labelField/query-handler checks as a top-level reference
  // field, so a bad "lines.productId" fails at boot instead of crashing
  // the Combobox at runtime.
  describe("embedded-list reference sub-field", () => {
    test("reference sub-field targeting an unknown entity → Throw with the parent.child field path", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity(createEntity({
              name: "invoice",
              fields: {
                lines: createEmbeddedListField({
                  productId: { type: "reference", entity: "ghost-entity" },
                }),
              },
            }));
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /Reference field "lines\.productId" on entity "invoice" targets unknown entity "ghost-entity"/,
      );
    });

    test("reference sub-field with a valid target + registered list-handler → no throw", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity(createEntity({
              name: "product",
              fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
            }));
          registerStubQueryHandler(r, "product:list");
          r.entity(createEntity({
              name: "invoice",
              fields: {
                lines: createEmbeddedListField({
                  productId: { type: "reference", entity: "product", labelField: "name" },
                }),
              },
            }));
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("reference sub-field with a valid target but no registered list-handler → Throw", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity(createEntity({
              name: "product",
              fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
            }));
          // No stub list handler is registered intentionally; its absence is the condition under
          // test.
          r.entity(createEntity({
              name: "invoice",
              fields: {
                lines: createEmbeddedListField({
                  productId: { type: "reference", entity: "product" },
                }),
              },
            }));
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /Reference field "lines\.productId" on entity "invoice" targets entity "product" but no list-query-handler is registered/,
      );
    });

    test("reference optionsQuery naming a registered handler → no throw", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity(createEntity({
              name: "customer",
              fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
            }));
          registerStubQueryHandler(r, "customer:list");
          r.queryHandler({
            name: "customer:options",
            schema: z.object({}),
            handler: async () => ({ rows: [] }) as never,
            access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
          });
          r.entity(createEntity({
              name: "order",
              fields: {
                customerId: {
                  type: "reference",
                  entity: "customer",
                  optionsQuery: "shop:query:customer:options",
                },
              },
            }));
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("reference optionsQuery on an unregistered handler → throws", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity(createEntity({
              name: "customer",
              fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
            }));
          registerStubQueryHandler(r, "customer:list");
          r.entity(createEntity({
              name: "order",
              fields: {
                customerId: {
                  type: "reference",
                  entity: "customer",
                  optionsQuery: "shop:query:customer:typo",
                },
              },
            }));
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /Reference field "customerId" on entity "order" declares optionsQuery "shop:query:customer:typo" which is not a registered query-handler/,
      );
    });

    test("empty optionsQuery → throws", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity(createEntity({
              name: "customer",
              fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
            }));
          registerStubQueryHandler(r, "customer:list");
          r.entity(createEntity({
              name: "order",
              fields: {
                customerId: { type: "reference", entity: "customer", optionsQuery: "" },
              },
            }));
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/has an empty optionsQuery/);
    });

    test("reference sub-field optionsQuery on an unregistered handler → throws with parent.child path", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity(createEntity({
              name: "product",
              fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
            }));
          registerStubQueryHandler(r, "product:list");
          r.entity(createEntity({
              name: "invoice",
              fields: {
                lines: createEmbeddedListField({
                  productId: {
                    type: "reference",
                    entity: "product",
                    optionsQuery: "shop:query:product:typo",
                  },
                }),
              },
            }));
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /Reference field "lines\.productId" on entity "invoice" declares optionsQuery "shop:query:product:typo"/,
      );
    });

    test("reference sub-field labelField referencing an unknown field → Throw with the parent.child field path", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.entity(createEntity({
              name: "product",
              fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
            }));
          registerStubQueryHandler(r, "product:list");
          r.entity(createEntity({
              name: "invoice",
              fields: {
                lines: createEmbeddedListField({
                  productId: {
                    type: "reference",
                    entity: "product",
                    labelField: "ghost-field",
                  },
                }),
              },
            }));
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /Reference field "lines\.productId" on entity "invoice" references labelField "ghost-field" which does not exist on entity "product"/,
      );
    });
  });
