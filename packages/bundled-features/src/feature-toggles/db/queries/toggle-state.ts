import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import type { Temporal } from "temporal-polyfill";

export async function updateFeatureToggleOptimistic(
  db: DbRunner,
  params: {
    readonly enabled: boolean;
    readonly updatedBy: string;
    readonly updatedAt: Temporal.Instant;
    readonly featureName: string;
    readonly expectedVersion: number;
  },
): Promise<readonly unknown[]> {
  return asRawClient(db).unsafe(
    'UPDATE "read_global_feature_state" SET enabled = $1, version = version + 1, updated_by = $2, updated_at = $3 WHERE feature_name = $4 AND version = $5 RETURNING *',
    [
      params.enabled,
      params.updatedBy,
      params.updatedAt,
      params.featureName,
      params.expectedVersion,
    ],
  );
}
