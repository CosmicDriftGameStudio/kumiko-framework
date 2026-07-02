import { describe, expect, test } from "bun:test";
import { MIN_HMAC_SECRET_LENGTH } from "../constants";
import { createAuthEmailPasswordFeature } from "../feature";

// A short HMAC secret makes reset/verify tokens forgeable (account takeover),
// so the factory must fail fast — same bar as the ≥32-char JWT_SECRET check.

const okSecret = "x".repeat(MIN_HMAC_SECRET_LENGTH);
const shortSecret = "x".repeat(MIN_HMAC_SECRET_LENGTH - 1);
const appUrl = "https://app.example.com/flow";

describe("createAuthEmailPasswordFeature hmacSecret validation", () => {
  test("rejects a short passwordReset.hmacSecret", () => {
    expect(() =>
      createAuthEmailPasswordFeature({ passwordReset: { hmacSecret: shortSecret, appUrl } }),
    ).toThrow(/passwordReset\.hmacSecret must be/);
  });

  test("rejects a short emailVerification.hmacSecret", () => {
    expect(() =>
      createAuthEmailPasswordFeature({ emailVerification: { hmacSecret: shortSecret, appUrl } }),
    ).toThrow(/emailVerification\.hmacSecret must be/);
  });

  test("accepts secrets at the minimum length", () => {
    expect(() =>
      createAuthEmailPasswordFeature({
        passwordReset: { hmacSecret: okSecret, appUrl },
        emailVerification: { hmacSecret: okSecret, appUrl },
      }),
    ).not.toThrow();
  });
});
