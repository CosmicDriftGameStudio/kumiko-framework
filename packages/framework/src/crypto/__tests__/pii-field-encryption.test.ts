import { describe, expect, test } from "bun:test";
import { createEntity, createTextField } from "../../engine/factories";
import { InMemoryKmsAdapter } from "../in-memory-kms-adapter";
import {
  KeyErasedError,
  KeyNotFoundError,
  type KmsContext,
  subjectIdFromKey,
  subjectIdToKey,
} from "../kms-adapter";
import {
  decryptPiiFieldValues,
  decryptPiiValueForSubject,
  encryptPiiFieldValues,
  encryptPiiValueForSubject,
  isPiiCiphertext,
  PII_CIPHERTEXT_PREFIX,
  PII_ERASED_SENTINEL,
} from "../pii-field-encryption";
import { collectPiiSubjectFields } from "../subject-resolver";

const UUID_A = "6b2f4a0e-1c9d-4f3a-9d2e-00000000000a";
const UUID_B = "6b2f4a0e-1c9d-4f3a-9d2e-00000000000b";
const KMS_CTX: KmsContext = { requestId: "test" };

const userLikeEntity = createEntity({
  fields: {
    email: createTextField({ required: true, pii: true }),
    role: createTextField(),
  },
  table: "pii_users",
});

const commentEntity = createEntity({
  fields: {
    body: createTextField({ userOwned: { ownerField: "authorId" } }),
    authorId: createTextField({ required: true }),
  },
  table: "pii_comments",
});

const brandingEntity = createEntity({
  fields: {
    brandColor: createTextField({ tenantOwned: true }),
  },
  table: "pii_branding",
});

describe("subjectIdFromKey", () => {
  test("round-trips user and tenant keys, rejects garbage", () => {
    expect(subjectIdFromKey(`user:${UUID_A}`)).toEqual({ kind: "user", userId: UUID_A });
    expect(subjectIdFromKey(`tenant:${UUID_B}`)).toEqual({ kind: "tenant", tenantId: UUID_B });
    expect(() => subjectIdFromKey("widget:x")).toThrow(/Invalid subject key/);
  });
});

describe("encryptPiiFieldValues / decryptPiiFieldValues", () => {
  test("pii self-subject: DB value is sniffable ciphertext, decrypt restores plaintext", async () => {
    const kms = new InMemoryKmsAdapter();
    const fields = collectPiiSubjectFields(userLikeEntity);
    const row = { id: UUID_A, email: "marc@example.com", role: "admin" };

    const stored = await encryptPiiFieldValues(row, userLikeEntity, fields, kms, KMS_CTX);
    expect(isPiiCiphertext(stored["email"])).toBe(true);
    expect(String(stored["email"])).toStartWith(`kumiko-pii:v1:user:${UUID_A}:`);
    expect(stored["role"]).toBe("admin");
    expect(row["email"]).toBe("marc@example.com");

    const read = await decryptPiiFieldValues(stored, fields, kms, KMS_CTX);
    expect(read["email"]).toBe("marc@example.com");
  });

  test("first write auto-creates the subject key", async () => {
    const kms = new InMemoryKmsAdapter();
    await expect(kms.getKey({ kind: "user", userId: UUID_A })).rejects.toBeInstanceOf(
      KeyNotFoundError,
    );
    await encryptPiiFieldValues(
      { id: UUID_A, email: "a@b.c" },
      userLikeEntity,
      ["email"],
      kms,
      KMS_CTX,
    );
    const dek = await kms.getKey({ kind: "user", userId: UUID_A });
    expect(dek.length).toBe(32);
  });

  test("userOwned: ciphertext names the owner subject, not the row", async () => {
    const kms = new InMemoryKmsAdapter();
    const stored = await encryptPiiFieldValues(
      { id: UUID_A, body: "secret note", authorId: UUID_B },
      commentEntity,
      ["body"],
      kms,
      KMS_CTX,
    );
    expect(String(stored["body"])).toStartWith(`kumiko-pii:v1:user:${UUID_B}:`);
  });

  test("tenantOwned without tenantId column falls back to write-time tenant", async () => {
    const kms = new InMemoryKmsAdapter();
    const stored = await encryptPiiFieldValues(
      { id: UUID_A, brandColor: "#ff0000" },
      brandingEntity,
      ["brandColor"],
      kms,
      KMS_CTX,
      { tenantId: UUID_B },
    );
    expect(String(stored["brandColor"])).toStartWith(`kumiko-pii:v1:tenant:${UUID_B}:`);
  });

  test("subjectSource resolves the owner when the partial row lacks it (update changes)", async () => {
    const kms = new InMemoryKmsAdapter();
    const changes = { body: "edited" };
    const stored = await encryptPiiFieldValues(changes, commentEntity, ["body"], kms, KMS_CTX, {
      onlyKeys: ["body"],
      subjectSource: { id: UUID_A, body: "edited", authorId: UUID_B },
    });
    expect(String(stored["body"])).toStartWith(`kumiko-pii:v1:user:${UUID_B}:`);
  });

  test("erased subject: decrypt yields the sentinel, re-encrypt passes it through", async () => {
    const kms = new InMemoryKmsAdapter();
    const fields = ["email"] as const;
    const stored = await encryptPiiFieldValues(
      { id: UUID_A, email: "gone@example.com" },
      userLikeEntity,
      fields,
      kms,
      KMS_CTX,
    );
    await kms.eraseKey({ kind: "user", userId: UUID_A });

    const read = await decryptPiiFieldValues(stored, fields, kms, KMS_CTX);
    expect(read["email"]).toBe(PII_ERASED_SENTINEL);

    const reStored = await encryptPiiFieldValues(read, userLikeEntity, fields, kms, KMS_CTX);
    expect(reStored["email"]).toBe(PII_ERASED_SENTINEL);
  });

  test("write to an erased subject fails (forget is permanent)", async () => {
    const kms = new InMemoryKmsAdapter();
    await kms.createKey({ kind: "user", userId: UUID_A });
    await kms.eraseKey({ kind: "user", userId: UUID_A });
    await expect(
      encryptPiiFieldValues(
        { id: UUID_A, email: "new@b.c" },
        userLikeEntity,
        ["email"],
        kms,
        KMS_CTX,
      ),
    ).rejects.toThrow(/erased/);
  });

  test("legacy plaintext rows pass through decrypt unchanged", async () => {
    const kms = new InMemoryKmsAdapter();
    const read = await decryptPiiFieldValues(
      { id: UUID_A, email: "legacy@example.com" },
      ["email"],
      kms,
      KMS_CTX,
    );
    expect(read["email"]).toBe("legacy@example.com");
  });

  test("already-ciphertext values are not double-encrypted (re-encrypt paths)", async () => {
    const kms = new InMemoryKmsAdapter();
    const once = await encryptPiiFieldValues(
      { id: UUID_A, email: "a@b.c" },
      userLikeEntity,
      ["email"],
      kms,
      KMS_CTX,
    );
    const twice = await encryptPiiFieldValues(once, userLikeEntity, ["email"], kms, KMS_CTX);
    expect(twice["email"]).toBe(once["email"]);
  });

  test("null values and fields outside onlyKeys are skipped", async () => {
    const kms = new InMemoryKmsAdapter();
    const stored = await encryptPiiFieldValues(
      { id: UUID_A, email: null, role: "x" },
      userLikeEntity,
      ["email"],
      kms,
      KMS_CTX,
    );
    expect(stored["email"]).toBeNull();

    const skipped = await encryptPiiFieldValues(
      { id: UUID_A, email: "a@b.c" },
      userLikeEntity,
      ["email"],
      kms,
      KMS_CTX,
      { onlyKeys: ["role"] },
    );
    expect(skipped["email"]).toBe("a@b.c");
  });

  test("non-string pii value throws", async () => {
    const kms = new InMemoryKmsAdapter();
    await expect(
      encryptPiiFieldValues({ id: UUID_A, email: 42 }, userLikeEntity, ["email"], kms, KMS_CTX),
    ).rejects.toThrow(/must be a string/);
  });

  test("ciphertext without a key row fails loud (wrong key store, not shredded)", async () => {
    const kmsA = new InMemoryKmsAdapter();
    const stored = await encryptPiiFieldValues(
      { id: UUID_A, email: "a@b.c" },
      userLikeEntity,
      ["email"],
      kmsA,
      KMS_CTX,
    );
    const kmsB = new InMemoryKmsAdapter();
    await expect(decryptPiiFieldValues(stored, ["email"], kmsB, KMS_CTX)).rejects.toBeInstanceOf(
      KeyNotFoundError,
    );
  });
});

describe("piiEncrypted alias (kumiko-platform#457)", () => {
  test("piiEncrypted + tenantOwned round-trips through the same subject-KMS pipeline", async () => {
    const kms = new InMemoryKmsAdapter();
    const brandingWithAccess = createEntity({
      fields: {
        iban: createTextField({
          piiEncrypted: true,
          tenantOwned: true,
          access: { read: ["TenantAdmin"] },
        }),
      },
      table: "pii_branding_iban",
    });
    const fields = collectPiiSubjectFields(brandingWithAccess);
    expect(fields).toEqual(["iban"]);

    const row = { id: UUID_A, tenantId: UUID_B, iban: "DE89370400440532013000" };
    const stored = await encryptPiiFieldValues(row, brandingWithAccess, fields, kms, KMS_CTX);
    expect(isPiiCiphertext(stored["iban"])).toBe(true);
    expect(String(stored["iban"])).toStartWith(`kumiko-pii:v1:tenant:${UUID_B}:`);

    const read = await decryptPiiFieldValues(stored, fields, kms, KMS_CTX);
    expect(read["iban"]).toBe("DE89370400440532013000");
  });

  test("piiEncrypted field is covered by subject erasure (Art. 17, kumiko-platform#461)", async () => {
    const kms = new InMemoryKmsAdapter();
    const brandingWithAccess = createEntity({
      fields: {
        iban: createTextField({ piiEncrypted: true, tenantOwned: true }),
      },
      table: "pii_branding_iban_erasure",
    });
    const fields = collectPiiSubjectFields(brandingWithAccess);
    const row = { id: UUID_A, tenantId: UUID_B, iban: "DE89370400440532013000" };
    const stored = await encryptPiiFieldValues(row, brandingWithAccess, fields, kms, KMS_CTX);

    // Erasure is subject-keyed, not field-flag-keyed — kms.eraseKey doesn't
    // know or care that this field is piiEncrypted vs. plain tenantOwned.
    await kms.eraseKey({ kind: "tenant", tenantId: UUID_B });

    const read = await decryptPiiFieldValues(stored, fields, kms, KMS_CTX);
    expect(read["iban"]).toBe(PII_ERASED_SENTINEL);
  });
});

describe("encryptPiiValueForSubject / decryptPiiValueForSubject (kumiko-platform#459)", () => {
  test("round-trips a single value for a tenant subject", async () => {
    const kms = new InMemoryKmsAdapter();
    const subject = { kind: "tenant" as const, tenantId: UUID_B };
    const stored = await encryptPiiValueForSubject(kms, subject, "DE89370400440532013000", KMS_CTX);
    expect(isPiiCiphertext(stored)).toBe(true);
    expect(stored).toStartWith(`kumiko-pii:v1:tenant:${UUID_B}:`);

    const read = await decryptPiiValueForSubject(kms, stored, KMS_CTX);
    expect(read).toBe("DE89370400440532013000");
  });

  test("erased subject: decrypt yields the sentinel", async () => {
    const kms = new InMemoryKmsAdapter();
    const subject = { kind: "user" as const, userId: UUID_A };
    const stored = await encryptPiiValueForSubject(kms, subject, "+49 151 00000000", KMS_CTX);
    await kms.eraseKey(subject);

    const read = await decryptPiiValueForSubject(kms, stored, KMS_CTX);
    expect(read).toBe(PII_ERASED_SENTINEL);
  });

  test("plaintext passes through decrypt unchanged (pre-engine rows)", async () => {
    const kms = new InMemoryKmsAdapter();
    const read = await decryptPiiValueForSubject(kms, "plain-value", KMS_CTX);
    expect(read).toBe("plain-value");
  });
});

describe("cross-subject decrypt leak (kumiko-framework#1190)", () => {
  test("ciphertext forged to a different-but-valid subject's DEK fails GCM auth, not just KeyNotFound", async () => {
    const kms = new InMemoryKmsAdapter();
    const subjectA = { kind: "tenant" as const, tenantId: UUID_A };
    const subjectB = { kind: "tenant" as const, tenantId: UUID_B };
    // Both subjects must have a real key — otherwise this only re-proves the
    // existing "ciphertext without a key row fails loud" (KeyNotFoundError) case.
    await kms.createKey(subjectA);

    const storedForB = await encryptPiiValueForSubject(kms, subjectB, "tenant-b-secret", KMS_CTX);
    const blob = storedForB.slice(storedForB.lastIndexOf(":") + 1);
    const forgedForA = `${PII_CIPHERTEXT_PREFIX}${subjectIdToKey(subjectA)}:${blob}`;

    const attempt = decryptPiiValueForSubject(kms, forgedForA, KMS_CTX);
    await expect(attempt).rejects.not.toBeInstanceOf(KeyNotFoundError);
    await expect(attempt).rejects.not.toBeInstanceOf(KeyErasedError);
    await expect(attempt).rejects.toThrow();
  });
});
