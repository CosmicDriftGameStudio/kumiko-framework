import { afterEach, describe, expect, test } from "bun:test";
import { InMemoryKmsAdapter } from "../in-memory-kms-adapter.ts";
import {
  KeyNotFoundError,
  type KmsContext,
  type LocalKeyKmsAdapter,
  subjectIdFromKey,
} from "../kms-adapter.ts";
import { ENCRYPTION_UNAVAILABLE_CODE, EncryptionUnavailableError } from "../kms-outage.ts";
import { PiiCiphertextCorruptError } from "../pii-ciphertext-corrupt.ts";
import {
  configuredPiiSubjectKms,
  configurePiiSubjectKms,
  decryptPiiFieldValues,
  encryptPiiValueForSubject,
  resetPiiSubjectKmsForTests,
} from "../pii-field-encryption.ts";

const KMS_CTX: KmsContext = { requestId: "test" };
const SUBJECT = subjectIdFromKey("user:6b2f4a0e-1c9d-4f3a-9d2e-00000000000a");

function failingKms(failure: Error): LocalKeyKmsAdapter {
  const inner = new InMemoryKmsAdapter();
  return {
    capabilities: inner.capabilities,
    createKey: () => Promise.reject(failure),
    getKey: () => Promise.reject(failure),
    eraseKey: (subject) => inner.eraseKey(subject),
    health: () => inner.health(),
  };
}

function configuredKms(): LocalKeyKmsAdapter {
  const kms = configuredPiiSubjectKms();
  if (!kms) throw new Error("no KMS configured");
  return kms;
}

afterEach(() => {
  resetPiiSubjectKmsForTests();
});

describe("KMS outage classification", () => {
  test("a failing key store becomes EncryptionUnavailableError with its own code", async () => {
    configurePiiSubjectKms(failingKms(new Error("connection refused")));

    const error = await configuredKms()
      .getKey(SUBJECT, KMS_CTX)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(EncryptionUnavailableError);
    expect(error).toMatchObject({ code: ENCRYPTION_UNAVAILABLE_CODE, httpStatus: 503 });
  });

  test("a missing key is an answer of a working key store and keeps its type", async () => {
    configurePiiSubjectKms(new InMemoryKmsAdapter());

    const error = await configuredKms()
      .getKey(SUBJECT, KMS_CTX)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(KeyNotFoundError);
  });

  test("a working key store passes its keys through", async () => {
    configurePiiSubjectKms(new InMemoryKmsAdapter());
    const kms = configuredKms();

    await kms.createKey(SUBJECT, KMS_CTX);

    expect(await kms.getKey(SUBJECT, KMS_CTX)).toBeDefined();
  });

  test("decrypting through a failing key store rejects as an outage, never as a corrupt value", async () => {
    const stored = await encryptPiiValueForSubject(
      new InMemoryKmsAdapter(),
      SUBJECT,
      "secret@example.com",
      KMS_CTX,
      "email",
    );
    configurePiiSubjectKms(failingKms(new Error("connection refused")));

    const error = await decryptPiiFieldValues(
      { email: stored },
      ["email"],
      configuredKms(),
      KMS_CTX,
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(EncryptionUnavailableError);
    expect(error).not.toBeInstanceOf(PiiCiphertextCorruptError);
  });
});
