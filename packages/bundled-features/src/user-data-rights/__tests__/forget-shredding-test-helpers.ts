// Shared setup/assertions for the integration tests that prove a forget run
// crypto-shreds the user's address in the event store (mail-default-bridge +
// run-forget-cleanup).

import { afterEach, beforeEach, expect } from "bun:test";
import {
  configureBlindIndexKey,
  configurePiiSubjectKms,
  decryptPiiFieldValues,
  InMemoryKmsAdapter,
  isPiiCiphertext,
  PII_ERASED_SENTINEL,
} from "@cosmicdrift/kumiko-framework/crypto";
import {
  resetBlindIndexKeyForTests,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-framework/testing";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";

const BLIND_INDEX_KEY = Buffer.alloc(32, 7).toString("base64");
const KMS_REQUEST = { requestId: "forget-shredding-check" };

/** Without a subject KMS every event payload stays plaintext by design
 *  (crypto-shredding off), so forget assertions need one configured per test. */
export function setupSubjectKmsForTest(): () => InMemoryKmsAdapter {
  let kms = new InMemoryKmsAdapter();
  beforeEach(() => {
    kms = new InMemoryKmsAdapter();
    configurePiiSubjectKms(kms);
    configureBlindIndexKey(BLIND_INDEX_KEY);
  });
  afterEach(() => {
    resetPiiSubjectKmsForTests();
    resetBlindIndexKeyForTests();
  });
  return () => kms;
}

export async function decryptEmail(kms: InMemoryKmsAdapter, email: string): Promise<unknown> {
  const decrypted = await decryptPiiFieldValues({ email }, ["email"], kms, KMS_REQUEST);
  return decrypted["email"];
}

/** String `email` values nested under `key` (`changes` / `previous`) of the given event payloads. */
export function emailsIn(
  payloads: readonly Record<string, unknown>[],
  key: "changes" | "previous",
): string[] {
  return payloads.flatMap((payload) => {
    const nested = payload[key];
    const email = isPlainObject(nested) ? nested["email"] : undefined;
    return typeof email === "string" ? [email] : [];
  });
}

export async function expectEmailsShredded(
  emails: readonly string[],
  kms: InMemoryKmsAdapter,
  userId: string,
): Promise<void> {
  for (const email of emails) {
    expect(isPiiCiphertext(email) || email === PII_ERASED_SENTINEL).toBe(true);
    expect(await decryptEmail(kms, email)).toBe(PII_ERASED_SENTINEL);
  }
  await expect(kms.getKey({ kind: "user", userId })).rejects.toThrow("Subject key erased");
}
