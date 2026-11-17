import { mapWithConcurrency } from "@cosmicdrift/kumiko-framework/utils";
import { decryptStoredPiiFields, KMS_POOL_CONCURRENCY } from "../../shared/index.ts";

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
    const fields: Record<string, string> = {};
    if (typeof user.email === "string") fields["email"] = user.email;
    if (typeof user.displayName === "string") fields["displayName"] = user.displayName;
    const decryptedFields = await decryptStoredPiiFields(fields, reason);
    const email = decryptedFields["email"] ?? null;
    const displayName = decryptedFields["displayName"] ?? null;
    return { userId: String(user.id), email, displayName };
  });
  return new Map(decrypted.map((d) => [d.userId, d]));
}
