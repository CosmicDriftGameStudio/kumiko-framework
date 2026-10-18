import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { decryptStoredPii, mapWithConcurrency } from "../shared/index.ts";
import { userTable } from "./schema/user.ts";

// Shares the KMS adapter's small dedicated pool, same as member-directory.
const KMS_POOL_CONCURRENCY = 4;

// One batched lookup for a page of user ids. Users that are missing or have no
// display name are left out, so callers fall back to the raw id. Decrypt errors
// propagate (a misconfigured or unavailable KMS fails loudly, like member-directory);
// crypto-shredding is handled by the KMS layer.
export async function resolveUserDisplayNames(
  db: TenantDb,
  userIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const names = new Map<string, string>();
  if (userIds.length === 0) return names;
  const users = await selectMany(db, userTable, { id: [...userIds] });
  const named = users.filter((user) => typeof user.displayName === "string");
  await mapWithConcurrency(named, KMS_POOL_CONCURRENCY, async (user) => {
    names.set(
      String(user.id),
      await decryptStoredPii(String(user.displayName), "displayName", "user:resolve-display-names"),
    );
  });
  return names;
}
