// Generic tier-resolver factory. Extracted from the near-identical
// tier-resolver.ts app copies in show-pony and publicstatus (infra#446) — the
// only per-app variables were the TierName union and its caps/defaults, so
// both are now factory parameters.

import { buildEntityTable, type TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { CapLimitContext } from "../cap-counter";
import { tierAssignmentEntity } from "./entity";

export type TierResolverDeps<TTier extends string, TCaps> = {
  readonly capsForTier: (tier: TTier, context: CapLimitContext) => TCaps | Promise<TCaps>;
  readonly isTierName: (value: string) => value is TTier;
  readonly defaultTier: TTier;
};

export function createTierResolver<TTier extends string, TCaps>(
  deps: TierResolverDeps<TTier, TCaps>,
) {
  const tierAssignmentTable = buildEntityTable("tier-assignment", tierAssignmentEntity);

  async function resolveTier(db: TenantDb): Promise<TTier> {
    const row = await db.fetchOne<{ tier?: unknown }>(tierAssignmentTable, {
      tenantId: db.tenantId,
    });
    const tier = row?.tier;
    return typeof tier === "string" && deps.isTierName(tier) ? tier : deps.defaultTier;
  }

  async function resolveTierCaps(db: TenantDb, context: CapLimitContext = {}): Promise<TCaps> {
    return deps.capsForTier(await resolveTier(db), context);
  }

  return { tierAssignmentTable, resolveTier, resolveTierCaps };
}

export type TierResolver<TTier extends string, TCaps> = ReturnType<
  typeof createTierResolver<TTier, TCaps>
>;
