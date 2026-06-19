import { describe, expect, test } from "bun:test";
import { tierAssignmentAggregateId } from "../aggregate-id";
import { TIER_ENGINE_FEATURE, TierEngineHandlers, TierEngineQueries } from "../constants";
import { tierEngineFeature } from "../feature";

// Drift-Pin-Tests — diese Werte sind Cross-File-Contracts, ein Wechsel
// muss bewusst geschehen und die anderen Stellen mitziehen. Wenn diese
// Tests rot werden: stop, denk nach, sync alle Stellen.

describe("tier-engine drift pins", () => {
  test("TIER_ENGINE_FEATURE matches the registered feature-name", () => {
    expect(tierEngineFeature.name).toBe(TIER_ENGINE_FEATURE);
    expect(tierEngineFeature.name).toBe("tier-engine");
  });

  test("Handler-QNs follow the scope:type:name convention with feature-prefix", () => {
    expect(TierEngineHandlers.create).toBe("tier-engine:write:tier-assignment:create");
    expect(TierEngineHandlers.update).toBe("tier-engine:write:tier-assignment:update");
    expect(TierEngineQueries.list).toBe("tier-engine:query:tier-assignment:list");
    expect(TierEngineQueries.getActiveTier).toBe("tier-engine:query:get-active-tier");
    // Screen↔Handler-Contract: der TierAdminScreen dispatcht exakt diese QNs.
    expect(TierEngineHandlers.setTenantTier).toBe("tier-engine:write:set-tenant-tier");
    expect(TierEngineQueries.getTenantTier).toBe("tier-engine:query:get-tenant-tier");
    expect(TierEngineQueries.tierOptions).toBe("tier-engine:query:tier-options");

    // Every QN must start with the feature-name as scope.
    for (const qn of [...Object.values(TierEngineHandlers), ...Object.values(TierEngineQueries)]) {
      expect(qn.startsWith(`${TIER_ENGINE_FEATURE}:`)).toBe(true);
    }
  });

  test("tier-assignment aggregate-id namespace is stable across boots", () => {
    // The namespace UUID is in stone — changing it re-keys every existing
    // aggregate-stream and breaks event-replay + projection-rebuild +
    // audit-trail. If this test fails: revert the namespace, do not adjust
    // the test.
    const id1 = tierAssignmentAggregateId("00000000-0000-4000-8000-000000000001");
    const id2 = tierAssignmentAggregateId("00000000-0000-4000-8000-000000000001");
    const id3 = tierAssignmentAggregateId("00000000-0000-4000-8000-000000000002");

    expect(id1).toBe(id2); // same input → same output (deterministic)
    expect(id1).not.toBe(id3); // different input → different output
    // Pin the actual value — drift-detector for the namespace constant.
    expect(id1).toBe("4d7b6b9b-5257-56f7-b668-5d0b92dbd4dc");
  });
});
