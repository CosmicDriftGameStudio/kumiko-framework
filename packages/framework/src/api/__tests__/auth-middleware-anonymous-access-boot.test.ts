// authMiddleware boots eagerly (not per-request) so a tenantResolver
// declared without resolverTrust is an ambiguous trust decision that fails
// loud at startup, instead of silently letting a client-set tenant header
// override a host-derived resolver at request time (#1452).

import { describe, expect, test } from "bun:test";
import { authMiddleware } from "../auth-middleware";
import { createJwtHelper } from "../jwt";

const JWT_SECRET = "auth-middleware-anon-access-boot-test-secret-32ch";

describe("authMiddleware anonymousAccess boot guard", () => {
  test("throws at construction when tenantResolver is set without resolverTrust", () => {
    const jwt = createJwtHelper(JWT_SECRET);
    expect(() =>
      authMiddleware(jwt, {
        anonymousAccess: {
          tenantResolver: () => "t1" as never,
        },
      }),
    ).toThrow(/resolverTrust/);
  });

  test("does not throw when resolverTrust is declared", () => {
    const jwt = createJwtHelper(JWT_SECRET);
    expect(() =>
      authMiddleware(jwt, {
        anonymousAccess: {
          tenantResolver: () => "t1" as never,
          resolverTrust: "authoritative",
        },
      }),
    ).not.toThrow();
  });

  test("does not throw when no tenantResolver is configured", () => {
    const jwt = createJwtHelper(JWT_SECRET);
    expect(() => authMiddleware(jwt, {})).not.toThrow();
  });
});
