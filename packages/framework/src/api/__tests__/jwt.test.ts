import { describe, expect, it } from "bun:test";
import * as jose from "jose";
import type { SessionUser } from "../../engine/types";
import { createJwtHelper, loadJwtSecretOrKeyring } from "../jwt";

const SECRET = "test-secret-at-least-32-characters-long-aa";
const TENANT = "11111111-1111-4111-8111-111111111111";
const ISSUER = "kumiko";

const user: SessionUser = {
  id: "22222222-2222-4222-8222-222222222222",
  tenantId: TENANT,
  roles: ["TenantAdmin"],
};

// Sign a token with arbitrary claims using the SAME secret (valid signature, fully
// controlled payload). This is how a leaked-secret / hand-crafted token looks, and it is
// exactly what verify() must reject on claim shape — not just on a bad signature.
function forge(claims: Record<string, unknown>): Promise<string> {
  return new jose.SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
}

// Same as forge(), but never calls .setSubject() — the only way to produce a
// validly-signed token with no `sub` claim at all (forge() always sets one).
function forgeNoSub(claims: Record<string, unknown>): Promise<string> {
  return new jose.SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
}

describe("createJwtHelper.verify — payload validation (KF-2)", () => {
  const jwt = createJwtHelper(SECRET);

  it("round-trips a well-formed token", async () => {
    const payload = await jwt.verify(await jwt.sign(user));
    expect(payload.sub).toBe(user.id);
    expect(payload.tenantId).toBe(TENANT);
    expect(payload.roles).toEqual(["TenantAdmin"]);
  });

  it("rejects a validly-signed token whose tenantId is malformed", async () => {
    const token = await forge({ tenantId: "not-a-uuid", roles: ["TenantAdmin"] });
    await expect(jwt.verify(token)).rejects.toThrow(/tenantId/);
  });

  it("rejects a token with no tenantId claim", async () => {
    const token = await forge({ roles: ["TenantAdmin"] });
    await expect(jwt.verify(token)).rejects.toThrow(/tenantId/);
  });

  it("rejects a token whose roles claim is not an array", async () => {
    const token = await forge({ tenantId: TENANT, roles: "TenantAdmin" });
    await expect(jwt.verify(token)).rejects.toThrow(/roles/);
  });

  it("rejects a token whose roles array contains a non-string", async () => {
    const token = await forge({ tenantId: TENANT, roles: ["ok", 7] });
    await expect(jwt.verify(token)).rejects.toThrow(/roles/);
  });

  it("rejects a validly-signed token with no sub claim", async () => {
    const token = await forgeNoSub({ tenantId: TENANT, roles: ["TenantAdmin"] });
    await expect(jwt.verify(token)).rejects.toThrow(/sub/);
  });

  it("rejects a token whose sub claim is an empty string", async () => {
    const token = await new jose.SignJWT({ tenantId: TENANT, roles: ["TenantAdmin"] })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("")
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(SECRET));
    await expect(jwt.verify(token)).rejects.toThrow(/sub/);
  });
});

describe("createJwtHelper — keyring form", () => {
  it("sets kid in the protected header when signing from a keyring", async () => {
    const jwt = createJwtHelper({ keys: { v1: SECRET }, signKid: "v1" });
    const token = await jwt.sign(user);
    expect(jose.decodeProtectedHeader(token).kid).toBe("v1");
  });

  it("verifies a keyring-signed token against a string-form helper on the same secret", async () => {
    const keyringSigner = createJwtHelper({ keys: { v1: SECRET }, signKid: "v1" });
    const token = await keyringSigner.sign(user);

    const stringVerifier = createJwtHelper(SECRET);
    const payload = await stringVerifier.verify(token);
    expect(payload.sub).toBe(user.id);
  });

  it("omits kid when signing from a plain secret (string form)", async () => {
    const jwt = createJwtHelper(SECRET);
    const token = await jwt.sign(user);
    expect(jose.decodeProtectedHeader(token).kid).toBeUndefined();
  });

  it("verifies a token signed under an old kid after rotating signKid", async () => {
    const OLD_SECRET = "old-secret-at-least-32-characters-long-aa";
    const before = createJwtHelper({ keys: { v1: OLD_SECRET }, signKid: "v1" });
    const token = await before.sign(user);

    const after = createJwtHelper({ keys: { v1: OLD_SECRET, v2: SECRET }, signKid: "v2" });
    const payload = await after.verify(token);
    expect(payload.sub).toBe(user.id);
  });

  it("verifies a legacy no-kid token against a multi-key keyring", async () => {
    const legacy = createJwtHelper(SECRET);
    const token = await legacy.sign(user);

    const rotated = createJwtHelper({
      keys: { v1: "unrelated-secret-32-characters-longg", v2: SECRET },
      signKid: "v2",
    });
    const payload = await rotated.verify(token);
    expect(payload.sub).toBe(user.id);
  });

  it("rejects a token whose kid is not in the keyring", async () => {
    const signer = createJwtHelper({ keys: { v1: SECRET }, signKid: "v1" });
    const token = await signer.sign(user);

    const verifier = createJwtHelper({ keys: { v2: SECRET }, signKid: "v2" });
    await expect(verifier.verify(token)).rejects.toThrow(/kid/);
  });

  it("throws at creation when signKid is not present in the keyring", () => {
    expect(() => createJwtHelper({ keys: { v1: SECRET }, signKid: "v2" })).toThrow(/signKid/);
  });
});

describe("loadJwtSecretOrKeyring", () => {
  it("no JWT_SECRET_V<n> → falls back to plain JWT_SECRET", () => {
    expect(loadJwtSecretOrKeyring({ JWT_SECRET: SECRET })).toBe(SECRET);
  });

  it("neither JWT_SECRET_V<n> nor JWT_SECRET set → throws", () => {
    expect(() => loadJwtSecretOrKeyring({})).toThrow(/JWT_SECRET not set/);
  });

  it("JWT_SECRET_V1 + JWT_SECRET_CURRENT_VERSION=1 → single-key keyring, signKid v1", () => {
    expect(
      loadJwtSecretOrKeyring({
        JWT_SECRET_V1: SECRET,
        JWT_SECRET_CURRENT_VERSION: "1",
      }),
    ).toEqual({ keys: { v1: SECRET }, signKid: "v1" });
  });

  it("rotation: two versions, current-version picks the sign key, both stay verifiable", () => {
    const OLD_SECRET = "old-secret-at-least-32-characters-long!!";
    expect(
      loadJwtSecretOrKeyring({
        JWT_SECRET_V1: OLD_SECRET,
        JWT_SECRET_V2: SECRET,
        JWT_SECRET_CURRENT_VERSION: "2",
      }),
    ).toEqual({ keys: { v1: OLD_SECRET, v2: SECRET }, signKid: "v2" });
  });

  it("JWT_SECRET_V<n> present but JWT_SECRET_CURRENT_VERSION missing → throws", () => {
    expect(() => loadJwtSecretOrKeyring({ JWT_SECRET_V1: SECRET })).toThrow(
      /JWT_SECRET_CURRENT_VERSION not set/,
    );
  });

  it("JWT_SECRET_CURRENT_VERSION points at a version with no matching JWT_SECRET_V<n> → throws", () => {
    expect(() =>
      loadJwtSecretOrKeyring({
        JWT_SECRET_V1: SECRET,
        JWT_SECRET_CURRENT_VERSION: "2",
      }),
    ).toThrow(/not present in the keyring/);
  });

  it("plain JWT_SECRET is ignored once a keyring is present", () => {
    expect(
      loadJwtSecretOrKeyring({
        JWT_SECRET: "should-be-ignored-once-keyring-present-aa",
        JWT_SECRET_V1: SECRET,
        JWT_SECRET_CURRENT_VERSION: "1",
      }),
    ).toEqual({ keys: { v1: SECRET }, signKid: "v1" });
  });

  it("plain JWT_SECRET under 32 chars → throws", () => {
    expect(() => loadJwtSecretOrKeyring({ JWT_SECRET: "too-short" })).toThrow(
      /JWT_SECRET must be ≥32 chars/,
    );
  });

  it("JWT_SECRET_V<n> under 32 chars → throws (bypasses the env-schema check otherwise)", () => {
    expect(() =>
      loadJwtSecretOrKeyring({
        JWT_SECRET_V1: "too-short",
        JWT_SECRET_CURRENT_VERSION: "1",
      }),
    ).toThrow(/JWT_SECRET_V1 must be ≥32 chars/);
  });
});
