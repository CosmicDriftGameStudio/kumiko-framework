// showLimit:false hides the limit from caps:usage while cap-counter still
// enforces it; proven over real HTTP with a real reservation, not a mocked count.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import { defineFeature, type WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createBillingFoundationFeature } from "../../billing-foundation/index.ts";
import { capCounterEntity } from "../../cap-counter/entity.ts";
import { createCapCounterFeature } from "../../cap-counter/feature.ts";
import { withCapEnforcement } from "../../cap-counter/with-cap-enforcement.ts";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/index.ts";
import { createConfigAccessorFactory, createConfigFeature } from "../../config/feature.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { seedTenant } from "../../tenant/seeding.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import {
  createTierEngineFeature,
  TierEngineHandlers,
  tierAssignmentEntity,
} from "../../tier-engine/index.ts";
import { createCapOverviewFeature } from "../feature.ts";
import type { CapSpec } from "../types.ts";
import { CapOverviewQueries } from "../web/constants.ts";

// Distinctive on purpose: the test asserts this number never appears in the response.
const HIDDEN_LIMIT = 7;
const VISIBLE_LIMIT = 9;
const PERIOD = "2026-09-01T00:00:00Z";
const TENANT = testTenantId(9301);

let hiddenRuns = 0;

const hiddenHandler: WriteHandlerDef = {
  name: "use-hidden",
  schema: z.object({}),
  access: { roles: ["TenantAdmin"] },
  handler: async () => {
    hiddenRuns += 1;
    return { isSuccess: true as const, data: {} };
  },
};

const hiddenEnforced = withCapEnforcement(hiddenHandler, () => ({
  capName: "hidden-limit",
  periodStartIso: PERIOD,
  limit: HIDDEN_LIMIT,
  profile: "hardSlot",
  notify: () => {},
}));
const USE_HIDDEN_QN = "show-limit-probe:write:use-hidden";

const probeFeature = defineFeature("show-limit-probe", (r) => {
  r.writeHandler(hiddenEnforced);
});

const hiddenCap: CapSpec = {
  id: "hidden-limit",
  label: "test.cap.hidden",
  showLimit: false,
  limit: () => HIDDEN_LIMIT,
  usage: async () => hiddenRuns,
};
const visibleCap: CapSpec = {
  id: "visible-limit",
  label: "test.cap.visible",
  limit: () => VISIBLE_LIMIT,
  usage: async () => 2,
};

type CapsUsageRow = {
  readonly id: string;
  readonly used: number | null;
  readonly limit: number | null;
  readonly percent: number | null;
  readonly tone: string;
};

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createCapCounterFeature(),
      probeFeature,
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createBillingFoundationFeature(),
      createTierEngineFeature(),
      createCapOverviewFeature({ caps: [hiddenCap, visibleCap] }),
    ],
    extraContext: ({ registry }) => {
      const resolver = createConfigResolver();
      return {
        configResolver: resolver,
        configAccessorFactory: createConfigAccessorFactory(registry, resolver),
      };
    },
  });
  await unsafePushTables(stack.db, { configValuesTable });
  await unsafeCreateEntityTable(stack.db, capCounterEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tierAssignmentEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  configurePiiSubjectKms(new InMemoryKmsAdapter());

  await seedTenant(stack.db, { id: TENANT, key: `cap-show-limit-${TENANT}`, name: "Show limit" });
  const owner = createTestUser({
    id: 93011,
    tenantId: TENANT,
    roles: ["TenantAdmin", "SystemAdmin"],
  });
  await stack.http.writeOk(TierEngineHandlers.create, { tier: "public" }, owner);
});

afterAll(async () => {
  await stack.cleanup();
  resetPiiSubjectKmsForTests();
});

describe("CapSpec.showLimit", () => {
  const admin = createTestUser({ id: 93012, tenantId: TENANT, roles: ["TenantAdmin"] });

  test("hides the limit but still enforces it", async () => {
    for (let i = 0; i < HIDDEN_LIMIT; i++) {
      await stack.http.writeOk(USE_HIDDEN_QN, {}, admin);
    }
    expect(hiddenRuns).toBe(HIDDEN_LIMIT);

    const error = await stack.http.writeErr(USE_HIDDEN_QN, {}, admin);
    expect(error.code).toBe("cap_exceeded");
    expect(hiddenRuns).toBe(HIDDEN_LIMIT);

    const usage = await stack.http.queryOk<{ rows: readonly CapsUsageRow[] }>(
      CapOverviewQueries.capsUsage,
      {},
      admin,
    );
    const hidden = usage.rows.find((row) => row.id === "hidden-limit");
    expect(hidden).toMatchObject({
      used: HIDDEN_LIMIT,
      limit: null,
      percent: null,
      tone: "default",
    });
    expect(JSON.stringify(hidden)).not.toMatch(new RegExp(`"limit":${HIDDEN_LIMIT}\\b`));
  });

  test("a cap without showLimit still reports its limit", async () => {
    const usage = await stack.http.queryOk<{ rows: readonly CapsUsageRow[] }>(
      CapOverviewQueries.capsUsage,
      {},
      admin,
    );
    expect(usage.rows.find((row) => row.id === "visible-limit")).toMatchObject({
      used: 2,
      limit: VISIBLE_LIMIT,
    });
  });
});
