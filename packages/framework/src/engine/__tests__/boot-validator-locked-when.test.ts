import { describe, expect, test } from "bun:test";
import { validateBoot } from "../boot-validator.js";
import { defineFeature } from "../define-feature.js";
import { createEntity, createSelectField, createTextField } from "../factories.js";
import type { EntityDefinition } from "../types/index.js";

function bootWith(lockedWhen: EntityDefinition["lockedWhen"], fields: EntityDefinition["fields"]) {
  validateBoot([
    defineFeature("test", (r) => {
      r.entity("ticket", createEntity({ fields, ...(lockedWhen !== undefined && { lockedWhen }) }));
    }),
  ]);
}

const status = createSelectField({ options: ["open", "closed"] as const });

describe("boot validation of entity.lockedWhen", () => {
  test("a condition on an existing plaintext field boots", () => {
    expect(() => bootWith({ field: "status", eq: "closed" }, { status })).not.toThrow();
  });

  test("a boolean condition needs no field", () => {
    expect(() => bootWith(true, { status })).not.toThrow();
  });

  test("a condition on an unknown field is rejected", () => {
    expect(() => bootWith({ field: "missing", eq: 1 }, { status })).toThrow(
      /lockedWhen field "missing" is not a field of the entity/,
    );
  });

  test.each([
    ["personal", createTextField({ personal: "self", find: "none" })],
    ["encrypted", createTextField({ encrypted: true, personal: false, reason: "test_fixture" })],
  ] as const)("a %s field cannot carry the condition", (_kind, field) => {
    expect(() => bootWith({ field: "secret", eq: "x" }, { status, secret: field })).toThrow(
      /lockedWhen field "secret" is personal or encrypted/,
    );
  });
});
