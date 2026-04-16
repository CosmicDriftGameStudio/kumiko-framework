import * as jose from "jose";
import type { SessionUser, TenantId } from "../engine/types";

export type JwtPayload = {
  // JWT `sub` is a string per RFC 7519. Matches SessionUser.id — a UUID-string
  // under the ES migration. `sign()` already stringifies via String(user.id);
  // `verify()` just passes it through.
  sub: string;
  tenantId: TenantId;
  roles: string[];
  // Optional — present when a feature has registered auth claims (future:
  // `r.authClaims()` hook). Absent for the MVP login flow.
  claims?: Record<string, unknown>;
};

export type JwtHelper = {
  sign(user: SessionUser): Promise<string>;
  verify(token: string): Promise<JwtPayload>;
};

export function createJwtHelper(secret: string, issuer = "kumiko"): JwtHelper {
  const encodedSecret = new TextEncoder().encode(secret);

  return {
    async sign(user) {
      const body: Omit<JwtPayload, "sub"> = {
        tenantId: user.tenantId,
        roles: [...user.roles],
      };
      if (user.claims) body.claims = { ...user.claims };

      return new jose.SignJWT(body)
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(String(user.id))
        .setIssuer(issuer)
        .setIssuedAt()
        .setExpirationTime("24h")
        .sign(encodedSecret);
    },

    async verify(token) {
      const { payload } = await jose.jwtVerify(token, encodedSecret, { issuer });
      const result: JwtPayload = {
        sub: String(payload.sub),
        tenantId: payload["tenantId"] as string,
        roles: payload["roles"] as string[],
      };
      const claims = payload["claims"];
      if (claims && typeof claims === "object") {
        result.claims = claims as Record<string, unknown>;
      }
      return result;
    },
  };
}
