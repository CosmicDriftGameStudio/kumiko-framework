import * as jose from "jose";
import type { PipelineUser } from "../engine/types";

export type JwtPayload = {
  sub: number;
  tenantId: number;
  roles: string[];
};

export type JwtHelper = {
  sign(user: PipelineUser): Promise<string>;
  verify(token: string): Promise<JwtPayload>;
};

export function createJwtHelper(secret: string, issuer = "kumiko"): JwtHelper {
  const encodedSecret = new TextEncoder().encode(secret);

  return {
    async sign(user) {
      return new jose.SignJWT({
        tenantId: user.tenantId,
        roles: [...user.roles],
      } satisfies Omit<JwtPayload, "sub">)
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(String(user.id))
        .setIssuer(issuer)
        .setIssuedAt()
        .setExpirationTime("24h")
        .sign(encodedSecret);
    },

    async verify(token) {
      const { payload } = await jose.jwtVerify(token, encodedSecret, { issuer });
      return {
        sub: Number(payload.sub),
        tenantId: payload["tenantId"] as number,
        roles: payload["roles"] as string[],
      };
    },
  };
}
