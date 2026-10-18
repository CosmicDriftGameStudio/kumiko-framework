import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createAnonymousUser,
  defineFeature,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import {
  createAuthFoundationFeature,
  resolveAnonymousAccessFromRegistry,
} from "../../auth-foundation/index.js";
import { configValuesTable, createConfigFeature } from "../../config/index.js";
import {
  createTenantFeature,
  TenantHandlers,
  tenantEntity,
  tenantMembershipsTable,
} from "../../tenant/index.js";
import { seedTenant } from "../../tenant/seeding.js";
import { createUserFeature, userEntity } from "../../user/index.js";
import { createHostDispatch } from "../dispatch.js";
import { createHostRoutingFeature } from "../feature.js";
import type { HostRoutingOptions } from "../options.js";

const BASE_DOMAIN = "host-routing.test";

const options: HostRoutingOptions = {
  tenantBy: "host",
  baseDomain: BASE_DOMAIN,
  apex: { file: "index.html" },
  tenant: { file: "tenant.html" },
  unknownTenant: { file: "unknown-tenant.html" },
  locales: { default: "de", prefixed: ["en"] },
};

const TENANTS = [
  { id: "00000000-0000-4000-8000-0000000000a1" as TenantId, key: "acme", name: "Acme" },
  { id: "00000000-0000-4000-8000-0000000000a2" as TenantId, key: "globex", name: "Globex" },
  { id: "00000000-0000-4000-8000-0000000000a3" as TenantId, key: "initech", name: "Initech" },
] as const;
const DISABLED = {
  id: "00000000-0000-4000-8000-0000000000a4" as TenantId,
  key: "umbrella",
  name: "Umbrella",
};

const WHOAMI = "hostprobe:query:whoami";

// Echoes the tenant the anonymous pipeline resolved for the request.
const probeFeature = defineFeature("hostprobe", (r) => {
  r.queryHandler({
    name: "whoami",
    schema: z.object({}),
    access: { roles: ["anonymous"] },
    handler: async (query) => ({ tenantId: query.user.tenantId }),
  });
});

let stack: TestStack;

function whoami(host: string, headers: Record<string, string> = {}) {
  return stack.http.raw(
    "POST",
    "/api/query",
    { type: WHOAMI, payload: {} },
    { Host: host, ...headers },
  );
}

async function errorCode(res: Response): Promise<string> {
  const body = (await res.json()) as { error: { code: string } };
  return body.error.code;
}

const systemQuery = (type: string, payload: unknown, tenantId: TenantId) =>
  stack.dispatcher.query(type, payload, createAnonymousUser(tenantId));

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createAuthFoundationFeature(),
      createHostRoutingFeature(options),
      probeFeature,
    ],
    anonymousAccess: {},
    enrichAnonymousAccess: (base, deps) => resolveAnonymousAccessFromRegistry(base, deps),
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
  for (const tenant of [...TENANTS, DISABLED]) await seedTenant(stack.db, tenant);
  await stack.http.writeOk(TenantHandlers.disable, { id: DISABLED.id }, TestUsers.systemAdmin);
});

afterAll(async () => stack?.cleanup());

async function setupApexStack(apexOptions: HostRoutingOptions): Promise<TestStack> {
  const apexStack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createAuthFoundationFeature(),
      createHostRoutingFeature(apexOptions),
      probeFeature,
    ],
    anonymousAccess: {},
    enrichAnonymousAccess: (base, deps) => resolveAnonymousAccessFromRegistry(base, deps),
  });
  await unsafeCreateEntityTable(apexStack.db, userEntity);
  await unsafeCreateEntityTable(apexStack.db, tenantEntity);
  await unsafePushTables(apexStack.db, { configValuesTable, tenantMembershipsTable });
  await seedTenant(apexStack.db, TENANTS[0]);
  return apexStack;
}

function whoamiOn(target: TestStack, host: string, headers: Record<string, string> = {}) {
  return target.http.raw(
    "POST",
    "/api/query",
    { type: WHOAMI, payload: {} },
    { Host: host, ...headers },
  );
}

async function tenantIdOf(res: Response): Promise<string> {
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: { tenantId: string } };
  return body.data.tenantId;
}

describe("host-routing apexAnonymousTenantId", () => {
  test("host mode: the apex answers as the configured tenant and rejects a foreign X-Tenant", async () => {
    const apexStack = await setupApexStack({ ...options, apexAnonymousTenantId: SYSTEM_TENANT_ID });
    try {
      expect(await tenantIdOf(await whoamiOn(apexStack, BASE_DOMAIN))).toBe(SYSTEM_TENANT_ID);
      const spoofed = await whoamiOn(apexStack, BASE_DOMAIN, { "X-Tenant": TENANTS[0].id });
      expect(spoofed.status).toBe(400);
      expect(await errorCode(spoofed)).toBe("tenant_mismatch");
      expect(await tenantIdOf(await whoamiOn(apexStack, `acme.${BASE_DOMAIN}`))).toBe(
        TENANTS[0].id,
      );
    } finally {
      await apexStack.cleanup();
    }
  });

  test("path mode: the apex default fills in only when the client names no tenant", async () => {
    const apexStack = await setupApexStack({
      tenantBy: "path",
      tenantPathPrefix: "/t",
      baseDomain: BASE_DOMAIN,
      apex: { file: "index.html" },
      tenant: { file: "tenant.html" },
      apexAnonymousTenantId: SYSTEM_TENANT_ID,
    });
    try {
      expect(await tenantIdOf(await whoamiOn(apexStack, BASE_DOMAIN))).toBe(SYSTEM_TENANT_ID);
      const named = await whoamiOn(apexStack, BASE_DOMAIN, { "X-Tenant": TENANTS[0].id });
      expect(await tenantIdOf(named)).toBe(TENANTS[0].id);
    } finally {
      await apexStack.cleanup();
    }
  });
});

describe("host-routing over HTTP", () => {
  test("three tenant hosts resolve to three tenants", async () => {
    for (const tenant of TENANTS) {
      const res = await whoami(`${tenant.key}.${BASE_DOMAIN}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { tenantId: string } };
      expect(body.data.tenantId).toBe(tenant.id);
    }
  });

  test("X-Tenant naming another real tenant is rejected, not obeyed", async () => {
    const res = await whoami(`acme.${BASE_DOMAIN}`, { "X-Tenant": TENANTS[1].id });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("tenant_mismatch");
  });

  test.each([
    ["unknown subdomain", `nope.${BASE_DOMAIN}`],
    ["disabled tenant", `${DISABLED.key}.${BASE_DOMAIN}`],
    ["apex", BASE_DOMAIN],
    ["foreign host", "evil.test"],
  ])("%s has no anonymous tenant, even with X-Tenant", async (_label, host) => {
    const res = await whoami(host, { "X-Tenant": TENANTS[0].id });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("tenant_required");
  });

  test("the page dispatch uses the real tenant-key query", async () => {
    const dispatch = createHostDispatch(options);
    for (const tenant of TENANTS) {
      expect(
        await dispatch(
          { host: `${tenant.key}.${BASE_DOMAIN}`, path: "/", search: "" },
          { systemQuery },
        ),
      ).toEqual({
        kind: "html",
        file: "tenant.html",
      });
    }
    for (const key of ["nope", DISABLED.key]) {
      expect(
        await dispatch({ host: `${key}.${BASE_DOMAIN}`, path: "/", search: "" }, { systemQuery }),
      ).toEqual({
        kind: "not-found",
        file: "unknown-tenant.html",
      });
    }
  });

  test("a default-locale path on the apex redirects to the unprefixed path", async () => {
    const dispatch = createHostDispatch(options);
    expect(
      await dispatch({ host: BASE_DOMAIN, path: "/de/pricing", search: "" }, { systemQuery }),
    ).toEqual({
      kind: "redirect",
      to: "/pricing",
      status: 301,
    });
  });
});
