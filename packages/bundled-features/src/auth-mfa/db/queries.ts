import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventStoreExecutor, type TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { parseJsonOrThrow } from "@cosmicdrift/kumiko-framework/utils";
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

// `totpSecret`/`recoveryCodes` are `encrypted: true` — a raw fetchOne would
// return ciphertext, not plaintext. fetchOne only locates the row's id (no
// decryption needed for that); executor.detail() does the real, decrypting
// read the same way every other entity handler does. `recoveryCodes` is
// stored as a JSON string (schema/user-mfa.ts — both encryption layers need
// a string value) — parsed back into `{ hashes }` here, once, for every
// caller instead of each handler re-parsing it. A parse failure here means
// stored data is corrupt (post-decrypt, not user input) — fail loud.
export async function findUserMfaRow(db: TenantDb, user: SessionUser): Promise<UserMfaRow | null> {
  const idLookup = await fetchOne<{ id: string }>(db, userMfaTable, {
    userId: user.id,
    tenantId: user.tenantId,
  });
  if (!idLookup) return null;
  const detail = await executor.detail({ id: idLookup.id }, user, db);
  if (!detail) return null;
  // @cast-boundary engine-payload — executor.detail returns a decrypted,
  // untyped Record; the userMfa entity's own field shape narrows it.
  const row = detail as Omit<UserMfaRow, "recoveryCodes"> & { recoveryCodes: string };
  const recoveryCodes = parseJsonOrThrow<{ hashes: readonly string[] }>(
    row.recoveryCodes,
    "user-mfa.recoveryCodes",
  );
  return { ...row, recoveryCodes };
}
