import { decryptStoredPii, mapWithConcurrency } from "../../shared/index.ts";

export type MemberUserRow = {
  readonly id: unknown;
  readonly email?: unknown;
  readonly displayName?: unknown;
};

// Bounded, not Promise.all/sequential: each decrypt hits the KMS adapter's
// own small dedicated pool (PgKmsAdapter default max: 4). Promise.all fires
// one call per user unbounded and exhausts the pool once membership counts
// exceed a handful, surfacing as "the connection was closed"; a strict
// sequential loop caps concurrency at 1 and leaves 3 pool slots idle.
export const KMS_POOL_CONCURRENCY = 4;

export async function decryptMemberUsers(
  users: readonly MemberUserRow[],
  reason: string,
): Promise<Map<string, { readonly email: string | null; readonly displayName: string | null }>> {
  const decrypted = await mapWithConcurrency(users, KMS_POOL_CONCURRENCY, async (user) => {
    const email =
      typeof user.email === "string" ? await decryptStoredPii(user.email, "email", reason) : null;
    const displayName =
      typeof user.displayName === "string"
        ? await decryptStoredPii(user.displayName, "displayName", reason)
        : null;
    return { userId: String(user.id), email, displayName };
  });
  return new Map(decrypted.map((d) => [d.userId, d]));
}
