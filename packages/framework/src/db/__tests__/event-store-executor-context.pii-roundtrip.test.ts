import { describe, expect, test } from "bun:test";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-testing/helpers";
import {
  decryptPiiFieldValues,
  encryptPiiFieldValues,
  InMemoryKmsAdapter,
  isPiiCiphertext,
  type KmsContext,
} from "../../crypto/index.js";
import { createEntity, createFileField, createTextField } from "../../engine/index.js";
import { createTestUser, testUserId } from "../../seeding/seed-users.js";
import { buildExecutorContext, type Table } from "../event-store-executor-context.js";

const TEST_KEY = Buffer.from("a]bJm#kP9xQ2@wN!vL$hR5yT8eU0iO3f").toString("base64");

describe("event-store-executor-context — encryptForStorage/decryptForRead layering", () => {
  const entity = createEntity({
    table: "pii_roundtrip_test",
    fields: {
      userId: createTextField({ personal: false, reason: "test_fixture", required: true }),
      // Both markers at once — the auth-mfa.totpSecret/recoveryCodes shape
      // that first surfaced the ordering bug (pii-subject-encryption
      // integration test).
      secretNote: createTextField({ encrypted: true, personal: { of: "userId" }, find: "none" }),
    },
  });
  const encryption = createTestEnvelopeCipher(TEST_KEY);
  const kms = new InMemoryKmsAdapter();
  const kmsCtx: KmsContext = { requestId: "test" };
  const context = buildExecutorContext({} as Table, entity, {
    entityName: "piiRoundtripTest",
    encryption,
    kms,
  });
  const user = createTestUser({ id: testUserId(1) });

  test("round-trips through both layers", async () => {
    const row = { userId: user.id, secretNote: "the actual secret" };
    const stored = await context.encryptForStorage(row, user);
    expect(stored["secretNote"]).not.toBe("the actual secret");

    const read = await context.decryptForRead(stored);
    expect(read["secretNote"]).toBe("the actual secret");
  });

  test("stores PII(envelope(plaintext)) — PII is the outer layer, not envelope", async () => {
    const row = { userId: user.id, secretNote: "the actual secret" };
    const stored = await context.encryptForStorage(row, user);
    const storedNote = stored["secretNote"];

    // Outer layer is PII ciphertext.
    expect(isPiiCiphertext(storedNote)).toBe(true);

    // Peeling only the outer (PII) layer must leave an envelope-ciphertext
    // string underneath, not the plaintext directly — proves encryptForStorage
    // wrapped the envelope-ciphertext with PII, not the raw plaintext.
    const piiPeeled = await decryptPiiFieldValues(stored, ["secretNote"], kms, kmsCtx);
    const innerValue = piiPeeled["secretNote"];
    expect(innerValue).not.toBe("the actual secret");
    expect(isPiiCiphertext(innerValue)).toBe(false);
    await expect(encryption.decrypt(innerValue as string)).resolves.toBe("the actual secret");

    // decryptForRead must peel PII first: feeding the stored value straight
    // to the envelope cipher (skipping the PII unwrap) has to fail — this is
    // the ordering bug the roundtrip guards against.
    await expect(encryption.decrypt(storedNote as string)).rejects.toThrow();
  });
});

describe("event-store-executor-context — file-reference fields", () => {
  const entity = createEntity({
    table: "pii_file_ref_test",
    fields: {
      userId: createTextField({ personal: false, reason: "test_fixture", required: true }),
      attachment: createFileField({ personal: { of: "userId" } }),
    },
  });
  const kms = new InMemoryKmsAdapter();
  const context = buildExecutorContext({} as Table, entity, {
    entityName: "piiFileRefTest",
    encryption: createTestEnvelopeCipher(TEST_KEY),
    kms,
  });
  const user = createTestUser({ id: testUserId(2) });
  const fileId = "11111111-1111-4111-8111-111111111111";

  test("new writes keep the file uuid plaintext", async () => {
    const stored = await context.encryptForStorage({ userId: user.id, attachment: fileId }, user);
    expect(stored["attachment"]).toBe(fileId);
  });

  test("reads decrypt a uuid that an older backfill stored as ciphertext", async () => {
    const legacy = await encryptPiiFieldValues(
      { userId: user.id, attachment: fileId },
      entity,
      ["attachment"],
      kms,
      { requestId: "test" },
      { entityName: "piiFileRefTest" },
    );
    expect(isPiiCiphertext(legacy["attachment"])).toBe(true);

    const read = await context.decryptForRead(legacy);
    expect(read["attachment"]).toBe(fileId);
  });
});
