import { describe, expect, test } from "bun:test";
import { createEntity, createJsonbField, createTextField } from "../../engine/factories.js";
import { InMemoryKmsAdapter } from "../in-memory-kms-adapter.js";
import type { KmsContext } from "../kms-adapter.js";
import {
  decryptPiiFieldValues,
  encryptPiiFieldValues,
  isPiiCiphertext,
  PII_CIPHERTEXT_PREFIX,
  PII_CIPHERTEXT_PREFIX_JSON,
  PII_ERASED_SENTINEL,
} from "../pii-field-encryption.js";
import { collectPiiSubjectFields } from "../subject-resolver.js";

const TENANT_ID = "6b2f4a0e-1c9d-4f3a-9d2e-00000000000a";
const KMS_CTX: KmsContext = { requestId: "test" };
const ENTITY_NAME = "golden";

const goldenEntity = createEntity({
  table: "pii_jsonb_goldens",
  fields: {
    input: createJsonbField({ personal: "tenant" }),
    title: createTextField({ personal: "tenant", find: "none" }),
  },
});
const piiFields = collectPiiSubjectFields(goldenEntity);

async function encryptInput(kms: InMemoryKmsAdapter, value: unknown) {
  return encryptPiiFieldValues(
    { id: TENANT_ID, tenantId: TENANT_ID, input: value },
    goldenEntity,
    ["input"],
    kms,
    KMS_CTX,
    { entityName: ENTITY_NAME },
  );
}

describe("jsonb PII fields", () => {
  test.each([
    ["object", { a: 1, nested: { list: [1, "two", null] } }],
    ["array", [1, 2, { x: true }]],
    ["number", 42],
    ["boolean", false],
    ["numeric-looking string", "42"],
    ["plain string", "hello"],
  ])("ciphertext round-trips a %s by type", async (_label, value) => {
    const kms = new InMemoryKmsAdapter();
    const stored = await encryptInput(kms, value);
    expect(isPiiCiphertext(stored["input"])).toBe(true);
    expect(String(stored["input"])).toStartWith(
      `${PII_CIPHERTEXT_PREFIX_JSON}tenant:${TENANT_ID}:`,
    );
    expect(JSON.stringify(stored["input"])).not.toContain("hello");

    const read = await decryptPiiFieldValues(stored, ["input"], kms, KMS_CTX);
    expect(read["input"]).toEqual(value);
  });

  test("null stays null and is not encrypted", async () => {
    const stored = await encryptInput(new InMemoryKmsAdapter(), null);
    expect(stored["input"]).toBeNull();
  });

  test("legacy plaintext object/array/string passes through decrypt unchanged", async () => {
    const kms = new InMemoryKmsAdapter();
    for (const legacy of [{ q: "plain" }, ["a", "b"], "legacy string", 7]) {
      const read = await decryptPiiFieldValues({ input: legacy }, ["input"], kms, KMS_CTX);
      expect(read["input"]).toEqual(legacy);
    }
  });

  test("already-encrypted and erased values are not re-encrypted", async () => {
    const kms = new InMemoryKmsAdapter();
    const once = await encryptInput(kms, { a: 1 });
    const twice = await encryptInput(kms, once["input"]);
    expect(twice["input"]).toBe(once["input"]);
    expect((await encryptInput(kms, PII_ERASED_SENTINEL))["input"]).toBe(PII_ERASED_SENTINEL);
  });

  test("erased tenant key yields the sentinel", async () => {
    const kms = new InMemoryKmsAdapter();
    const stored = await encryptInput(kms, { secret: true });
    await kms.eraseKey({ kind: "tenant", tenantId: TENANT_ID });
    const read = await decryptPiiFieldValues(stored, ["input"], kms, KMS_CTX);
    expect(read["input"]).toBe(PII_ERASED_SENTINEL);
  });

  test("a v3 ciphertext re-labelled as v2 fails GCM instead of changing type", async () => {
    const kms = new InMemoryKmsAdapter();
    const stored = await encryptInput(kms, { a: 1 });
    const relabelled = String(stored["input"]).replace(
      PII_CIPHERTEXT_PREFIX_JSON,
      PII_CIPHERTEXT_PREFIX,
    );
    await expect(
      decryptPiiFieldValues({ input: relabelled }, ["input"], kms, KMS_CTX),
    ).rejects.toThrow();
  });

  test("a non-jsonb field still rejects non-string values", async () => {
    const kms = new InMemoryKmsAdapter();
    await expect(
      encryptPiiFieldValues(
        { id: TENANT_ID, tenantId: TENANT_ID, title: { a: 1 } },
        goldenEntity,
        piiFields,
        kms,
        KMS_CTX,
        { entityName: ENTITY_NAME },
      ),
    ).rejects.toThrow(/must be a string/);
  });

  test("a jsonb value that is not JSON-serializable throws", async () => {
    await expect(encryptInput(new InMemoryKmsAdapter(), () => 1)).rejects.toThrow(
      /not JSON-serializable/,
    );
  });
});
