import { expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import { createEntity, createTextField } from "../../factories.ts";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

  test("passes for valid features with no issues", () => {
    const features = [
      defineFeature("a", (r) => {
        r.entity(createEntity({
            name: "user",
            table: "Users",
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }));
      }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("detects circular requires: A → B → A", () => {
    const features = [
      defineFeature("a", (r) => {
        r.requires({ features: ["b"] });
      }),
      defineFeature("b", (r) => {
        r.requires({ features: ["a"] });
      }),
    ];
    expect(() => validateBoot(features)).toThrow(/circular dependency.*a.*b/i);
  });

  test("detects circular requires: A → B → C → A", () => {
    const features = [
      defineFeature("a", (r) => {
        r.requires({ features: ["b"] });
      }),
      defineFeature("b", (r) => {
        r.requires({ features: ["c"] });
      }),
      defineFeature("c", (r) => {
        r.requires({ features: ["a"] });
      }),
    ];
    expect(() => validateBoot(features)).toThrow(/circular dependency/i);
  });

  test("no circular dependency for diamond shape: A → B, A → C, B → D, C → D", () => {
    const features = [
      defineFeature("d", () => {}),
      defineFeature("b", (r) => {
        r.requires({ features: ["d"] });
      }),
      defineFeature("c", (r) => {
        r.requires({ features: ["d"] });
      }),
      defineFeature("a", (r) => {
        r.requires({ features: ["b", "c"] });
      }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("warns when extension used without requires", () => {
    const ext = defineFeature("tags", (r) => {
      r.extendsRegistrar("tags", { onRegister: () => {} });
    });
    const consumer = defineFeature("fleet", (r) => {
      r.entity(createEntity({ name: "vehicle", table: "Vehicles", fields: {} }));
      r.applyExtension({ name: "tags", entity: "vehicle" });
      // Missing: r.requires({ features: ["tags"] })
    });

    expect(() => validateBoot([ext, consumer])).toThrow(/fleet.*uses extension "tags".*requires/i);
  });

  test("passes when extension used with requires", () => {
    const ext = defineFeature("tags", (r) => {
      r.extendsRegistrar("tags", { onRegister: () => {} });
    });
    const consumer = defineFeature("fleet", (r) => {
      r.requires({ features: ["tags"] });
      r.entity(createEntity({ name: "vehicle", table: "Vehicles", fields: {} }));
      r.applyExtension({ name: "tags", entity: "vehicle" });
    });

    expect(() => validateBoot([ext, consumer])).not.toThrow();
  });

  test("passes when extension used with optionalRequires", () => {
    const ext = defineFeature("tags", (r) => {
      r.extendsRegistrar("tags", { onRegister: () => {} });
    });
    const consumer = defineFeature("fleet", (r) => {
      r.optionalRequires({ features: ["tags"] });
      r.entity(createEntity({ name: "vehicle", table: "Vehicles", fields: {} }));
      r.applyExtension({ name: "tags", entity: "vehicle" });
    });

    expect(() => validateBoot([ext, consumer])).not.toThrow();
  });

  test("passes when a feature provides AND uses its own extension (self-extension)", () => {
    // tier-engine pattern: a feature defines an extension-point and ships a
    // default plugin for it, so providerFeature === feature.name. Requiring
    // the feature to requires(self) would be circular — the validator must
    // skip the requires-check for self-provided extensions. The cross-feature
    // tests above only exercise providerFeature !== feature.name.
    const self = defineFeature("tier-stub", (r) => {
      r.extendsRegistrar("tenantTierResolver", { onRegister: () => {} });
      r.entity(createEntity({ name: "dummy", table: "Dummies", fields: {} }));
      r.applyExtension({ name: "tenantTierResolver", entity: "dummy", build: async () => () => new Set<string>() });
    });
    expect(() => validateBoot([self])).not.toThrow();
  });

  test("throws when extension preSave targets entity with no mapped write handlers", () => {
    const ext = defineFeature("cap-ext", (r) => {
      r.extendsRegistrar("credit-cap", {
        hooks: {
          preSave: async (changes) => changes,
        },
      });
    });
    const consumer = defineFeature("money-horse", (r) => {
      r.requires({ features: ["cap-ext"] });
      r.entity(createEntity({
          name: "credit",
          table: "Credits",
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }));
      r.writeHandler({
        name: "doSomething",
        schema: z.object({}),
        handler: async () => ({
          isSuccess: true as const,
          data: {},
        }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.applyExtension({ name: "credit-cap", entity: "credit" });
    });
    expect(() => validateBoot([ext, consumer])).toThrow(
      /no write handler is entity-mapped to "credit"/i,
    );
  });
