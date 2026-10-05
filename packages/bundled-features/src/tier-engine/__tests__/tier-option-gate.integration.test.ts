// withTierOptionGate over real HTTP: the entity create/update handlers of a probe entity are
// wrapped, the tier comes from the tier-engine assignment of the calling tenant.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  createEntity,
  createEntityExecutor,
  createSelectField,
  createTextField,
  defineEntityCreateHandler,
  defineEntityUpdateHandler,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-framework/testing";
import { capCounterEntity } from "../../cap-counter/entity.js";
import { capCounterFeature } from "../../cap-counter/feature.js";
import { withCapEnforcement } from "../../cap-counter/with-cap-enforcement.js";
import { createConfigFeature } from "../../config/index.js";
import { createConfigResolver } from "../../config/resolver.js";
import { configValuesTable } from "../../config/table.js";
import { createTenantFeature } from "../../tenant/feature.js";
import { tenantEntity } from "../../tenant/schema/tenant.js";
import { TierEngineHandlers } from "../constants.js";
import { tierAssignmentEntity } from "../entity.js";
import { tierEngineFeature } from "../feature.js";
import { createTierOptionGate } from "../tier-option-gate.js";
import { createTierResolver } from "../tier-resolver.js";

type Tier = "free" | "pro" | "enterprise";
type Caps = { readonly layouts: readonly string[] };

const TIER_ORDER: readonly Tier[] = ["free", "pro", "enterprise"];
const CAPS: Readonly<Record<Tier, Caps>> = {
  free: { layouts: ["basic"] },
  pro: { layouts: ["basic", "wide"] },
  enterprise: { layouts: ["basic", "wide", "custom"] },
};

function isTier(value: string): value is Tier {
  return value === "free" || value === "pro" || value === "enterprise";
}

const { resolveTier } = createTierResolver<Tier, Caps>({
  capsForTier: (tier) => CAPS[tier],
  isTierName: isTier,
  defaultTier: "free",
});

const { withTierOptionGate } = createTierOptionGate<Tier, Caps>({
  tierOrder: TIER_ORDER,
  capsForTier: (tier) => CAPS[tier],
  resolveTier,
});

const siteEntity = createEntity({
  table: "gated_sites",
  fields: {
    name: createTextField({ personal: false, reason: "test_fixture" }),
    layout: createSelectField({ options: ["basic", "wide", "custom"] }),
  },
});
const { table: siteTable } = createEntityExecutor("site", siteEntity);

const layoutSpec = {
  field: "layout",
  options: ["basic", "wide", "custom"],
  isOptionAllowed: (option: string, caps: Caps) => caps.layouts.includes(option),
  code: "layout_not_in_tier",
  i18nKey: "tier.layout-not-in-tier",
  table: siteTable,
} as const;

const access = { access: { roles: ["TenantAdmin"] } } as const;

const countedCreate = withCapEnforcement(
  {
    ...defineEntityCreateHandler("counted-site", siteEntity, access),
  },
  () => ({
    capName: "gated-site-creates",
    periodStartIso: "2026-07-01T00:00:00Z",
    limit: 2,
    profile: "hardSlot",
    notify: () => undefined,
  }),
);

const siteFeature = defineFeature("gated-site", (r) => {
  r.entity("site", siteEntity);
  r.writeHandler(
    withTierOptionGate(defineEntityCreateHandler("site", siteEntity, access), layoutSpec),
  );
  r.writeHandler(
    withTierOptionGate(defineEntityUpdateHandler("site", siteEntity, access), layoutSpec),
  );
  r.writeHandler(withTierOptionGate(countedCreate, layoutSpec));
});

const CREATE_QN = "gated-site:write:site:create";
const UPDATE_QN = "gated-site:write:site:update";
const COUNTED_CREATE_QN = "gated-site:write:counted-site:create";

let stack: TestStack;

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      tierEngineFeature,
      capCounterFeature,
      siteFeature,
    ],
    extraContext: {
      configResolver: createConfigResolver({ cipher: encryption }),
      configEncryption: encryption,
    },
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tierAssignmentEntity);
  await unsafeCreateEntityTable(stack.db, capCounterEntity);
  await unsafeCreateEntityTable(stack.db, siteEntity, "site");
  await unsafePushTables(stack.db, { configValuesTable });
});

afterAll(async () => {
  await stack.cleanup();
});

function adminFor(tenantNumber: number) {
  return createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin", "SystemAdmin"],
  });
}

async function setTier(tenantNumber: number, tier: Tier): Promise<void> {
  await stack.http.writeOk(
    TierEngineHandlers.setTenantTier,
    { tenantId: testTenantId(tenantNumber), tier },
    adminFor(tenantNumber),
  );
}

describe("withTierOptionGate over HTTP", () => {
  test("create with an option the tier does not allow is rejected and names the required tier", async () => {
    const error = await stack.http.writeErr(
      CREATE_QN,
      { name: "a", layout: "wide" },
      adminFor(5101),
    );
    expect(error.httpStatus).toBe(422);
    expect(error.i18nKey).toBe("tier.layout-not-in-tier");
    expect(error.details).toMatchObject({
      reason: "layout_not_in_tier",
      field: "layout",
      value: "wide",
      requiredTier: "pro",
    });
  });

  test("create with an allowed option or without the field passes", async () => {
    const admin = adminFor(5102);
    await stack.http.writeOk(CREATE_QN, { name: "a", layout: "basic" }, admin);
    await stack.http.writeOk(CREATE_QN, { name: "b" }, admin);
  });

  test("a higher tier unlocks its options", async () => {
    await setTier(5103, "pro");
    await stack.http.writeOk(CREATE_QN, { name: "a", layout: "wide" }, adminFor(5103));
  });

  test("after a downgrade the unchanged stored value passes on update, a changed one must be allowed", async () => {
    const admin = adminFor(5104);
    await setTier(5104, "pro");
    const created = await stack.http.writeOk<{ id: string }>(
      CREATE_QN,
      { name: "a", layout: "wide" },
      admin,
    );
    await setTier(5104, "free");

    await stack.http.writeOk(
      UPDATE_QN,
      { id: created.id, version: 1, changes: { name: "renamed", layout: "wide" } },
      admin,
    );

    const error = await stack.http.writeErr(
      UPDATE_QN,
      { id: created.id, version: 2, changes: { layout: "custom" } },
      admin,
    );
    expect(error.details).toMatchObject({
      reason: "layout_not_in_tier",
      value: "custom",
      requiredTier: "enterprise",
    });

    await stack.http.writeOk(
      UPDATE_QN,
      { id: created.id, version: 2, changes: { layout: "basic" } },
      admin,
    );
  });

  test("composed with withCapEnforcement both rules apply", async () => {
    const admin = adminFor(5105);
    const rejected = await stack.http.writeErr(
      COUNTED_CREATE_QN,
      { name: "a", layout: "wide" },
      admin,
    );
    expect(rejected.details).toMatchObject({ reason: "layout_not_in_tier" });

    await stack.http.writeOk(COUNTED_CREATE_QN, { name: "a", layout: "basic" }, admin);
    await stack.http.writeOk(COUNTED_CREATE_QN, { name: "b", layout: "basic" }, admin);
    const capped = await stack.http.writeErr(
      COUNTED_CREATE_QN,
      { name: "c", layout: "basic" },
      admin,
    );
    expect(capped.code).toBe("cap_exceeded");
  });
});
