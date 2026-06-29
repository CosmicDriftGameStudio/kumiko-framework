import * as jose from "jose";
import type { DbRow } from "../db/connection";
import type { SessionUser, TenantId } from "../engine/types";
import { parseTenantId } from "../engine/types";

export type JwtPayload = {
  // JWT `sub` is a string per RFC 7519. Matches SessionUser.id — a UUID-string
  // under the ES migration. `sign()` already stringifies via String(user.id);
  // `verify()` just passes it through.
  sub: string;
  tenantId: TenantId;
  roles: string[];
  // Optional — present when a feature has registered auth claims via the
  // `r.authClaims()` hook system. Absent for stateless-JWT deployments
  // without auth-claims wiring.
  claims?: Record<string, unknown>;
  // Optional session-ID, carried in the standard `jti` JWT claim.
  // Present when the app wires a `sessionCreator` callback (see sessions
  // feature). Absent → stateless-JWT mode, no revocation possible.
  jti?: string;
};

export type JwtHelper = {
  sign(user: SessionUser): Promise<string>;
  verify(token: string): Promise<JwtPayload>;
};

export function createJwtHelper(secret: string, issuer = "kumiko"): JwtHelper {
  const encodedSecret = new TextEncoder().encode(secret);

  return {
    async sign(user) {
      const body: Omit<JwtPayload, "sub" | "jti"> = {
        tenantId: user.tenantId,
        roles: [...user.roles],
      };
      if (user.claims) body.claims = { ...user.claims };

      const builder = new jose.SignJWT(body)
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(String(user.id))
        .setIssuer(issuer)
        .setIssuedAt()
        .setExpirationTime("24h");
      if (user.sid) builder.setJti(user.sid);

      return builder.sign(encodedSecret);
    },

    async verify(token) {
      const { payload } = await jose.jwtVerify(token, encodedSecret, { issuer });

      // Defence in depth: a valid signature does not guarantee well-formed claims. A
      // leaked secret, key confusion, or a hand-crafted token can still carry junk —
      // validate the claim shape and reject (verify() throws → 401 in auth-middleware)
      // instead of casting blindly.
      const tenantId = parseTenantId(payload["tenantId"]);
      if (tenantId === null) {
        throw new Error("JWT payload validation failed: tenantId claim is missing or malformed");
      }
      const rawRoles = payload["roles"];
      if (!Array.isArray(rawRoles)) {
        throw new Error("JWT payload validation failed: roles claim must be an array");
      }
      const roles: string[] = [];
      for (const role of rawRoles) {
        if (typeof role !== "string") {
          throw new Error("JWT payload validation failed: roles must contain only strings");
        }
        roles.push(role);
      }

      const result: JwtPayload = {
        sub: String(payload.sub),
        tenantId,
        roles,
      };
      const claims = payload["claims"];
      if (claims && typeof claims === "object") {
        result.claims = claims as DbRow;
      }
      if (typeof payload.jti === "string") {
        result.jti = payload.jti;
      }
      return result;
    },
  };
}
