// Boot-validator tests for locatedBy markers.
//
// A timestamp field with `locatedBy: "X"` must reference an existing tz field
// named "X" in the same entity. Otherwise, silent data loss is possible, so
// validation must fail fast during boot.

import { describe, expect, test } from "bun:test";
import { validateBoot } from "../boot-validator.ts";
import { defineFeature } from "../define-feature.ts";
import { createEntity, createTimestampField, createTzField } from "../factories.ts";

describe("validateBoot — locatedBy markers", () => {
  test("manual construction with correct Pair succeeds (positive case)", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({
        name: "order",
        ...createEntity({
          fields: {
            customAt: createTimestampField({ locatedBy: "customTz" }),
            customTz: createTzField(),
          },
        }),
      });
    });

    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("locatedBy points to a non-existent field → error on boot", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({
        name: "order",
        ...createEntity({
          fields: {
            pickupAt: createTimestampField({ locatedBy: "pickupTz" }),
            // pickupTz is entirely missing!
          },
        }),
      });
    });

    expect(() => validateBoot([feature])).toThrow(/no field with that name exists/);
  });

  test("locatedBy points to a field with the wrong type → error on boot", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({
        name: "order",
        ...createEntity({
          fields: {
            pickupAt: createTimestampField({ locatedBy: "pickupTz" }),
            // text instead of tz — a typo trap caught by the validator
            pickupTz: {
              type: "text",
              maxLength: 100,
              allowPlaintext: "test fixture value, not personal data",
            },
          },
        }),
      });
    });

    expect(() => validateBoot([feature])).toThrow(/expected "tz"/);
  });

  test("error message points to createLocatedTimestampField as the fix", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({
        name: "order",
        ...createEntity({
          fields: {
            pickupAt: createTimestampField({ locatedBy: "pickupTz" }),
          },
        }),
      });
    });

    expect(() => validateBoot([feature])).toThrow(/createLocatedTimestampField/);
  });

  test("Timestamp without locatedBy is OK (pure UTC instant)", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({
        name: "order",
        ...createEntity({
          fields: {
            createdAt: createTimestampField(),
            actualPickupAt: createTimestampField({ required: true }),
          },
        }),
      });
    });

    expect(() => validateBoot([feature])).not.toThrow();
  });
});
