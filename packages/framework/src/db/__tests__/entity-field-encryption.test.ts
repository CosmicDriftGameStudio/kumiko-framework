import { describe, expect, test } from "bun:test";
import { createEntity, createTextField } from "../../engine/index.js";
import type { Logger } from "../../logging/index.js";
import { createTestEnvelopeCipher } from "../../testing/index.js";
import {
  collectEncryptedFieldNames,
  decryptEntityFieldValues,
  encryptEntityFieldValues,
  logUndecryptableField,
  validateEntityFieldEncryptionAvailable,
} from "../entity-field-encryption.js";

const TEST_KEY = Buffer.from("a]bJm#kP9xQ2@wN!vL$hR5yT8eU0iO3f").toString("base64");

describe("entity-field-encryption", () => {
  const entity = createEntity({
    table: "read_enc_test",
    fields: {
      email: createTextField({ personal: false, reason: "test_fixture", required: true }),
      secretNote: createTextField({ personal: false, reason: "test_fixture", encrypted: true }),
    },
  });
  const encryptedFields = collectEncryptedFieldNames(entity);
  const encryption = createTestEnvelopeCipher(TEST_KEY);

  test("collectEncryptedFieldNames finds encrypted text fields only", () => {
    expect([...encryptedFields]).toEqual(["secretNote"]);
  });

  test("encrypt on write / decrypt on read round-trip", async () => {
    const plain = { email: "a@b.de", secretNote: "top secret" };
    const stored = await encryptEntityFieldValues(plain, encryptedFields, encryption);
    expect(stored["email"]).toBe(plain.email);
    expect(stored["secretNote"]).not.toBe("top secret");

    const read = await decryptEntityFieldValues(stored, encryptedFields, encryption);
    expect(read).toEqual(plain);
  });

  test("onlyKeys limits encryption to changed fields", async () => {
    const row = { email: "a@b.de", secretNote: "note" };
    const stored = await encryptEntityFieldValues(row, encryptedFields, encryption, {
      onlyKeys: ["secretNote"],
    });
    expect(stored["email"]).toBe("a@b.de");
    expect(stored["secretNote"]).not.toBe("note");
  });
});

describe("validateEntityFieldEncryptionAvailable", () => {
  test("accepts a keyring made only of the env it is handed", () => {
    expect(() =>
      validateEntityFieldEncryptionAvailable({ KUMIKO_SECRETS_MASTER_KEY_V1: TEST_KEY }),
    ).not.toThrow();
  });

  test("rejects a handed env without any master key, whatever process.env holds", () => {
    const previous = process.env["KUMIKO_SECRETS_MASTER_KEY_V1"];
    process.env["KUMIKO_SECRETS_MASTER_KEY_V1"] = TEST_KEY;
    try {
      expect(() => validateEntityFieldEncryptionAvailable({})).toThrow(/no usable master key/);
    } finally {
      if (previous === undefined) delete process.env["KUMIKO_SECRETS_MASTER_KEY_V1"];
      else process.env["KUMIKO_SECRETS_MASTER_KEY_V1"] = previous;
    }
  });

  test("a pinned CURRENT_VERSION without that version's key still fails", () => {
    expect(() =>
      validateEntityFieldEncryptionAvailable({
        KUMIKO_SECRETS_MASTER_KEY_V1: TEST_KEY,
        KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "2",
      }),
    ).toThrow(/no usable master key/);
  });
});

describe("undecryptable encrypted field", () => {
  const entity = createEntity({
    table: "read_enc_degrade",
    fields: {
      secretNote: createTextField({ personal: false, reason: "test_fixture", encrypted: true }),
    },
  });
  const encryptedFields = collectEncryptedFieldNames(entity);
  const encryption = createTestEnvelopeCipher(TEST_KEY);

  test("without onFieldError a broken envelope still throws", async () => {
    await expect(
      decryptEntityFieldValues({ secretNote: "broken" }, encryptedFields, encryption),
    ).rejects.toThrow();
  });

  test("with onFieldError the field reads null and is reported", async () => {
    const failed: string[] = [];
    const read = await decryptEntityFieldValues(
      { secretNote: "broken" },
      encryptedFields,
      encryption,
      {
        onFieldError: (field) => failed.push(field),
      },
    );
    expect(read["secretNote"]).toBeNull();
    expect(failed).toEqual(["secretNote"]);
  });

  test("the error log carries entity, row id, field and error class but no ciphertext", () => {
    const calls: { msg: string; data: Record<string, unknown> | undefined }[] = [];
    const logger: Logger = {
      info: () => {},
      warn: () => {},
      debug: () => {},
      child: () => logger,
      error: (msg, data) => calls.push({ msg, data }),
    };
    logUndecryptableField(
      {
        entityName: "note",
        rowId: "row-1",
        field: "secretNote",
        error: new SyntaxError("leaky ciphertext echo"),
      },
      logger,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.data).toEqual({
      entity: "note",
      rowId: "row-1",
      field: "secretNote",
      errorName: "SyntaxError",
    });
  });
});
