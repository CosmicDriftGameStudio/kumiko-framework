// Testing helper for the user feature. `seedUser` creates a user directly
// through the event-store executor—the same path as the real
// `UserHandlers.create`, but without access checks or ConflictError on
// duplicates. It is idempotent and add-only via the `email` column: an
// existing user returns without emitting an event. There is no update path;
// profile changes go through the regular handler.
//
// Directly calling `db.insert(userTable)` would bypass the event store, so no
// `user.created` event would be emitted and no MSP consumers (audit,
// search-index) would see the seed. The executor path emits the event and
// writes the projection row in one transaction.

import { computeBlindIndex, configuredBlindIndexKey } from "@cosmicdrift/kumiko-framework/crypto";
import {
  createEventStoreExecutor,
  createTenantDb,
  type DbConnection,
  fetchOne,
} from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
// kumiko-lint-ignore cross-feature-import shares the postSave-hooks fixture contract with tenant/seeding
import { fireEntityPostSave, type SeedTenantHooks } from "../tenant/seeding.ts";
import { userEntity, userTable } from "./schema/user.ts";

const userExecutor = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });

export type SeedUserOptions = {
  readonly email: string;
  readonly displayName: string;
  /** Optional pre-hashed password. For plain-password tests, prefer the
   * convenience wrapper from
   * `@cosmicdrift/kumiko-bundled-features/auth-email-password/seeding`,
   * which performs argon2 hashing. */
  readonly passwordHash?: string;
  readonly locale?: string;
  /** Global roles—stored in users.roles as jsonb string[].
   * The login handler merges them into the session roles alongside tenant-
   * membership roles. Default: empty array. Typical example:
   * `["SystemAdmin"]` for the platform operator. */
  readonly roles?: readonly string[];
  /** Initial state for emailVerified. Default: false. The required
   * verification flow must explicitly set "true" when email ownership has
   * already been proven—for example, in a Magic-Link signup where the user
   * clicked the email link before the account was created. */
  readonly emailVerified?: boolean;
  readonly by?: SessionUser;
};

/**
 * Seeds a user. Returns the userId (existing or newly created).
 * Idempotent and add-only via the `email` column: if a user with this
 * email exists, its ID is returned without a new insert.
 */
export async function seedUser(
  db: DbConnection,
  options: SeedUserOptions,
  // Optional, append-only — same rationale as tenant/seeding's seedTenant
  // hooks param: fires user's postSave hooks (e.g. a Welcome-
  // notification hook keyed off `allOf: "user"`) for fixtures/self-signup
  // that opt in. Omit to keep today's hook-less behavior.
  hooks?: SeedTenantHooks,
): Promise<{ id: string }> {
  const by = options.by ?? TestUsers.systemAdmin;
  // executor.create expects a TenantDb (with an .insert() API). Although
  // User is tenant-agnostic (it has no tenant_id column), the runtime
  // interface requires this wrapper.
  const tdb = createTenantDb({
    db,
    tenantId: by.tenantId,
    mode: "system",
    reason: "User is tenant-agnostic, seeding writes it through a system-mode handle",
  });

  const existing = await fetchOne(db, userTable, { email: options.email, isDeleted: false });
  // @cast-boundary db-row: users.id is a uuid column (string), and fetchOne
  // returns the projection row as Record<string, unknown>.
  if (existing) {
    const id = existing["id"] as string;
    if (options.emailVerified === true) {
      await reconcileSeededUserEmailVerified(db, existing, by);
    }
    return { id };
  }

  const result = await userExecutor.create(
    {
      email: options.email,
      displayName: options.displayName,
      ...(options.passwordHash !== undefined && { passwordHash: options.passwordHash }),
      ...(options.locale !== undefined && { locale: options.locale }),
      ...(options.roles !== undefined && { roles: [...options.roles] }),
      ...(options.emailVerified !== undefined && { emailVerified: options.emailVerified }),
    },
    by,
    tdb,
  );
  if (!result.isSuccess) {
    throw new Error(
      `seedUser failed: ${result.error.code} — ${JSON.stringify(result.error.details ?? {})}`,
    );
  }
  await fireEntityPostSave(hooks, "user:seed", result.data);
  return { id: extractId(result.data, "seedUser") };
}

// A re-run seed onto a row created before emailVerified flipped to true must
// still set it — via the executor, so it lands as a real `.updated` event.
export async function reconcileSeededUserEmailVerified(
  db: DbConnection,
  existingRow: Record<string, unknown>,
  by: SessionUser,
): Promise<void> {
  // skip: already verified, nothing to reconcile
  if (existingRow["emailVerified"] === true) return;
  // @cast-boundary db-row: users.id is a uuid column (string), and fetchOne
  // returns the projection row as Record<string, unknown>.
  const id = existingRow["id"] as string;
  const tdb = createTenantDb({
    db,
    tenantId: by.tenantId,
    mode: "system",
    reason: "User is tenant-agnostic, seeding writes it through a system-mode handle",
  });
  const result = await userExecutor.update(
    { id, version: existingRow["version"] as number, changes: { emailVerified: true } },
    by,
    tdb,
  );
  // version_conflict = a concurrent write already changed the row —
  // fine for a seed helper, don't fail the whole seed run over it.
  if (!result.isSuccess && result.error.code !== "version_conflict") {
    throw new Error(
      `reconcileSeededUserEmailVerified failed: ${result.error.code} — ${JSON.stringify(result.error.details ?? {})}`,
    );
  }
}

// Re-writes `email` through the executor so the PII write pipeline recomputes
// `email_bidx`. Repairs rows whose blind index is NULL or stale (written before
// the key existed, key rotated, subject-key erased), which would otherwise stay
// invisible to every `fetchOne(userTable, { email })` lookup.
export async function rewriteSeededUserEmail(
  db: DbConnection,
  existingRow: Record<string, unknown>,
  email: string,
  by: SessionUser,
): Promise<void> {
  const id = existingRow["id"];
  if (typeof id !== "string") {
    throw new Error("rewriteSeededUserEmail: existing user row has no string id");
  }
  const version = existingRow["version"];
  if (typeof version !== "number") {
    throw new Error("rewriteSeededUserEmail: existing user row has no numeric version");
  }
  // Every executor.update appends a user:updated event; skip when the stored
  // blind index already matches so repeated boots do not grow the stream.
  // Queried by the bidx column itself: fetchOne does not return it, and an
  // `email` condition would also match a plaintext row with a blank index.
  const blindIndexKey = configuredBlindIndexKey();
  if (blindIndexKey !== undefined) {
    const indexed = await fetchOne(db, userTable, {
      id,
      emailBidx: computeBlindIndex(blindIndexKey, email),
    });
    // skip: the stored blind index already matches, a rewrite would only append a no-op event.
    if (indexed) return;
  }
  const tdb = createTenantDb({
    db,
    tenantId: by.tenantId,
    mode: "system",
    reason: "User is tenant-agnostic, seeding writes it through a system-mode handle",
  });
  const result = await userExecutor.update({ id, version, changes: { email } }, by, tdb);
  // version_conflict: a concurrent write already changed the row — fine for a seed helper.
  // unique_violation: a duplicate row already holds the blind index; the repair
  // has to wait for a manual duplicate cleanup.
  if (
    !result.isSuccess &&
    result.error.code !== "version_conflict" &&
    result.error.code !== "unique_violation"
  ) {
    throw new Error(
      `rewriteSeededUserEmail failed: ${result.error.code} — ${JSON.stringify(result.error.details ?? {})}`,
    );
  }
}

// Extracts the `id` column from the executor.create result. The executor
// returns a Record<string, unknown> (the projection row), into which the DB
// writes the aggregate ID. We validate it at runtime instead of using a
// blind `as { id: string }` cast, so an API contract violation throws an
// explicit error rather than surfacing downstream as an undefined-value bug.
function extractId(data: unknown, who: string): string {
  if (typeof data === "object" && data !== null && "id" in data) {
    const id = (data as { id: unknown }).id; // @cast-boundary engine-bridge
    if (typeof id === "string") return id;
  }
  throw new Error(`${who}: executor.create result has no string id (got ${JSON.stringify(data)})`);
}
