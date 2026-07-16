import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventStoreExecutor, type TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { userMfaEntity, userMfaTable } from "../schema/user-mfa";

export type UserMfaRow = {
  readonly id: string;
  readonly version: number;
  readonly userId: string;
  readonly totpSecret: string;
  readonly recoveryCodes: { readonly hashes: readonly string[] };
  readonly enabledAt: string;
  readonly lastUsedAt: string | null;
};

const executor = createEventStoreExecutor(userMfaTable, userMfaEntity, {
  entityName: "user-mfa",
});

// `totpSecret` is `encrypted: true` — a raw fetchOne would return ciphertext,
// not the plaintext base32 secret. fetchOne only locates the row's id (no
// decryption needed for that); executor.detail() does the real, decrypting
// read the same way every other entity handler does.
export async function findUserMfaRow(db: TenantDb, user: SessionUser): Promise<UserMfaRow | null> {
  const idLookup = await fetchOne<{ id: string }>(db, userMfaTable, {
    userId: user.id,
    tenantId: user.tenantId,
  });
  if (!idLookup) return null;
  const detail = await executor.detail({ id: idLookup.id }, user, db);
  // @cast-boundary engine-payload — executor.detail returns a decrypted,
  // untyped Record; the userMfa entity's own field shape narrows it.
  return detail as UserMfaRow | null;
}
