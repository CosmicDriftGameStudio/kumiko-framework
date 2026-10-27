// One feature instance reused by a second stack (module-singleton features in app tests): a tier
// write that happened before build() must not leave a cache entry that hides the always-on set.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  findTierResolverUsage,
  requireTierResolverPlugin,
} from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import type { TierMap } from "../compose-app.ts";
import { tierAssignmentEntity } from "../entity.ts";
import { createTierEngineFeature } from "../feature.ts";
import { TierEngineHandlers } from "../web/constants.ts";

const TIER_MAP: TierMap<{ readonly maxItems: number }> = {
  free: { features: [], caps: { maxItems: 1 } },
  pro: { features: ["feat-pro"], caps: { maxItems: 5 } },
};

const tierEngine = createTierEngineFeature({ tierMap: TIER_MAP, defaultTier: "free" });

let writerStack: TestStack;
let builderStack: TestStack;

async function startStack(): Promise<TestStack> {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  const stack = await setupTestStack({
    features: [createConfigFeature(), createTenantFeature(), tierEngine],
    extraContext: {
      configResolver: createConfigResolver({ cipher: encryption }),
      configEncryption: encryption,
    },
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tierAssignmentEntity);
  await unsafePushTables(stack.db, { configValuesTable });
  return stack;
}

beforeAll(async () => {
  writerStack = await startStack();
  builderStack = await startStack();
});

afterAll(async () => {
  await writerStack.cleanup();
  await builderStack.cleanup();
});

describe("tier resolver build() after a tier write from another stack", () => {
  test("serves the always-on fallback instead of the stale pre-build entry", async () => {
    const tenantNumber = 6101;
    const tenantId = testTenantId(tenantNumber);
    await writerStack.http.writeOk(
      TierEngineHandlers.setTenantTier,
      { tenantId, tier: "pro" },
      createTestUser({ id: tenantNumber, tenantId, roles: ["SystemAdmin"] }),
    );

    const usage = findTierResolverUsage([tierEngine]);
    if (!usage) throw new Error("tier-engine did not register a tier resolver plugin");
    const resolver = await requireTierResolverPlugin(usage).build({
      db: builderStack.db,
      registry: builderStack.registry,
    });

    const features = resolver(tenantId);
    expect(features.has("tenant")).toBe(true);
    expect(features.has("feat-pro")).toBe(false);
  });
});
