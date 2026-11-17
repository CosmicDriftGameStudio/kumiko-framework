import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import { createEntity, createMultiSelectField } from "../../factories.ts";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

  describe("multiSelect fields", () => {
    test("accepts multiSelect with non-empty options", () => {
      const features = [
        defineFeature("driver", (r) => {
          r.entity({
            name: "profile",
            ...createEntity({
              fields: {
                tags: createMultiSelectField({ options: ["a", "b", "c"] as const }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("rejects multiSelect with empty options", () => {
      const features = [
        defineFeature("driver", (r) => {
          r.entity({
            name: "profile",
            ...createEntity({
              fields: {
                // Cast over the empty-array hole — the factory's generic
                // `as const` widens to `readonly never[]` for `[]`, which
                // is what we want to test against. The validator catches
                // it at boot.
                tags: createMultiSelectField({ options: [] as readonly string[] }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/empty options/);
    });

    test("rejects default value not in options", () => {
      const features = [
        defineFeature("driver", (r) => {
          r.entity({
            name: "profile",
            ...createEntity({
              fields: {
                tags: createMultiSelectField({
                  options: ["a", "b"] as const,
                  default: ["c"] as never,
                }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/not a valid option/);
    });

    test("accepts default that is a subset of options", () => {
      const features = [
        defineFeature("driver", (r) => {
          r.entity({
            name: "profile",
            ...createEntity({
              fields: {
                tags: createMultiSelectField({
                  options: ["a", "b", "c"] as const,
                  default: ["a", "c"],
                }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test("accepts display: checkboxes with columns and maxRows", () => {
      const features = [
        defineFeature("driver", (r) => {
          r.entity({
            name: "profile",
            ...createEntity({
              fields: {
                tags: createMultiSelectField({
                  options: ["a", "b", "c"] as const,
                  display: "checkboxes",
                  columns: 2,
                  maxRows: 3,
                }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });

    test.each([0, 5])("rejects display: checkboxes with columns %p outside 1-4", (columns) => {
      const features = [
        defineFeature("driver", (r) => {
          r.entity({
            name: "profile",
            ...createEntity({
              fields: {
                tags: createMultiSelectField({
                  options: ["a", "b"] as const,
                  display: "checkboxes",
                  // @cast-boundary test — simulates JS/JSON input outside the 1|2|3|4 union
                  columns: columns as never,
                }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        new RegExp(`invalid columns "${columns}" — must be 1, 2, 3, 4`),
      );
    });

    test("rejects columns without display: checkboxes", () => {
      const features = [
        defineFeature("driver", (r) => {
          r.entity({
            name: "profile",
            ...createEntity({
              fields: {
                tags: createMultiSelectField({ options: ["a", "b"] as const, columns: 2 }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/columns.*display.*checkboxes/);
    });

    test("rejects columns when display is explicitly dropdown", () => {
      const features = [
        defineFeature("driver", (r) => {
          r.entity({
            name: "profile",
            ...createEntity({
              fields: {
                tags: createMultiSelectField({
                  options: ["a", "b"] as const,
                  display: "dropdown",
                  columns: 2,
                }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/columns.*display.*checkboxes/);
    });

    test("rejects maxRows without display: checkboxes", () => {
      const features = [
        defineFeature("driver", (r) => {
          r.entity({
            name: "profile",
            ...createEntity({
              fields: {
                tags: createMultiSelectField({ options: ["a", "b"] as const, maxRows: 3 }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/maxRows.*display.*checkboxes/);
    });

    test("rejects maxRows below 1", () => {
      const features = [
        defineFeature("driver", (r) => {
          r.entity({
            name: "profile",
            ...createEntity({
              fields: {
                tags: createMultiSelectField({
                  options: ["a", "b"] as const,
                  display: "checkboxes",
                  maxRows: 0,
                }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/invalid maxRows/);
    });

    test("rejects non-integer maxRows", () => {
      const features = [
        defineFeature("driver", (r) => {
          r.entity({
            name: "profile",
            ...createEntity({
              fields: {
                tags: createMultiSelectField({
                  options: ["a", "b"] as const,
                  display: "checkboxes",
                  maxRows: 1.5,
                }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/invalid maxRows/);
    });
  });
