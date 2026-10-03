import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import {
  access,
  createSystemUser,
  createTenantConfig,
  defineFeature,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import * as z from "zod";
import { billingFoundationFeature } from "../../billing-foundation/index.js";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/index.js";
import { ConfigHandlers } from "../../config/constants.js";
import { createConfigAccessorFactory, createConfigFeature } from "../../config/feature.js";
import { createConfigResolver } from "../../config/resolver.js";
import { configValuesTable } from "../../config/table.js";
import { createTenantFeature } from "../../tenant/feature.js";
import { tenantEntity } from "../../tenant/schema/tenant.js";
import { seedTenant } from "../../tenant/seeding.js";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.js";
import {
  TierEngineHandlers,
  tierAssignmentEntity,
  tierEngineFeature,
} from "../../tier-engine/index.js";
import { CapOverviewQueries } from "../constants.js";
import { createCapOverviewFeature } from "../feature.js";
import type { CapSpec } from "../types.js";

const SEATS_KEY = "cap-seats-probe:config:seats";
const SEATS_DEFAULT = 10;
const TENANT_A = testTenantId(9301);
const TENANT_B = testTenantId(9302);
const TENANT_C = testTenantId(9303);
const READ_FOR_QUERY = "cap-seats-probe:query:read-for";

const seatsFeature = defineFeature("cap-seats-probe", (r) => {
  r.requires("config");
  r.config({
    keys: {
      seats: createTenantConfig("number", {
        default: SEATS_DEFAULT,
        write: access.systemAdmin,
        read: access.systemAdmin,
      }),
    },
  });
  r.queryHandler(
    "read-for",
    z.object({ tenantId: z.string() }),
    async (query, ctx) => {
      const configFor = ctx.configFor;
      if (!configFor) throw new Error("ctx.configFor missing");
      return { value: await configFor(query.payload.tenantId as TenantId)(SEATS_KEY) }; // @cast-boundary test payload
    },
    { access: { openToAll: { reason: "probe exercises the configFor gate itself" } } },
  );
});

const seatsCap: CapSpec = {
  id: "seats",
  label: "test.cap.seats",
  limit: async (_tier, { config }) => {
    const value = await config?.(SEATS_KEY);
    return typeof value === "number" ? value : null;
  },
  usage: async () => 4,
};

let stack: TestStack;

const adminA = createTestUser({
  id: 93011,
  tenantId: TENANT_A,
  roles: ["TenantAdmin", "SystemAdmin"],
});
const adminB = createTestUser({
  id: 93021,
  tenantId: TENANT_B,
  roles: ["TenantAdmin", "SystemAdmin"],
});

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      seatsFeature,
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      billingFoundationFeature,
      tierEngineFeature,
      createCapOverviewFeature({ caps: [seatsCap] }),
    ],
    extraContext: ({ registry }) => {
      const resolver = createConfigResolver();
      return {
        configResolver: resolver,
        _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
      };
    },
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tierAssignmentEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafePushTables(stack.db, { configValuesTable });
  configurePiiSubjectKms(new InMemoryKmsAdapter());

  for (const id of [TENANT_A, TENANT_B, TENANT_C]) {
    await seedTenant(stack.db, { id, key: `cap-seats-${id}`, name: `Seats ${id}` });
  }
  const adminC = createTestUser({ id: 93031, tenantId: TENANT_C, roles: ["SystemAdmin"] });
  for (const admin of [adminA, adminB, adminC]) {
    await stack.http.writeOk(TierEngineHandlers.create, { tier: "pro" }, admin);
  }
  // A and B carry different values; C keeps the default.
  await stack.http.writeOk(
    ConfigHandlers.set,
    { key: SEATS_KEY, value: 111, scope: "tenant" },
    adminA,
  );
  await stack.http.writeOk(
    ConfigHandlers.set,
    { key: SEATS_KEY, value: 222, scope: "tenant" },
    adminB,
  );
});

afterAll(async () => {
  await stack.cleanup();
});

type CapsUsageResult = { readonly rows: readonly { id: string; limit: number | null }[] };
type TenantCapsListResult = {
  readonly rows: readonly (Record<string, unknown> & { tenantId: string })[];
};

describe("cross-tenant cap limits read the target tenant's config", () => {
  test("caps:usage with tenantId override shows the target tenant's limit", async () => {
    const result = await stack.http.queryOk<CapsUsageResult>(
      CapOverviewQueries.capsUsage,
      { tenantId: TENANT_B },
      adminA,
    );
    expect(result.rows.find((row) => row.id === "seats")?.limit).toBe(222);
  });

  test("caps:usage for a target without a value shows the default, not the caller's value", async () => {
    const result = await stack.http.queryOk<CapsUsageResult>(
      CapOverviewQueries.capsUsage,
      { tenantId: TENANT_C },
      adminA,
    );
    expect(result.rows.find((row) => row.id === "seats")?.limit).toBe(SEATS_DEFAULT);
  });

  test("caps:usage without override still uses the caller's own tenant", async () => {
    const result = await stack.http.queryOk<CapsUsageResult>(
      CapOverviewQueries.capsUsage,
      {},
      adminA,
    );
    expect(result.rows.find((row) => row.id === "seats")?.limit).toBe(111);
  });

  test("tenant-caps:list shows each tenant's own limit", async () => {
    const list = await stack.http.queryOk<TenantCapsListResult>(
      CapOverviewQueries.tenantCapsList,
      { limit: 50 },
      adminA,
    );
    const limitOf = (tenantId: string): unknown => {
      const row = list.rows.find((candidate) => candidate.tenantId === tenantId);
      return Object.values(row ?? {}).find(
        (value): value is { limit: number } => typeof value === "object" && value !== null,
      )?.limit;
    };
    expect(limitOf(TENANT_A)).toBe(111);
    expect(limitOf(TENANT_B)).toBe(222);
    expect(limitOf(TENANT_C)).toBe(SEATS_DEFAULT);
  });
});

describe("ctx.configFor gate", () => {
  test("a regular tenant member cannot read another tenant's config", async () => {
    const member = createTestUser({ id: 93012, tenantId: TENANT_A, roles: ["TenantAdmin"] });
    const error = await stack.http.queryErr(READ_FOR_QUERY, { tenantId: TENANT_B }, member);
    expect(error.httpStatus).toBe(403);
  });

  test("a regular tenant member may use configFor for its own tenant", async () => {
    const member = createTestUser({ id: 93013, tenantId: TENANT_A, roles: ["TenantAdmin"] });
    const result = await stack.http.queryOk<{ value: unknown }>(
      READ_FOR_QUERY,
      { tenantId: TENANT_A },
      member,
    );
    expect(result.value).toBe(111);
  });

  test("SystemAdmin and the system identity read another tenant's config", async () => {
    const viaAdmin = await stack.http.queryOk<{ value: unknown }>(
      READ_FOR_QUERY,
      { tenantId: TENANT_B },
      adminA,
    );
    expect(viaAdmin.value).toBe(222);
    const viaSystem = await stack.http.queryOk<{ value: unknown }>(
      READ_FOR_QUERY,
      { tenantId: TENANT_B },
      createSystemUser(TENANT_A),
    );
    expect(viaSystem.value).toBe(222);
  });
});
