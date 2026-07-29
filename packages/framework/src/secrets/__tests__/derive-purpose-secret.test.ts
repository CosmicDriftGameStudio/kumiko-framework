import { describe, expect, test } from "bun:test";
import { derivePurposeSecret } from "../derive-purpose-secret";

const MASTER = "master-secret-for-tests-32-bytes-min";

describe("derivePurposeSecret", () => {
  test("is deterministic — same master and purpose give the same secret", () => {
    expect(derivePurposeSecret(MASTER, "mfa-setup-token-v1")).toBe(
      derivePurposeSecret(MASTER, "mfa-setup-token-v1"),
    );
  });

  // The whole point: two purposes must not share a key, or a token minted for
  // one boundary verifies at another.
  test("separates purposes", () => {
    expect(derivePurposeSecret(MASTER, "mfa-setup-token-v1")).not.toBe(
      derivePurposeSecret(MASTER, "mfa-challenge-token-v1"),
    );
  });

  test("versioning a purpose yields a different secret, so rotation is per-purpose", () => {
    expect(derivePurposeSecret(MASTER, "deletion-token-v1")).not.toBe(
      derivePurposeSecret(MASTER, "deletion-token-v2"),
    );
  });

  test("rotating the master rotates every derived secret", () => {
    expect(derivePurposeSecret(MASTER, "deletion-token-v1")).not.toBe(
      derivePurposeSecret(`${MASTER}-rotated`, "deletion-token-v1"),
    );
  });

  test("never returns the master itself", () => {
    const derived = derivePurposeSecret(MASTER, "mfa-setup-token-v1");

    expect(derived).not.toBe(MASTER);
    expect(derived).not.toContain(MASTER);
  });

  test("returns 32 bytes as hex", () => {
    expect(derivePurposeSecret(MASTER, "any-purpose-v1")).toMatch(/^[0-9a-f]{64}$/);
  });

  // An empty purpose would silently collapse every boundary onto one key —
  // the failure mode this function exists to prevent, so it must be loud.
  test.each([
    ["empty master", "", "a-purpose"],
    ["empty purpose", MASTER, ""],
  ])("throws on %s", (_name, master, purpose) => {
    expect(() => derivePurposeSecret(master, purpose)).toThrow(/must not be empty/);
  });
});
