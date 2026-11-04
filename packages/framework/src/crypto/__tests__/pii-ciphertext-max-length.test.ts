import { describe, expect, test } from "bun:test";
import type { TenantId } from "../../engine/types/identifiers.ts";
import { InMemoryKmsAdapter } from "../in-memory-kms-adapter.ts";
import type { SubjectId } from "../kms-adapter.ts";
import { encryptPiiValueForSubject, piiCiphertextMaxLengthFor } from "../pii-field-encryption.ts";

const TENANT_ID = "6b2f4a0e-1c9d-4f3a-9d2e-00000000000a";
const subject: SubjectId = { kind: "tenant", tenantId: TENANT_ID };
const kmsCtx = { requestId: "pii-ciphertext-max-length", tenantId: TENANT_ID as TenantId };

describe("piiCiphertextMaxLengthFor", () => {
  test.each([1, 2000, 4000])("covers the ciphertext of a %i-character ASCII value", async (n) => {
    const stored = await encryptPiiValueForSubject(
      new InMemoryKmsAdapter(),
      subject,
      "a".repeat(n),
      kmsCtx,
      "field",
    );
    expect(stored.length).toBeGreaterThan(n);
    expect(stored.length).toBeLessThanOrEqual(piiCiphertextMaxLengthFor(n));
  });

  test.each([1, 2000, 4000])("covers the ciphertext of %i three-byte characters", async (n) => {
    const stored = await encryptPiiValueForSubject(
      new InMemoryKmsAdapter(),
      subject,
      "€".repeat(n),
      kmsCtx,
      "field",
    );
    expect(stored.length).toBeLessThanOrEqual(piiCiphertextMaxLengthFor(n));
  });

  test("covers a surrogate-pair value, which is 2 units per 4 bytes", async () => {
    const value = "\u{1F600}".repeat(2000);
    expect(value.length).toBe(4000);
    const stored = await encryptPiiValueForSubject(
      new InMemoryKmsAdapter(),
      subject,
      value,
      kmsCtx,
      "field",
    );
    expect(stored.length).toBeLessThanOrEqual(piiCiphertextMaxLengthFor(4000));
  });
});
