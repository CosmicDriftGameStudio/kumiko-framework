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
  test("manuelle Konstruktion mit korrektem Pair passiert (positive case)", () => {
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

  test("locatedBy zeigt auf nicht-existierendes Feld → Fehler beim Boot", () => {
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

  test("locatedBy zeigt auf falschen Feld-Typ → Fehler beim Boot", () => {
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

  test("Fehlermeldung verweist auf createLocatedTimestampField als Fix", () => {
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

  test("Timestamp ohne locatedBy ist OK (reiner UTC-Instant)", () => {
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
