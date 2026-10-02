import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  isPiiCiphertext,
} from "@cosmicdrift/kumiko-framework/crypto";
import { createEntity, createTextField } from "@cosmicdrift/kumiko-framework/engine";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-framework/testing";
import { encryptForDirectWrite } from "../encrypt-for-direct-write.js";

// Row-subject (`personal: { of: "id" }`) keys are derived from the entity
// name; a direct-write path that drops it would throw on every insert.
const recordOwnedEntity = createEntity({
  table: "direct_write_record_owned",
  fields: {
    secretNote: createTextField({
      required: true,
      maxLength: 200,
      personal: { of: "id" },
      find: "none",
    }),
  },
});

describe("encryptForDirectWrite", () => {
  beforeEach(() => {
    configurePiiSubjectKms(new InMemoryKmsAdapter());
  });
  afterEach(() => {
    resetPiiSubjectKmsForTests();
  });

  test("encrypts a record-owned field of a direct-write row", async () => {
    const row = await encryptForDirectWrite(
      recordOwnedEntity,
      "direct-write-record-owned",
      { id: "11111111-1111-4111-8111-111111111111", secretNote: "plain" },
      "test-request",
    );
    expect(isPiiCiphertext(row["secretNote"])).toBe(true);
  });
});
