import { describe, expect, test } from "bun:test";
import { resolveMfaTokenSecrets } from "../token-secrets";

const JWT_SECRET = "app-jwt-secret-for-tests";

describe("resolveMfaTokenSecrets", () => {
  // A setup token proves "enrolling a factor", a challenge token proves
  // "passed step one of login". One shared key would let the first be
  // replayed as the second.
  test("derives two different secrets", () => {
    const { setupTokenSecret, challengeTokenSecret } = resolveMfaTokenSecrets(JWT_SECRET);

    expect(setupTokenSecret).not.toBe(challengeTokenSecret);
    expect(setupTokenSecret).not.toBe(JWT_SECRET);
  });

  // The reason this helper exists: prod entrypoint and dev server each resolve
  // the secrets, and a purpose string drifting between them would invalidate
  // every token minted by the other.
  test("is stable across calls, so two boot files agree", () => {
    expect(resolveMfaTokenSecrets(JWT_SECRET)).toEqual(resolveMfaTokenSecrets(JWT_SECRET));
  });

  test("an explicit override wins over derivation", () => {
    const resolved = resolveMfaTokenSecrets(JWT_SECRET, { setupTokenSecret: "explicit-setup" });

    expect(resolved.setupTokenSecret).toBe("explicit-setup");
    expect(resolved.challengeTokenSecret).toBe(
      resolveMfaTokenSecrets(JWT_SECRET).challengeTokenSecret,
    );
  });

  test("rotating the master rotates both", () => {
    const before = resolveMfaTokenSecrets(JWT_SECRET);
    const after = resolveMfaTokenSecrets(`${JWT_SECRET}-rotated`);

    expect(after.setupTokenSecret).not.toBe(before.setupTokenSecret);
    expect(after.challengeTokenSecret).not.toBe(before.challengeTokenSecret);
  });
});
