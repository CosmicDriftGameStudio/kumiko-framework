// Generic tier-resolver factory. Extracted from the near-identical
// tier-resolver.ts app copies in show-pony and publicstatus — the only
// per-app variables were the TierName union and its caps/defaults, so
// both are now factory parameters. With `trial` the same trial policy as the
// tier-engine gate applies, for caps and display.

import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import type { CapLimitContext } from "../cap-counter/index.ts";
import { tenantTable } from "../tenant/index.ts";
import { tierAssignmentTable } from "./table.ts";
import { isTrialActive, type TrialPolicy } from "./trial.ts";

export type TierResolverTrial<TTier extends string> = TrialPolicy & {
  readonly tier: TTier;
  // Ascending; the trial lifts a tenant only to a tier above its stored one.
  readonly tierOrder: readonly TTier[];
};

export type TierResolverDeps<TTier extends string, TCaps> = {
  readonly capsForTier: (tier: TTier, context: CapLimitContext) => TCaps | Promise<TCaps>;
  readonly isTierName: (value: string) => value is TTier;
  readonly defaultTier: TTier;
  readonly trial?: TierResolverTrial<TTier>;
};

export type TierState<TTier extends string> = {
  readonly storedTier: TTier;
  readonly tier: TTier;
  /** End of the trial window while the trial lifts the tier, else null. */
  readonly trialEndsAtEpochMs: number | null;
};

const MS_PER_HOUR = 3_600_000;

export function createTierResolver<TTier extends string, TCaps>(
  deps: TierResolverDeps<TTier, TCaps>,
) {
  const { trial } = deps;
  if (trial !== undefined && !trial.tierOrder.includes(trial.tier)) {
    throw new Error(`createTierResolver: trial.tier "${trial.tier}" is not in trial.tierOrder`);
  }

  async function resolveStoredTier(db: TenantDb): Promise<TTier> {
    const row = await db.fetchOne<{ tier?: unknown }>(tierAssignmentTable, {
      tenantId: db.tenantId,
    });
    const tier = row?.tier;
    return typeof tier === "string" && deps.isTierName(tier) ? tier : deps.defaultTier;
  }

  async function resolveTierState(db: TenantDb): Promise<TierState<TTier>> {
    const storedTier = await resolveStoredTier(db);
    const unlifted: TierState<TTier> = { storedTier, tier: storedTier, trialEndsAtEpochMs: null };
    if (trial === undefined) return unlifted;
    const storedRank = trial.tierOrder.indexOf(storedTier);
    // A tier outside tierOrder has no known rank; lifting it could be a downgrade.
    if (storedRank === -1 || storedRank >= trial.tierOrder.indexOf(trial.tier)) return unlifted;
    const row = await db.fetchOne<{ insertedAt?: Temporal.Instant }>(tenantTable, {
      id: db.tenantId,
    });
    const startedMs = row?.insertedAt?.epochMilliseconds;
    if (
      startedMs === undefined ||
      !isTrialActive(startedMs, getTemporal().Now.instant().epochMilliseconds, trial.durationHours)
    ) {
      return unlifted;
    }
    return {
      storedTier,
      tier: trial.tier,
      trialEndsAtEpochMs: startedMs + trial.durationHours * MS_PER_HOUR,
    };
  }

  async function resolveTier(db: TenantDb): Promise<TTier> {
    return (await resolveTierState(db)).tier;
  }

  async function resolveTierCaps(db: TenantDb, context: CapLimitContext = {}): Promise<TCaps> {
    return deps.capsForTier(await resolveTier(db), context);
  }

  return { tierAssignmentTable, resolveTier, resolveTierState, resolveTierCaps };
}

export type TierResolver<TTier extends string, TCaps> = ReturnType<
  typeof createTierResolver<TTier, TCaps>
>;
