import { beforeEach, describe, expect, test } from "bun:test";
import {
  KeyAlreadyExistsError,
  KeyErasedError,
  KeyNotFoundError,
  type KmsAdapter,
  type KmsContext,
  type SubjectId,
  isLocalKeyKmsAdapter,
} from "../kms-adapter";

const ctx: KmsContext = { requestId: "contract-test" };

const userA: SubjectId = { kind: "user", userId: "6b2f4a0e-1c9d-4f3a-9d2e-000000000001" };
const userB: SubjectId = { kind: "user", userId: "6b2f4a0e-1c9d-4f3a-9d2e-000000000002" };
const tenantWithUserAId: SubjectId = {
  kind: "tenant",
  tenantId: "6b2f4a0e-1c9d-4f3a-9d2e-000000000001",
};

async function subjectDek(adapter: KmsAdapter, subject: SubjectId): Promise<Buffer> {
  if (isLocalKeyKmsAdapter(adapter)) return adapter.getKey(subject, ctx);
  // remote-crypto adapters never release keys — probe via roundtrip instead.
  const probe = Buffer.from("contract-probe");
  const encrypted = await adapter.encrypt(subject, probe, ctx);
  return Buffer.from(await adapter.decrypt(subject, encrypted, ctx));
}

export function describeKmsAdapterContract(
  name: string,
  factory: () => KmsAdapter | Promise<KmsAdapter>,
): void {
  describe(`${name} — KmsAdapter contract`, () => {
    let adapter: KmsAdapter;

    beforeEach(async () => {
      adapter = await factory();
    });

    test("createKey then getKey returns a 32-byte DEK", async () => {
      await adapter.createKey(userA, ctx);
      if (!isLocalKeyKmsAdapter(adapter)) return;
      const dek = await adapter.getKey(userA, ctx);
      expect(dek.length).toBe(32);
    });

    test("getKey is stable — same subject, same key", async () => {
      await adapter.createKey(userA, ctx);
      if (!isLocalKeyKmsAdapter(adapter)) return;
      const first = await adapter.getKey(userA, ctx);
      const second = await adapter.getKey(userA, ctx);
      expect(first.equals(second)).toBe(true);
    });

    test("distinct subjects get distinct keys", async () => {
      await adapter.createKey(userA, ctx);
      await adapter.createKey(userB, ctx);
      if (!isLocalKeyKmsAdapter(adapter)) return;
      const a = await adapter.getKey(userA, ctx);
      const b = await adapter.getKey(userB, ctx);
      expect(a.equals(b)).toBe(false);
    });

    test("user and tenant subjects with the same raw id are distinct", async () => {
      await adapter.createKey(userA, ctx);
      await adapter.createKey(tenantWithUserAId, ctx);
      if (!isLocalKeyKmsAdapter(adapter)) return;
      const user = await adapter.getKey(userA, ctx);
      const tenant = await adapter.getKey(tenantWithUserAId, ctx);
      expect(user.equals(tenant)).toBe(false);
    });

    test("createKey twice throws KeyAlreadyExistsError", async () => {
      await adapter.createKey(userA, ctx);
      await expect(adapter.createKey(userA, ctx)).rejects.toBeInstanceOf(KeyAlreadyExistsError);
    });

    test("getKey for an unknown subject throws KeyNotFoundError", async () => {
      if (!isLocalKeyKmsAdapter(adapter)) return;
      await expect(adapter.getKey(userA, ctx)).rejects.toBeInstanceOf(KeyNotFoundError);
    });

    test("eraseKey makes getKey throw KeyErasedError", async () => {
      await adapter.createKey(userA, ctx);
      await adapter.eraseKey(userA, ctx);
      if (!isLocalKeyKmsAdapter(adapter)) return;
      await expect(adapter.getKey(userA, ctx)).rejects.toBeInstanceOf(KeyErasedError);
    });

    test("eraseKey is idempotent — second call is a no-op", async () => {
      await adapter.createKey(userA, ctx);
      await adapter.eraseKey(userA, ctx);
      await adapter.eraseKey(userA, ctx);
      if (!isLocalKeyKmsAdapter(adapter)) return;
      await expect(adapter.getKey(userA, ctx)).rejects.toBeInstanceOf(KeyErasedError);
    });

    test("eraseKey for an unknown subject is a no-op", async () => {
      await adapter.eraseKey(userA, ctx);
      if (!isLocalKeyKmsAdapter(adapter)) return;
      await expect(adapter.getKey(userA, ctx)).rejects.toBeInstanceOf(KeyNotFoundError);
    });

    test("createKey after eraseKey throws — the tombstone blocks a new key", async () => {
      await adapter.createKey(userA, ctx);
      await adapter.eraseKey(userA, ctx);
      await expect(adapter.createKey(userA, ctx)).rejects.toBeInstanceOf(KeyAlreadyExistsError);
    });

    test("erasing one subject leaves other subjects intact", async () => {
      await adapter.createKey(userA, ctx);
      await adapter.createKey(userB, ctx);
      await adapter.eraseKey(userA, ctx);
      const dek = await subjectDek(adapter, userB);
      expect(dek.length).toBeGreaterThan(0);
    });

    test("remote-crypto adapters roundtrip encrypt/decrypt", async () => {
      if (isLocalKeyKmsAdapter(adapter)) return;
      await adapter.createKey(userA, ctx);
      const plaintext = Buffer.from("marc@example.com");
      const ciphertext = await adapter.encrypt(userA, plaintext, ctx);
      expect(Buffer.from(ciphertext).equals(plaintext)).toBe(false);
      const roundtrip = await adapter.decrypt(userA, ciphertext, ctx);
      expect(Buffer.from(roundtrip).equals(plaintext)).toBe(true);
    });

    test("health reports ok for a reachable adapter", async () => {
      const health = await adapter.health();
      expect(health.ok).toBe(true);
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });
}
