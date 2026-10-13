import { describe, expect, test } from "bun:test";
import { createEntity, createTextField } from "../../engine/factories.js";
import type { EntityDefinition } from "../../engine/types/fields.js";
import { PII_ERASED_SENTINEL } from "../kms-adapter.js";
import { personalFieldsRekeyedOnOwnerTransition } from "../owner-transition-rekey.js";
import { PII_CIPHERTEXT_PREFIX } from "../pii-ciphertext-format.js";

const entity = createEntity({
  table: "rekey_items",
  fields: {
    ownerId: createTextField({ personal: false, reason: "test_fixture" }),
    name: createTextField({ personal: { of: "ownerId", whenAbsent: "tenant" }, find: "none" }),
    note: createTextField({ personal: false, reason: "test_fixture" }),
  },
});

const recordOwnedEntity = createEntity({
  table: "rekey_record_items",
  fields: {
    ownerId: createTextField({ personal: false, reason: "test_fixture" }),
    name: createTextField({ personal: { of: "id" }, find: "none" }),
  },
});

function rekey(
  previous: Record<string, unknown>,
  changes: Record<string, unknown>,
  submitted: Record<string, unknown> = changes,
  target: EntityDefinition = entity,
) {
  return personalFieldsRekeyedOnOwnerTransition(
    target,
    previous,
    { ...previous, ...changes },
    submitted,
  );
}

describe("personalFieldsRekeyedOnOwnerTransition", () => {
  test("absent → X rekeys the existing value", () => {
    expect(rekey({ name: "Alice" }, { ownerId: "x" })).toEqual({ name: "Alice" });
  });

  test("X → Y rekeys the existing value", () => {
    expect(rekey({ ownerId: "x", name: "Bob" }, { ownerId: "y" })).toEqual({ name: "Bob" });
  });

  test("empty string → X rekeys", () => {
    expect(rekey({ ownerId: "", name: "Bob" }, { ownerId: "x" })).toEqual({ name: "Bob" });
  });

  test("X → absent does not rekey", () => {
    expect(rekey({ ownerId: "x", name: "Bob" }, { ownerId: null })).toEqual({});
  });

  test("same owner does not rekey", () => {
    expect(rekey({ ownerId: "x", name: "Bob" }, { ownerId: "x", note: "n" })).toEqual({});
  });

  test("recordOwned fields are excluded", () => {
    expect(
      rekey({ ownerId: "x", name: "Bob" }, { ownerId: "y" }, { ownerId: "y" }, recordOwnedEntity),
    ).toEqual({});
  });

  test("sentinel, ciphertext, null and undefined values are skipped", () => {
    expect(rekey({ ownerId: "x", name: PII_ERASED_SENTINEL }, { ownerId: "y" })).toEqual({});
    expect(
      rekey({ ownerId: "x", name: `${PII_CIPHERTEXT_PREFIX}user:x:abc` }, { ownerId: "y" }),
    ).toEqual({});
    expect(rekey({ ownerId: "x", name: null }, { ownerId: "y" })).toEqual({});
    expect(rekey({ ownerId: "x" }, { ownerId: "y" })).toEqual({});
  });

  test("a field the caller submits is left to the caller", () => {
    expect(rekey({ ownerId: "x", name: "Bob" }, { ownerId: "y", name: "New" })).toEqual({});
  });
});
