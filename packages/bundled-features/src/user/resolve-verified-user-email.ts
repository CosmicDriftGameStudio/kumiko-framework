import type { UserDataHookCtx } from "@cosmicdrift/kumiko-framework/engine";
import { decryptStoredPii, normalizeEmail } from "../shared/index.ts";
import { userTable } from "./schema/user.ts";

// Only a verified owner may see or erase rows matched by email. Forget keeps emailVerified but has
// already rewritten the email, hence the pre-tx copy.
export async function resolveVerifiedUserEmail(
  ctx: UserDataHookCtx,
  piiDecryptReason: string,
): Promise<string | null> {
  const row = await ctx.db.fetchOne<{ email: string; emailVerified: boolean }>(userTable, {
    id: ctx.userId,
  });
  if (row?.emailVerified !== true) return null;
  if (ctx.userEmailBeforeDelete) return normalizeEmail(ctx.userEmailBeforeDelete);
  return normalizeEmail(await decryptStoredPii(row.email, "email", piiDecryptReason));
}
