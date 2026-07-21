import { describe, expect, test } from "bun:test";
import {
  decryptPiiFieldValues,
  InMemoryKmsAdapter,
  isPiiCiphertext,
  type KmsContext,
} from "../../crypto";
import { createEntity, createTextField } from "../../engine";
import { createTestUser, testUserId } from "../../stack/test-users";
import { createTestEnvelopeCipher } from "../../testing";
import { buildExecutorContext, type Table } from "../event-store-executor-context";

const TEST_KEY = Buffer.from("a]bJm#kP9xQ2@wN!vL$hR5yT8eU0iO3f").toString("base64");

describe("event-store-executor-context — encryptForStorage/decryptForRead layering", () => {
  const entity = createEntity({
    table: "pii_roundtrip_test",
    fields: {
      userId: createTextField({ required: true }),
      // Both markers at once — the auth-mfa.totpSecret/recoveryCodes shape
      // that first surfaced the ordering bug (pii-subject-encryption
      // integration test).
      secretNote: createTextField({ encrypted: true, userOwned: { ownerField: "userId" } }),
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
