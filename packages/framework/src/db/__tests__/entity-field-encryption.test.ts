import { describe, expect, test } from "bun:test";
import { createEntity, createTextField } from "../../engine";
import { createEncryptionProvider } from "../encryption";
import {
  collectEncryptedFieldNames,
  decryptEntityFieldValues,
  encryptEntityFieldValues,
} from "../entity-field-encryption";

const TEST_KEY = Buffer.from("a]bJm#kP9xQ2@wN!vL$hR5yT8eU0iO3f").toString("base64");

describe("entity-field-encryption", () => {
  const entity = createEntity({
    table: "read_enc_test",
    fields: {
      email: createTextField({ required: true }),
      secretNote: createTextField({ encrypted: true }),
    },
  });
  const encryptedFields = collectEncryptedFieldNames(entity);
  const encryption = createEncryptionProvider(TEST_KEY);

  test("collectEncryptedFieldNames finds encrypted text fields only", () => {
    expect([...encryptedFields]).toEqual(["secretNote"]);
  });

  test("encrypt on write / decrypt on read round-trip", () => {
    const plain = { email: "a@b.de", secretNote: "top secret" };
    const stored = encryptEntityFieldValues(plain, encryptedFields, encryption);
    expect(stored["email"]).toBe(plain.email);
    expect(stored["secretNote"]).not.toBe("top secret");

    const read = decryptEntityFieldValues(stored, encryptedFields, encryption);
    expect(read).toEqual(plain);
  });

  test("onlyKeys limits encryption to changed fields", () => {
    const row = { email: "a@b.de", secretNote: "note" };
    const stored = encryptEntityFieldValues(row, encryptedFields, encryption, {
      onlyKeys: ["secretNote"],
    });
    expect(stored["email"]).toBe("a@b.de");
    expect(stored["secretNote"]).not.toBe("note");
  });
});


