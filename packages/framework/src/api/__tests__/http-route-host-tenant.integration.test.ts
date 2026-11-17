import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { defineFeature } from "../../engine/index.ts";
import type { TenantId } from "../../engine/types/identifiers.ts";

const TENANT_A = "00000000-0000-4000-8000-0000000000a1" as TenantId;
const TENANT_GONE = "00000000-0000-4000-8000-0000000000a2" as TenantId;

const probeFeature = defineFeature("http-route-host-tenant", (r) => {
  r.httpRoute({
    method: "GET",
    path: "/probe/host-tenant",
    anonymous: true,
    handler: async (c, { hostTenantId }) => c.json({ tenantId: await hostTenantId() }),
  });
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [probeFeature],
    anonymousAccess: {
      tenantResolver: (c) => {
        const host = c.req.header("host");
        if (host === "a.test") return TENANT_A;
        if (host === "gone.test") return TENANT_GONE;
        return null;
      },
      resolverTrust: "authoritative",
      tenantExists: (id) => id === TENANT_A,
    },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

async function hostTenantOf(headers: Record<string, string>): Promise<string | null> {
  const res = await stack.app.request("/probe/host-tenant", { headers });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tenantId: string | null };
  return body.tenantId;
}

describe("r.httpRoute deps.hostTenantId", () => {
  test("a resolved, existing host maps to its tenant", async () => {
    expect(await hostTenantOf({ Host: "a.test" })).toBe(TENANT_A);
  });

  test("a resolved host whose tenant does not exist maps to null", async () => {
    expect(await hostTenantOf({ Host: "gone.test" })).toBeNull();
  });

  test("X-Tenant is not read", async () => {
    expect(await hostTenantOf({ Host: "other.test", "X-Tenant": TENANT_A })).toBeNull();
  });
});
