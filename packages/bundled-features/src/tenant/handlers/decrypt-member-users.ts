import { mapWithConcurrency } from "@cosmicdrift/kumiko-framework/utils";
import { decryptStoredPii, KMS_POOL_CONCURRENCY } from "../../shared/index.ts";

export type MemberUserRow = {
  readonly id: unknown;
  readonly email?: unknown;
  readonly displayName?: unknown;
};

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
