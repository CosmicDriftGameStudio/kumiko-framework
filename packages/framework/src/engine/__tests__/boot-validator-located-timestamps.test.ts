// Boot-Validator-Tests für locatedBy-Markers.
//
// Ein Timestamp-Feld mit `locatedBy: "X"` muss ein bestehendes tz-Feld "X"
// in derselben Entity referenzieren. Sonst silent data loss — wir wollen
// fail-fast beim Boot.

import { describe, expect, test } from "bun:test";
import { validateBoot } from "../boot-validator";
import { defineFeature } from "../define-feature";
import { createEntity, createTimestampField, createTzField, locatedTimestamp } from "../factories";

describe("validateBoot — locatedBy markers", () => {
  test("locatedTimestamp(name) Helper-Pair passiert validiert (positive case)", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "order",
        createEntity({
          fields: {
            ...locatedTimestamp("pickup"),
            ...locatedTimestamp("delivery"),
          },
        }),
      );
    });

    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("manuelle Konstruktion mit korrektem Pair passiert (positive case)", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "order",
        createEntity({
          fields: {
            customAt: createTimestampField({ locatedBy: "customTz" }),
            customTz: createTzField(),
          },
        }),
      );
    });

    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("locatedBy zeigt auf nicht-existierendes Feld → Fehler beim Boot", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "order",
        createEntity({
          fields: {
            pickupAt: createTimestampField({ locatedBy: "pickupTz" }),
            // pickupTz fehlt komplett!
          },
        }),
      );
    });

    expect(() => validateBoot([feature])).toThrow(/no field with that name exists/);
  });

  test("locatedBy zeigt auf falschen Feld-Typ → Fehler beim Boot", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "order",
        createEntity({
          fields: {
            pickupAt: createTimestampField({ locatedBy: "pickupTz" }),
            // text statt tz — typo-Falle die der Validator fängt
            pickupTz: { type: "text", maxLength: 100 },
          },
        }),
      );
    });

    expect(() => validateBoot([feature])).toThrow(/expected "tz"/);
  });

  test("Fehlermeldung verweist auf locatedTimestamp-Helper als Fix", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "order",
        createEntity({
          fields: {
            pickupAt: createTimestampField({ locatedBy: "pickupTz" }),
          },
        }),
      );
    });

    expect(() => validateBoot([feature])).toThrow(/locatedTimestamp\("pickup"\)/);
  });

  test("Timestamp ohne locatedBy ist OK (reiner UTC-Instant)", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "order",
        createEntity({
          fields: {
            createdAt: createTimestampField(),
            actualPickupAt: createTimestampField({ required: true }),
          },
        }),
      );
    });

    expect(() => validateBoot([feature])).not.toThrow();
  });
});
