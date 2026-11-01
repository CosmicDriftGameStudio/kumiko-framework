// Stable seeding helpers for the auth-email-password feature. They live under
// `/seeding` rather than `/testing` to make the contract clear: this is
// non-test code that runs on every dev boot and integration test.
// Test-specific variations (account-locked setup, expired-token,
// race-conditions) are NOT added as options to these helpers —
// they belong in separate functions or inline in the test file.
//
// Bundles three steps into one call:
//   1. argon2 hash of the plaintext password
//   2. seedUser() from user/seeding
//   3. seedTenant + seedTenantMembership from tenant/seeding
// This keeps sample servers and tests from having to assemble three
// sub-paths themselves.

import {
  configuredBlindIndexKey,
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
  type LocalKeyKmsAdapter,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  type SessionUser,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { ConflictError } from "@cosmicdrift/kumiko-framework/errors";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import { hashPassword } from "../shared/index.ts";
// kumiko-lint-ignore cross-feature-import auth-tests need user+tenant seed-helpers
import { type SeedTenantHooks, seedTenant, seedTenantMembership } from "../tenant/seeding.ts";
// kumiko-lint-ignore cross-feature-import signup create-only guard reads the user projection by email
import { USER_STATUS, userTable } from "../user/schema/user.ts";
// kumiko-lint-ignore cross-feature-import auth-tests need user+tenant seed-helpers
import {
  reconcileSeededUserEmailVerified,
  rewriteSeededUserEmail,
  seedUser,
} from "../user/seeding.ts";

const log = createFallbackLogger("auth-email-password-seeding");

// Re-export for a convenient single import site in tests/seed-scripts.
// The auth feature is the natural caller for "seed admin user with
// password + tenant + membership", so consumers do not need to assemble
// these helpers from three different sub-paths.
// kumiko-lint-ignore cross-feature-import re-export of test-helpers
export { seedTenant, seedTenantMembership } from "../tenant/seeding.ts";
// kumiko-lint-ignore cross-feature-import re-export of test-helpers
export { seedUser } from "../user/seeding.ts";

export type SeedUserWithPasswordOptions = {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
  readonly locale?: string;
  /** Global roles — see SeedUserOptions.roles. */
  readonly roles?: readonly string[];
  /** Initial emailVerified flag. Defaults to false (the verification flow runs).
   *  Magic-link signup sets it to true because clicking the email proves
   *  ownership. See SeedUserOptions.emailVerified. */
  readonly emailVerified?: boolean;
  readonly by?: SessionUser;
};

/**
 * Seed a user with a plaintext password (hashed with argon2 before insertion).
 * Returns the userId and is idempotent by email.
 */
export async function seedUserWithPassword(
  db: DbConnection,
  options: SeedUserWithPasswordOptions,
  // Optional, append-only — same rationale as provisionSignupAccount's
  // hooks param: the self-signup path passes it through so `user`'s
  // postSave hooks fire on self-signup same as on the regular create path.
  hooks?: SeedTenantHooks,
): Promise<{ id: string }> {
  const passwordHash = await hashPassword(options.password);
  return seedUser(
    db,
    {
      email: options.email,
      displayName: options.displayName,
      passwordHash,
      ...(options.locale !== undefined && { locale: options.locale }),
      ...(options.roles !== undefined && { roles: options.roles }),
      ...(options.emailVerified !== undefined && { emailVerified: options.emailVerified }),
      ...(options.by !== undefined && { by: options.by }),
    },
    hooks,
  );
}

/** Provisions a fresh tenant, admin user, and membership for self-signup
 *  confirmation in one operation. It uses the existing event-store pipeline
 *  (as seedAdmin), keeping it consistent with the regular create path:
 *  events are written, projections are populated, and MSPs/audit see the
 *  new rows.
 *
 *  Naming note: internally uses `seedTenant` / `seedUser*`; these helpers are
 *  production-grade (event-store pipeline), and "seed" is historical because
 *  they were first built for tests and bootstrap before being exported as
 *  general-purpose helpers.
 *
 *  Atomicity: runs inside a Drizzle transaction when the caller provides one
 *  (db.begin(tx => provisionSignupAccount(tx, ...)); the seed helpers accept
 *  DbConnection|DbTx structurally. With a plain DbConnection, the three writes
 *  are not atomic; a failure between steps can leave an orphan tenant (tenant
 *  without a user → unused row; user without a membership → "no_membership"
 *  on first login).
 *
 *  Create-only: if a user with this email already exists (from seeding or an
 *  earlier signup), the function throws a ConflictError BEFORE creating a
 *  tenant. The self-signup path must not silently reuse an existing user —
 *  otherwise the confirmation step could mint a session for that user
 *  (account takeover). `seedUser` itself remains idempotent and add-only
 *  (for bootstrap/tests); the create-only guarantee belongs here.
 *  The caller resolves tenantKey collisions via generateUniqueName. */
/** Default membership roles for self-signup tenant owners. Shared between
 *  provisionSignupAccount (DB write) and signup-confirm-handler
 *  (SessionUser construction for JWT minting); otherwise two locations would
 *  independently hardcode "TenantAdmin" and a refactor could cause a role
 *  mismatch between the database and the session. */
// TenantAdmin is the canonical owner role; Admin stays for handlers that still
// gate on the legacy literal until those call sites move to access.admin.
export const INITIAL_SIGNUP_ROLES = ["TenantAdmin", "Admin"] as const;

export type ProvisionSignupAccountOptions = {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
  readonly tenantKey: string;
  readonly tenantName: string;
  readonly tenantId: TenantId;
  readonly memberRoles?: readonly string[];
  /** Stored on the new user row so the first session already carries the locale claim. */
  readonly locale?: string;
};

export async function provisionSignupAccount(
  db: DbConnection,
  options: ProvisionSignupAccountOptions,
  // Optional, append-only — existing callers (tests, seed scripts) that
  // don't pass hooks keep today's behavior. The real signup-confirm
  // handler DOES pass it so seedTenant/seedUserWithPassword/
  // seedTenantMembership's postSave hooks (tier-engine's auto-default-tier,
  // app auto-default-compliance, a Welcome-notification hook, ...) fire on
  // self-signup for all three entities, same as they do on the regular
  // create paths — this was only wired for tenant before.
  hooks?: SeedTenantHooks,
): Promise<{ readonly userId: string; readonly tenantId: TenantId }> {
  // Create-only guard BEFORE seedTenant: hard-abort on an already-registered
  // email, otherwise an orphaned tenant would be created and seedUser
  // (idempotent add-only) would silently return the existing userId ->
  // confirm mints a session for the wrong account.
  // isDeleted: false — the partial bidx unique index only covers live rows,
  // so a soft-deleted row must not block re-registering its email.
  const existingUser = await fetchOne(db, userTable, { email: options.email, isDeleted: false });
  if (existingUser) {
    throw new ConflictError({ message: "signup: email already registered" });
  }
  await seedTenant(
    db,
    {
      id: options.tenantId,
      key: options.tenantKey,
      name: options.tenantName,
    },
    hooks,
  );
  const { id: userId } = await seedUserWithPassword(
    db,
    {
      email: options.email,
      password: options.password,
      displayName: options.displayName,
      emailVerified: true,
      ...(options.locale !== undefined && { locale: options.locale }),
    },
    hooks,
  );
  await seedTenantMembership(
    db,
    {
      userId,
      tenantId: options.tenantId,
      roles: options.memberRoles ?? INITIAL_SIGNUP_ROLES,
    },
    hooks,
  );
  return { userId, tenantId: options.tenantId };
}

export type SeedAdminOptions = {
  readonly email: string;
  /** Omit to seed an account without a password; it sets one via password reset. */
  readonly password?: string;
  readonly displayName: string;
  /** Tenants where the admin is added as a member. Each tenant can have
   *  its own role list, which lets the sample TenantSwitcher show different
   *  role lists for each tenant. */
  readonly memberships: ReadonlyArray<{
    readonly tenantId: TenantId;
    readonly tenantKey: string;
    readonly tenantName: string;
    readonly roles: readonly string[];
  }>;
  /** Global roles stored in users.roles, independent of the tenant.
   *  The login handler merges them into every session alongside the tenant
   *  membership roles. Typical use case: `["SystemAdmin"]` for a platform
   *  operator. Default: empty. */
  readonly globalRoles?: readonly string[];
  /** Initial emailVerified state — defaults to false (unverified). Same
   *  mechanism as seedUserWithPassword.emailVerified. Re-running the seed
   *  against an already-seeded row reconciles this flag too (true → sets
   *  it via a real `.updated` event; never flips true → false). */
  readonly emailVerified?: boolean;
  readonly by?: SessionUser;
};

/**
 * Seeding convenience for sample servers: an admin user with a hashed
 * password, N tenants, and N memberships. Idempotent, so rerunning it in
 * persistent-DB mode succeeds. Returns the userId.
 */
export async function seedAdmin(
  db: DbConnection,
  options: SeedAdminOptions,
): Promise<{ id: string }> {
  const byOption = options.by === undefined ? {} : { by: options.by };

  for (const m of options.memberships) {
    await seedTenant(db, { id: m.tenantId, key: m.tenantKey, name: m.tenantName, ...byOption });
  }

  const userFields = {
    email: options.email,
    displayName: options.displayName,
    ...(options.globalRoles !== undefined && { roles: options.globalRoles }),
    ...(options.emailVerified !== undefined && { emailVerified: options.emailVerified }),
    ...byOption,
  };
  const { id: userId } =
    options.password === undefined
      ? await seedUser(db, userFields)
      : await seedUserWithPassword(db, { ...userFields, password: options.password });

  for (const m of options.memberships) {
    await seedTenantMembership(db, {
      userId,
      tenantId: m.tenantId,
      roles: m.roles,
      ...byOption,
    });
  }

  return { id: userId };
}

// seedAdmin's idempotency check is a plain fetchOne(email),
// which the query layer rewrites into `(email = $plaintext OR
// email_bidx = $hmac)` once a blind-index key is configured. Under KMS
// encryption `email` holds per-row ciphertext, so only the bidx arm can
// ever match — and it misses whenever a row's `email_bidx` is NULL (written
// before the key existed, or after a subject-key erase) or was computed
// with a since-rotated key. seedAdmin then inserts a second row for an
// email that already has an account; neither the plaintext unique index
// (sits on randomized ciphertext) nor the partial bidx unique index (WHERE
// email_bidx IS NOT NULL, so a NULL row never collides) catches it.
//
// seedAdminGuarded is a separate, additive boot-seed guard — NOT a change
// to seedUser/seedAdmin/provisionSignupAccount, which also run on every
// real self-signup request and can't afford a decrypt-scan fallback there.
// It's what runProdApp/runDevApp call for their admin boot-seed; keep it
// off the login/signup hot path.

type ActiveUserRow = {
  readonly id: string;
  readonly email: string;
  readonly insertedAt: { readonly epochNanoseconds: bigint };
};

function compareInsertedAt(a: ActiveUserRow["insertedAt"], b: ActiveUserRow["insertedAt"]): number {
  // selectMany<ActiveUserRow> is an unchecked row-shape claim. A codec that
  // yields another type would make both comparisons false and silently fall
  // back to id order, which can crown the younger duplicate as survivor.
  if (typeof a.epochNanoseconds !== "bigint" || typeof b.epochNanoseconds !== "bigint") {
    throw new Error("compareInsertedAt: user.insertedAt is not a Temporal.Instant");
  }
  if (a.epochNanoseconds < b.epochNanoseconds) return -1;
  if (a.epochNanoseconds > b.epochNanoseconds) return 1;
  return 0;
}

/** Oldest row wins, tie-broken by id — the same rule a manual duplicate
 *  cleanup would apply, so this guard and any later cleanup never disagree
 *  on which row is the survivor. */
function pickCanonicalUserId(rows: readonly ActiveUserRow[]): string {
  const sorted = [...rows].sort((a, b) => {
    const byTime = compareInsertedAt(a.insertedAt, b.insertedAt);
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
  });
  const first = sorted[0];
  if (first === undefined) throw new Error("pickCanonicalUserId: empty group");
  return first.id;
}

async function findExistingUserIdForEmail(
  db: DbConnection,
  kms: LocalKeyKmsAdapter,
  email: string,
): Promise<string | undefined> {
  // ponytail: decrypts every active user row to compare emails. Fine at
  // boot-seed scale (tens of accounts, once per boot); if the user table
  // grows past a few thousand rows, narrow this to rows whose email_bidx is
  // NULL or doesn't match the expected HMAC — only those need decrypting.
  const rows = await selectMany<ActiveUserRow>(db, userTable, {
    isDeleted: false,
    status: { ne: USER_STATUS.Deleted },
  });
  const matches: ActiveUserRow[] = [];
  let undecryptableRows = 0;
  for (const row of rows) {
    // Compared byte-exact, deliberately not case-folded: email_bidx is an
    // HMAC over the raw value and login matches case-sensitively, so a case
    // variant is a different account to every other code path.
    // One undecryptable foreign row (missing key row, ciphertext from another
    // KMS store) must not abort the boot seed: the account we look for is
    // decryptable by definition.
    let decrypted: Record<string, unknown>;
    try {
      decrypted = await decryptPiiFieldValues({ email: row.email }, ["email"], kms, {
        requestId: "seed-admin-guarded",
      });
    } catch {
      undecryptableRows += 1;
      continue;
    }
    if (decrypted["email"] === email) matches.push(row);
  }
  if (undecryptableRows > 0) {
    log.warn(
      `seedAdminGuarded: skipped ${undecryptableRows} user row(s) whose email could not be decrypted`,
    );
  }
  return matches.length === 0 ? undefined : pickCanonicalUserId(matches);
}

/**
 * Boot-seed variant of seedAdmin that survives a blind-index miss on an
 * otherwise-existing account (see the module comment above). Not for the
 * self-signup hot path — seedAdmin/seedUser stay the unguarded entry point
 * there.
 *
 * No cheap `fetchOne` fast path here on purpose: a hit there only proves
 * SOME row matches (plaintext or bidx), never that it's the canonical one —
 * a stale row's bidx can go NULL while a later duplicate's stays valid, so
 * fetchOne keeps finding the duplicate forever and the seed never converges
 * on the oldest row. The only cheap short-circuit that stays correct is
 * skipping the scan entirely when no KMS is configured at all (plaintext
 * DBs have no bidx ambiguity to guard against in the first place).
 */
export async function seedAdminGuarded(
  db: DbConnection,
  options: SeedAdminOptions,
): Promise<{ id: string }> {
  const kms = configuredPiiSubjectKms();
  if (kms === undefined) return seedAdmin(db, options);

  // Without a bidx key every row seeded here gets a NULL email_bidx, which
  // neither seedAdmin's lookup nor the partial unique index can ever see.
  if (configuredBlindIndexKey() === undefined) {
    throw new Error(
      "seedAdminGuarded: a PII KMS is configured but no blind-index key — the email lookup would be blind and the seed would insert a duplicate admin. Configure KUMIKO_BLIND_INDEX_KEY.",
    );
  }

  const existingId = await findExistingUserIdForEmail(db, kms, options.email);
  if (existingId === undefined) return seedAdmin(db, options);

  const byOption = options.by === undefined ? {} : { by: options.by };
  const by = options.by ?? createSystemUser(SYSTEM_TENANT_ID);
  const existingRow = await fetchOne(db, userTable, { id: existingId });
  if (existingRow) {
    // Re-write the email so email_bidx is recomputed; without it the account
    // stays unfindable for login and every boot re-scans the whole table.
    await rewriteSeededUserEmail(db, existingRow, options.email, by);
    if (options.emailVerified === true) {
      const refreshed = (await fetchOne(db, userTable, { id: existingId })) ?? existingRow;
      await reconcileSeededUserEmailVerified(db, refreshed, by);
    }
  }
  for (const m of options.memberships) {
    await seedTenant(db, { id: m.tenantId, key: m.tenantKey, name: m.tenantName, ...byOption });
    await seedTenantMembership(db, {
      userId: existingId,
      tenantId: m.tenantId,
      roles: m.roles,
      ...byOption,
    });
  }
  return { id: existingId };
}

async function findExistingUserRowForEmail(db: DbConnection, email: string) {
  const kms = configuredPiiSubjectKms();
  if (kms === undefined) return fetchOne(db, userTable, { email, isDeleted: false });
  const existingId = await findExistingUserIdForEmail(db, kms, email);
  return existingId === undefined ? undefined : fetchOne(db, userTable, { id: existingId });
}

/**
 * Boot seed for an account that sets its password later (password reset). An
 * account that already has a password is either the owner after their reset or
 * a foreign self-registration with the same email; granting admin to the latter
 * would be an escalation, so both are left untouched: no verification, no
 * membership, no role change.
 */
export async function seedBootstrapAdmin(
  db: DbConnection,
  options: SeedAdminOptions,
): Promise<{ id: string } | { skipped: "has-password" }> {
  const existing = await findExistingUserRowForEmail(db, options.email);
  if (existing && typeof existing["passwordHash"] === "string" && existing["passwordHash"] !== "") {
    log.info("seedBootstrapAdmin: the account already has a password, bootstrap seed skipped");
    return { skipped: "has-password" };
  }
  return seedAdminGuarded(db, options);
}
