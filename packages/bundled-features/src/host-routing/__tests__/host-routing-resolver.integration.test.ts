import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { fetchOne, table as pgTable, text, uuid } from "@cosmicdrift/kumiko-framework/db";
import {
  createAnonymousUser,
  defineFeature,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { seedRow } from "@cosmicdrift/kumiko-testing/helpers";
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
} from "../../auth-foundation/index.ts";
import { configValuesTable, createConfigFeature } from "../../config/index.ts";
import {
  createTenantFeature,
  TenantHandlers,
  tenantEntity,
  tenantMembershipsTable,
} from "../../tenant/index.ts";
import { seedTenant } from "../../tenant/seeding.ts";
import { createUserFeature, userEntity } from "../../user/index.ts";
import { createHostDispatch } from "../dispatch.ts";
import { createHostRoutingFeature } from "../feature.ts";
import type { HostRoutingOptions, HostTenantResolver } from "../options.ts";
import { createHostTenantIdResolver } from "../tenant-lookup.ts";

const BASE_DOMAIN = "resolver-routing.test";
const WHOAMI = "hostprobe:query:whoami";
const ALLOWED_QUERY = "hostprobe:query:allowed";

const ACME = { id: "00000000-0000-4000-8000-0000000000b1" as TenantId, key: "acme", name: "Acme" };
const GLOBEX = {
  id: "00000000-0000-4000-8000-0000000000b2" as TenantId,
  key: "globex",
  name: "Globex",
};
const DISABLED = {
  id: "00000000-0000-4000-8000-0000000000b3" as TenantId,
  key: "umbrella",
  name: "Umbrella",
};

const tenantProfileTable = pgTable("tenant_profile_fixture", {
  tenantId: uuid("tenant_id").primaryKey(),
  subdomain: text("subdomain"),
  customDomain: text("custom_domain"),
});

type ProfileRow = { readonly tenantId: TenantId };

// Subdomain label and custom domain live in the app's profile table, not in tenant.key.
const resolveFromProfile: HostTenantResolver = async (host, db) => {
  const suffix = `.${BASE_DOMAIN}`;
  const where = host.endsWith(suffix)
    ? { subdomain: host.slice(0, -suffix.length) }
    : { customDomain: host };
  const row = await fetchOne<ProfileRow>(db, tenantProfileTable, where);
  return row?.tenantId ?? null;
};

const options: HostRoutingOptions = {
  tenantBy: resolveFromProfile,
  tenantPathPrefix: "/a",
  baseDomain: BASE_DOMAIN,
  apex: { file: "index.html" },
  tenant: { file: "tenant.html" },
  unknownTenant: { file: "unknown-tenant.html" },
  apexAnonymousTenantId: SYSTEM_TENANT_ID,
  apexAnonymousQueryAllowlist: { [BASE_DOMAIN]: [ALLOWED_QUERY] },
  redirects: [{ from: "/legacy", to: "/a", host: BASE_DOMAIN }],
};

const probeFeature = defineFeature("hostprobe", (r) => {
  r.queryHandler({
    name: "whoami",
    schema: z.object({}),
    access: { roles: ["anonymous"] },
    handler: async (query) => ({ tenantId: query.user.tenantId }),
  });
  r.queryHandler({
    name: "allowed",
    schema: z.object({}),
    access: { roles: ["anonymous"] },
    handler: async (query) => ({ tenantId: query.user.tenantId }),
  });
});

let stack: TestStack;

const systemQuery = (type: string, payload: unknown, tenantId: TenantId) =>
  stack.dispatcher.query(type, payload, createAnonymousUser(tenantId));

function call(type: string, host: string, headers: Record<string, string> = {}) {
  return stack.http.raw("POST", "/api/query", { type, payload: {} }, { Host: host, ...headers });
}

async function errorCode(res: Response): Promise<string> {
  const body = (await res.json()) as { error: { code: string } };
  return body.error.code;
}

async function tenantIdOf(res: Response): Promise<string> {
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: { tenantId: string } };
  return body.data.tenantId;
}

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
  await unsafePushTables(stack.db, {
    configValuesTable,
    tenantMembershipsTable,
    tenantProfileTable,
  });
  for (const tenant of [ACME, GLOBEX, DISABLED]) await seedTenant(stack.db, tenant);
  await stack.http.writeOk(TenantHandlers.disable, { id: DISABLED.id }, TestUsers.systemAdmin);
  await seedRow(stack.db, tenantProfileTable, { tenantId: ACME.id, subdomain: "shop" });
  await seedRow(stack.db, tenantProfileTable, {
    tenantId: GLOBEX.id,
    customDomain: "status.globex.example",
  });
  await seedRow(stack.db, tenantProfileTable, { tenantId: DISABLED.id, subdomain: "old" });
});

afterAll(async () => stack?.cleanup());

describe("host-routing with a tenantBy resolver", () => {
  test("API: subdomain and custom domain from the profile table resolve to their tenant", async () => {
    expect(await tenantIdOf(await call(WHOAMI, `shop.${BASE_DOMAIN}`))).toBe(ACME.id);
    expect(await tenantIdOf(await call(WHOAMI, "status.globex.example"))).toBe(GLOBEX.id);
  });

  test("API: the resolver result wins over X-Tenant", async () => {
    const res = await call(WHOAMI, `shop.${BASE_DOMAIN}`, { "X-Tenant": GLOBEX.id });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("tenant_mismatch");
  });

  test.each([
    ["unknown subdomain", `nope.${BASE_DOMAIN}`],
    ["disabled tenant", `old.${BASE_DOMAIN}`],
    ["unknown foreign host", "evil.test"],
  ])("API: %s has no tenant, even with X-Tenant", async (_label, host) => {
    const res = await call(WHOAMI, host, { "X-Tenant": ACME.id });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("tenant_required");
  });

  test("dispatch: known hosts get the tenant shell, unknown ones 404", async () => {
    const dispatch = createHostDispatch(options);
    const at = (host: string) => dispatch({ host, path: "/", search: "" }, { systemQuery });
    expect(await at(`shop.${BASE_DOMAIN}`)).toEqual({ kind: "html", file: "tenant.html" });
    expect(await at("status.globex.example")).toEqual({ kind: "html", file: "tenant.html" });
    expect(await at(`old.${BASE_DOMAIN}`)).toEqual({
      kind: "not-found",
      file: "unknown-tenant.html",
    });
    expect(await at("evil.test")).toEqual({ kind: "not-found" });
  });

  test("dispatch: the apex serves path tenants next to host tenants in one app", async () => {
    const dispatch = createHostDispatch(options);
    const at = (host: string, path: string) =>
      dispatch({ host, path, search: "" }, { systemQuery });
    expect(await at(BASE_DOMAIN, `/a/${ACME.key}/dashboard`)).toEqual({
      kind: "html",
      file: "tenant.html",
    });
    expect(await at(BASE_DOMAIN, "/a/ghost")).toEqual({
      kind: "not-found",
      file: "unknown-tenant.html",
    });
    expect(await at(BASE_DOMAIN, "/pricing")).toEqual({ kind: "html", file: "index.html" });
  });

  test("dispatch: a configured redirect answers 301 to its fixed target", async () => {
    const dispatch = createHostDispatch(options);
    expect(
      await dispatch({ host: BASE_DOMAIN, path: "/legacy/acme", search: "?x=1" }, { systemQuery }),
    ).toEqual({ kind: "redirect", to: "/a/acme?x=1", status: 301 });
  });

  test("apex allowlist: only listed query types get the anchor tenant", async () => {
    expect(await tenantIdOf(await call(ALLOWED_QUERY, BASE_DOMAIN))).toBe(SYSTEM_TENANT_ID);
    const res = await call(WHOAMI, BASE_DOMAIN);
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("tenant_required");
  });

  test("apex allowlist: an unlisted type over /api/stream gets no anchor either", async () => {
    const res = await stack.http.raw(
      "POST",
      "/api/stream",
      { type: WHOAMI, payload: {} },
      { Host: BASE_DOMAIN },
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("tenant_required");
  });

  test.each([
    ["percent-encoded /api/query", "/api/%71uery"],
    ["percent-encoded /api/stream", "/api/%73tream"],
    ["trailing slash", "/api/query/"],
  ])("apex allowlist: %s cannot bypass it", async (_label, path) => {
    const res = await stack.http.raw(
      "POST",
      path,
      { type: WHOAMI, payload: {} },
      { Host: BASE_DOMAIN },
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("tenant_required");
  });

  test("apex allowlist: www shares the apex entry instead of keeping the anchor", async () => {
    const www = `www.${BASE_DOMAIN}`;
    expect(await tenantIdOf(await call(ALLOWED_QUERY, www))).toBe(SYSTEM_TENANT_ID);
    const res = await call(WHOAMI, www);
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("tenant_required");
  });

  test("createHostTenantIdResolver maps hosts for managed-pages", async () => {
    const resolveHost = createHostTenantIdResolver(options, stack.db);
    expect(await resolveHost(`shop.${BASE_DOMAIN}`)).toBe(ACME.id);
    expect(await resolveHost("status.globex.example")).toBe(GLOBEX.id);
    expect(await resolveHost(BASE_DOMAIN)).toBe(SYSTEM_TENANT_ID);
    expect(await resolveHost(`old.${BASE_DOMAIN}`)).toBeNull();
    expect(await resolveHost("a@b")).toBeNull();
  });
});
