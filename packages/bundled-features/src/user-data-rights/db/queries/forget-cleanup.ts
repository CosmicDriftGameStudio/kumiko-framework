import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
// Value-only import, aliased to avoid shadowing the ambient global
// `Temporal` TYPE that gracePeriodEndCutoff's parameter type resolves
// against (same #1438 dual-package-hazard pattern as event-store.ts).
import { Temporal as TemporalPolyfill } from "temporal-polyfill";
import { userTable } from "../../../user";

export async function selectUsersDueForForgetCleanup(
  db: DbConnection,
  status: string,
  gracePeriodEndCutoff: InstanceType<typeof TemporalPolyfill.Instant> | string,
): Promise<readonly { id: string }[]> {
  // @cast-boundary temporal-polyfill-vs-ambient: same TC39 Temporal.Instant
  // at runtime, distinct nominal types across the two .d.ts sources (see
  // event-store.ts). Only ever consumed via the `lte` comparison below.
  const cutoff =
    typeof gracePeriodEndCutoff === "string"
      ? TemporalPolyfill.Instant.from(gracePeriodEndCutoff)
      : gracePeriodEndCutoff;
  return selectMany<{ id: string }>(db, userTable, {
    status,
    gracePeriodEnd: { lte: cutoff },
  });
}
