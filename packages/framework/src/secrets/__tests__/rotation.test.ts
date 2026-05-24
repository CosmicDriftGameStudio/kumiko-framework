import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { createEnvMasterKeyProvider } from "../env-master-key-provider";
import { decryptValue, encryptValue } from "../envelope";
import { rewrapDek } from "../rotation";

// Shared KEK bytes across provider reconstructions — mimics ops setting
// the same env var across deploys. This is how we model "the KEK didn't
// change but CURRENT_VERSION did" in a single test process.
const KEK_V1 = randomBytes(32);
const KEK_V2 = randomBytes(32);

function providerWithCurrent(
  v: number,
  extraKeys: boolean = true,
): ReturnType<typeof createEnvMasterKeyProvider> {
  const envVars: Record<string, string> = {
    KUMIKO_SECRETS_MASTER_KEY_V1: KEK_V1.toString("base64"),
    KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: String(v),
  };
  if (extraKeys) {
    envVars["KUMIKO_SECRETS_MASTER_KEY_V2"] = KEK_V2.toString("base64");
  }
  return createEnvMasterKeyProvider({ env: envVars });
}

describe("rotation — the whole point of the multi-version keyring", () => {
  test("a value encrypted with V1 stays readable after CURRENT flips to V2", async () => {
    // Day 1: ops has only V1 deployed, current=1. We encrypt a secret.
    const day1 = providerWithCurrent(1, /* extraKeys */ false);
    const envelope = await encryptValue("my-stripe-key", day1);
    expect(envelope.kekVersion).toBe(1);

    // Day 3: ops deployed V2 ENV too, and has now flipped current=2.
    // The keyring still contains V1 so old rows must keep reading.
    const day3 = providerWithCurrent(2);
    const back = await decryptValue(envelope, day3);
    expect(back).toBe("my-stripe-key");
  });

  test("after rotation, new writes land on the new version", async () => {
    const day3 = providerWithCurrent(2);
    const envelope = await encryptValue("fresh secret", day3);
    // The point: without touching rewrap logic at all, simply having
    // flipped CURRENT_VERSION means new values use V2.
    expect(envelope.kekVersion).toBe(2);
  });

  test("rewrapDek migrates a V1-envelope to V2 without touching ciphertext", async () => {
    // Encrypt under V1 (no V2 yet) so we have a pure V1 row.
    const day1 = providerWithCurrent(1, /* extraKeys */ false);
    const originalEnvelope = await encryptValue("sensitive", day1);
    expect(originalEnvelope.kekVersion).toBe(1);

    // Later, ops has rolled V2 and flipped current.
    const day3 = providerWithCurrent(2);
    const rotated = await rewrapDek(originalEnvelope, day3);

    // Key property: DEK got re-wrapped, ciphertext untouched. This is
    // WHY envelope rotation is cheap — we only rewrite a ~60-byte blob
    // per row, never the potentially large ciphertext.
    expect(rotated.kekVersion).toBe(2);
    expect(rotated.ciphertext.equals(originalEnvelope.ciphertext)).toBe(true);
    expect(rotated.iv.equals(originalEnvelope.iv)).toBe(true);
    expect(rotated.authTag.equals(originalEnvelope.authTag)).toBe(true);
    // The wrapped DEK DID change — it's now wrapped with KEK V2.
    expect(rotated.encryptedDek.equals(originalEnvelope.encryptedDek)).toBe(false);

    // Most important: the rotated envelope still decrypts correctly.
    expect(await decryptValue(rotated, day3)).toBe("sensitive");
  });

  test("rewrapDek is a no-op when the envelope is already current", async () => {
    const day3 = providerWithCurrent(2);
    const envelope = await encryptValue("already-v2", day3);
    expect(envelope.kekVersion).toBe(2);

    const rotated = await rewrapDek(envelope, day3);
    // Same reference — no work was done.
    expect(rotated).toBe(envelope);
  });

  test("rewrap requires the OLD version to still be in the keyring", async () => {
    // Encrypt under V1
    const day1 = providerWithCurrent(1, /* extraKeys */ false);
    const envelope = await encryptValue("stranded", day1);

    // Day 5: ops RETIRED V1 — env no longer has KUMIKO_SECRETS_MASTER_KEY_V1,
    // only V2. An old row with kekVersion=1 is now unreadable.
    const dayRetired = createEnvMasterKeyProvider({
      env: {
        KUMIKO_SECRETS_MASTER_KEY_V2: KEK_V2.toString("base64"),
        KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "2",
      },
    });
    await expect(rewrapDek(envelope, dayRetired)).rejects.toThrow(/no KEK for version 1/);
    // Lesson: ops MUST rotate all rows off V1 before deleting V1 from env.
  });

  test("full rotation drill: encrypt V1 → staging V1+V2 → promote to V2 → rewrap → retire V1", async () => {
    // Simulates the canonical rotation sequence end-to-end.

    // --- Day 1: only V1, CURRENT=1 ---
    const day1 = providerWithCurrent(1, /* extraKeys */ false);
    const envA = await encryptValue("value-A", day1);
    const envB = await encryptValue("value-B", day1);
    expect(envA.kekVersion).toBe(1);
    expect(envB.kekVersion).toBe(1);

    // --- Day 2: V1+V2 deployed, CURRENT still 1 (staging) ---
    const day2 = providerWithCurrent(1, /* extraKeys */ true);
    // Both old rows still read
    expect(await decryptValue(envA, day2)).toBe("value-A");
    expect(await decryptValue(envB, day2)).toBe("value-B");
    // New writes: still V1 — crucial! CURRENT hasn't flipped.
    const envC = await encryptValue("value-C", day2);
    expect(envC.kekVersion).toBe(1);

    // --- Day 3: CURRENT flipped to 2 ---
    const day3 = providerWithCurrent(2, /* extraKeys */ true);
    // Old rows still readable
    expect(await decryptValue(envA, day3)).toBe("value-A");
    // New writes now land on V2
    const envD = await encryptValue("value-D", day3);
    expect(envD.kekVersion).toBe(2);

    // --- Day 4: rotation job migrates all V1 rows ---
    const rotA = await rewrapDek(envA, day3);
    const rotB = await rewrapDek(envB, day3);
    const rotC = await rewrapDek(envC, day3);
    expect(rotA.kekVersion).toBe(2);
    expect(rotB.kekVersion).toBe(2);
    expect(rotC.kekVersion).toBe(2);
    expect(await decryptValue(rotA, day3)).toBe("value-A");

    // --- Day 5: V1 retired from env ---
    const day5 = createEnvMasterKeyProvider({
      env: {
        KUMIKO_SECRETS_MASTER_KEY_V2: KEK_V2.toString("base64"),
        KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "2",
      },
    });
    // All rotated rows still decrypt
    expect(await decryptValue(rotA, day5)).toBe("value-A");
    expect(await decryptValue(rotB, day5)).toBe("value-B");
    expect(await decryptValue(rotC, day5)).toBe("value-C");
    expect(await decryptValue(envD, day5)).toBe("value-D");
  });
});
