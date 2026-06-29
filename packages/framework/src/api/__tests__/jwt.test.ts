import { describe, expect, it } from "bun:test";
import * as jose from "jose";
import type { SessionUser } from "../../engine/types";
import { createJwtHelper } from "../jwt";

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
});
