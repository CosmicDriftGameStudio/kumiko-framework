import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import { decryptStoredPii, mapWithConcurrency } from "../shared/index.js";
import { userTable } from "./schema/user.js";

// Shares the KMS adapter's small dedicated pool, same as member-directory.
const KMS_POOL_CONCURRENCY = 4;

// One batched lookup for a page of user ids. Users that are missing, have no
// display name, or whose name cannot be decrypted (e.g. crypto-shredded) are
// left out, so callers fall back to the raw id instead of failing the page.
export async function resolveUserDisplayNames(
  db: TenantDb,
  userIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const names = new Map<string, string>();
  if (userIds.length === 0) return names;
  const users = await selectMany(db, userTable, { id: [...userIds] });
  const named = users.filter((user) => typeof user.displayName === "string");
  await mapWithConcurrency(named, KMS_POOL_CONCURRENCY, async (user) => {
    try {
      names.set(
        String(user.id),
        await decryptStoredPii(
          String(user.displayName),
          "displayName",
          "user:resolve-display-names",
        ),
      );
    } catch {
      // Unreadable name: the caller's fallback applies.
    }
  });
  return names;
}
