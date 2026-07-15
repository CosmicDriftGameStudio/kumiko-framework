import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection, TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { userMfaTable } from "../schema/user-mfa";

export type UserMfaRow = {
  readonly id: string;
  readonly version: number;
  readonly userId: string;
  readonly totpSecret: string;
  readonly recoveryCodes: { readonly hashes: readonly string[] };
  readonly enabledAt: string;
  readonly lastUsedAt: string | null;
};

export async function findUserMfaRow(
  db: DbConnection | TenantDb,
  userId: string,
  tenantId: TenantId,
): Promise<UserMfaRow | null> {
  const row = await fetchOne<UserMfaRow>(db, userMfaTable, { userId, tenantId });
  return row ?? null;
}
