import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import { resolveKmsMode } from "../kms-mode.js";

const COMPLETE_TRIO = {
  PLATFORM_KEK: randomBytes(32).toString("base64"),
  SUBJECT_KEYS_DATABASE_URL: "postgres://kms:kms@127.0.0.1:1/subject_keys",
  KUMIKO_BLIND_INDEX_KEY: randomBytes(32).toString("base64"),
};

describe("resolveKmsMode", () => {
  test("unset passes the low-level fields through unchanged, even with a trio in the env", async () => {
    const kms = new InMemoryKmsAdapter();
    const resolved = await resolveKmsMode(undefined, { kms, blindIndexKey: "bidx" }, COMPLETE_TRIO);
    expect(resolved.kms).toBe(kms);
    expect(resolved.blindIndexKey).toBe("bidx");
    expect(resolved.allowPlaintextPii).toBeUndefined();

    const none = await resolveKmsMode(undefined, {}, COMPLETE_TRIO);
    expect(none.kms).toBeUndefined();
  });

  test("cannot be combined with the low-level fields", async () => {
    await expect(
      resolveKmsMode("required", { allowPlaintextPii: "legacy" }, COMPLETE_TRIO),
    ).rejects.toThrow(/cannot be combined/);
  });

  test("plaintextReason opts out without reading the env", async () => {
    const resolved = await resolveKmsMode({ plaintextReason: "demo app" }, {}, COMPLETE_TRIO);
    expect(resolved.allowPlaintextPii).toBe("demo app");
    expect(resolved.kms).toBeUndefined();
  });

  test("an empty plaintextReason is refused", async () => {
    await expect(resolveKmsMode({ plaintextReason: " " }, {}, {})).rejects.toThrow(/reason/);
  });

  test('"required" with an empty trio aborts', async () => {
    await expect(resolveKmsMode("required", {}, {})).rejects.toThrow(/kmsMode "required"/);
  });

  test('"optional" with an empty trio leaves the PII gate in charge', async () => {
    const resolved = await resolveKmsMode("optional", {}, {});
    expect(resolved.kms).toBeUndefined();
    expect(resolved.allowPlaintextPii).toBeUndefined();
  });

  test("a partial trio throws in every mode", async () => {
    const partial = { PLATFORM_KEK: COMPLETE_TRIO.PLATFORM_KEK };
    await expect(resolveKmsMode("optional", {}, partial)).rejects.toThrow(/all-or-none/);
    await expect(resolveKmsMode("required", {}, partial)).rejects.toThrow(/all-or-none/);
  });

  test("a complete trio wires the adapter and the blind-index key", async () => {
    const resolved = await resolveKmsMode("required", {}, COMPLETE_TRIO);
    try {
      expect(resolved.kms).toBeDefined();
      expect(resolved.blindIndexKey).toBe(COMPLETE_TRIO.KUMIKO_BLIND_INDEX_KEY);
    } finally {
      await resolved.close();
    }
  });
});
