import { describe, expect, test } from "bun:test";
import { createEntity, createTextField } from "../../engine/factories";
import { InMemoryKmsAdapter } from "../in-memory-kms-adapter";
import { KeyNotFoundError, type KmsContext, subjectIdFromKey } from "../kms-adapter";
import {
  decryptPiiFieldValues,
  encryptPiiFieldValues,
  isPiiCiphertext,
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
