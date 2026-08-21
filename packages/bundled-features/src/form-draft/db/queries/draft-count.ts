import { unsafeReadRetrying } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";

// COUNT(*), not selectMany(...).length — save.write.ts checks this on every
// create, and a draft's `values` blob can be up to FORM_DRAFT_VALUES_MAX_BYTES
// (64KB); loading up to FORM_DRAFT_MAX_PER_OWNER full rows just to count them
// would be several MB of wasted transfer per save.
export async function countDraftsByOwner(
  db: DbRunner,
  tenantId: TenantId,
  ownerId: string,
): Promise<number> {
  const rows = (await unsafeReadRetrying(
    db,
    `SELECT count(*)::int AS "count" FROM "read_form_drafts"
     WHERE "tenant_id" = $1 AND "owner_id" = $2`,
    [tenantId, ownerId],
  )) as readonly { count: number }[];
  return rows[0]?.count ?? 0;
}
