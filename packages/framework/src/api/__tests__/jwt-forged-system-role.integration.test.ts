// A validly-signed token (leaked or foreign signing key) must not turn into the System
// identity: verify() drops "system", so system-gated handlers stay closed over real HTTP.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as jose from "jose";
import * as z from "zod";
import { defineFeature } from "../../engine/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";

const JWT_SECRET = "forged-system-role-test-secret-minimum-32-chars";

const probeFeature = defineFeature("forged-role-probe", (r) => {
  r.queryHandler({
    name: "system-only",
    schema: z.object({}),
    access: { roles: ["system"] },
    handler: async () => ({ ok: true }),
  });
  r.queryHandler({
    name: "admin-only",
    schema: z.object({}),
    access: { roles: ["Admin"] },
    handler: async () => ({ ok: true }),
  });
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [probeFeature], jwtSecret: JWT_SECRET });
});

afterAll(async () => {
  await stack.cleanup();
});

function selfSignedToken(roles: readonly string[]): Promise<string> {
  return new jose.SignJWT({ tenantId: TestUsers.admin.tenantId, roles: [...roles] })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(TestUsers.admin.id)
    .setIssuer("kumiko")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function callQuery(handler: string, roles: readonly string[]): Promise<Response> {
  const token = await selfSignedToken(roles);
  return stack.http.raw(
    "POST",
    "/api/query",
    { type: `forged-role-probe:query:${handler}`, payload: {} },
    { Authorization: `Bearer ${token}` },
  );
}

describe("self-signed bearer token carrying reserved roles", () => {
  test("control: the self-signed token itself authenticates with a legitimate role", async () => {
    const res = await callQuery("admin-only", ["Admin"]);
    expect(res.status).toBe(200);
  });

  test("roles [system] does not reach a system-gated handler", async () => {
    const res = await callQuery("system-only", ["system"]);
    expect(res.status).toBe(403);
  });

  test("system next to a legitimate role is dropped, the legitimate role stays", async () => {
    expect((await callQuery("system-only", ["system", "Admin"])).status).toBe(403);
    expect((await callQuery("admin-only", ["system", "Admin"])).status).toBe(200);
  });
});
