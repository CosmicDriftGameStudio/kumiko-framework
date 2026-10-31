import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import { platformActor, requestExecutor } from "../lib.ts";
import { CONTACT_STATUS } from "../web/constants.ts";

// Open means no answer yet; an answered request counts as handled even before it is marked done.
export async function countOpenRequests(db: TenantDb): Promise<number> {
  const found = await requestExecutor.list(
    {
      filter: { field: "status", op: "eq", value: CONTACT_STATUS.Open },
      limit: 1,
      totalCount: true,
    },
    platformActor(),
    db,
  );
  return found.total ?? 0;
}
