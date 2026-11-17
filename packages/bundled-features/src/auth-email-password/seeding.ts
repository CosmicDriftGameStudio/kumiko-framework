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
} from "@cosmicdrift/kumiko-framework/crypto";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import { fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  type SessionUser,
  SYSTEM_USER_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { ConflictError } from "@cosmicdrift/kumiko-framework/errors";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import { hashPassword, normalizeEmail, verifyPassword } from "../shared/index.ts";
// kumiko-lint-ignore cross-feature-import bootstrap admin seed checks whether the tenant already has members
import { tenantMembershipsTable } from "../tenant/membership-table.ts";
// kumiko-lint-ignore cross-feature-import auth-tests need user+tenant seed-helpers
import {
  addTenantMembershipRoles,
  type SeedTenantHooks,
  seedTenant,
  seedTenantMembership,
} from "../tenant/seeding.ts";
// kumiko-lint-ignore cross-feature-import signup create-only guard reads the user projection by email
import { userTable } from "../user/schema/user.ts";
// kumiko-lint-ignore cross-feature-import auth-tests need user+tenant seed-helpers
import { seedUser } from "../user/seeding.ts";

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
  db: DbRunner,
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
 *  DbRunner structurally. With a plain connection, the three writes
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
  db: DbRunner,
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
  const existingUser = await fetchOne(db, userTable, {
    email: normalizeEmail(options.email),
    isDeleted: false,
  });
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
  db: DbRunner,
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

// A self-registered, unverified account may squat the seed email before the
// first boot. Granting roles to it (or marking it verified) would hand the
// attacker the admin. An explicit caller guard (bootstrap seed: passwordless
// own account) replaces the built-in proof because it cannot satisfy it.
async function mayGrantToExistingAccount(
  row: Record<string, unknown>,
  options: SeedAdminOptions,
  callerGuard: ((row: Record<string, unknown>) => boolean) | undefined,
): Promise<boolean> {
  if (callerGuard) return callerGuard(row);
  if (row["emailVerified"] === true) return true;
  const storedHash = row["passwordHash"];
  if (options.password === undefined || typeof storedHash !== "string" || storedHash === "") {
    return false;
  }
  return verifyPassword(storedHash, options.password);
}

function warnSeedSkippedForUnprovenAccount(): void {
  log.warn(
    "seedAdminGuarded: an existing unverified account holds the seed email and does not match the seed password, grants skipped",
  );
}

async function seedAdminWithOwnershipCheck(
  db: DbRunner,
  options: SeedAdminOptions,
  mayGrantToExisting: ((row: Record<string, unknown>) => boolean) | undefined,
): Promise<{ id: string }> {
  const row = await fetchOne(db, userTable, {
    email: normalizeEmail(options.email),
    isDeleted: false,
  });
  if (row && !(await mayGrantToExistingAccount(row, options, mayGrantToExisting))) {
    if (!mayGrantToExisting) warnSeedSkippedForUnprovenAccount();
    return { id: String(row["id"]) };
  }
  return seedAdmin(db, options);
}

/**
 * Boot-seed variant of seedAdmin that checks ownership of an existing account (verified or seed
 * password) before granting to it, and aborts under a PII KMS without a blind-index key.
 */
export async function seedAdminGuarded(
  db: DbRunner,
  options: SeedAdminOptions,
  mayGrantToExisting?: (row: Record<string, unknown>) => boolean,
): Promise<{ id: string }> {
  // Without a bidx key every row seeded here gets a NULL email_bidx, which
  // neither seedAdmin's lookup nor the partial unique index can ever see.
  if (configuredPiiSubjectKms() !== undefined && configuredBlindIndexKey() === undefined) {
    throw new Error(
      "seedAdminGuarded: a PII KMS is configured but no blind-index key — the email lookup would be blind and the seed would insert a duplicate admin. Configure KUMIKO_BLIND_INDEX_KEY.",
    );
  }
  return seedAdminWithOwnershipCheck(db, options, mayGrantToExisting);
}

async function findExistingUserRowForEmail(db: DbRunner, email: string) {
  return fetchOne(db, userTable, { email: normalizeEmail(email), isDeleted: false });
}

function hasPassword(row: Record<string, unknown>): boolean {
  return typeof row["passwordHash"] === "string" && row["passwordHash"] !== "";
}

/** Tenant already has a member other than `ownUserId` (soft-deleted memberships count). */
async function tenantHasForeignMember(
  db: DbRunner,
  tenantId: TenantId,
  ownUserId: string | undefined,
): Promise<boolean> {
  const where = ownUserId === undefined ? { tenantId } : { tenantId, userId: { ne: ownUserId } };
  const [foreignMember] = await selectMany(db, tenantMembershipsTable, where, {
    fields: ["id"],
    limit: 1,
  });
  return foreignMember !== undefined;
}

/**
 * One-shot boot seed for an account that sets its password later (password
 * reset). Skipped when the account already has a password (owner after their
 * reset, or a foreign self-registration: granting admin to the latter would be
 * an escalation) and when the target tenant already has another member (owner
 * deleted or changed their email: re-seeding would mint a new passwordless
 * SystemAdmin). Only our own passwordless account is completed, so a partial
 * earlier seed converges.
 */
export async function seedBootstrapAdmin(
  db: DbRunner,
  options: SeedAdminOptions,
): Promise<{ id: string } | { skipped: "has-password" | "tenant-has-members" }> {
  const existing = await findExistingUserRowForEmail(db, options.email);
  if (existing && hasPassword(existing)) {
    log.info("seedBootstrapAdmin: the account already has a password, bootstrap seed skipped");
    return { skipped: "has-password" };
  }
  const ownUserId = typeof existing?.["id"] === "string" ? existing["id"] : undefined;
  for (const membership of options.memberships) {
    if (await tenantHasForeignMember(db, membership.tenantId, ownUserId)) {
      log.info("seedBootstrapAdmin: the tenant already has members, bootstrap seed skipped");
      return { skipped: "tenant-has-members" };
    }
  }
  let passwordAppeared = false;
  const seeded = await seedAdminGuarded(db, options, (row) => {
    passwordAppeared = hasPassword(row);
    return !passwordAppeared;
  });
  if (passwordAppeared) {
    log.info("seedBootstrapAdmin: the account got a password meanwhile, bootstrap seed skipped");
    return { skipped: "has-password" };
  }
  return seeded;
}

/**
 * Boot top-up for the bootstrap owner: adds the roles the owner's existing membership in the tenant
 * lacks. Only a membership the system user created and last wrote is touched, so a human role change since then is not reverted at boot; the mail is unique per account, so the account is the owner named in the env.
 */
export async function ensureBootstrapAdminRoles(
  db: DbRunner,
  options: {
    readonly email: string;
    readonly tenantId: TenantId;
    readonly roles: readonly string[];
  },
): Promise<{ readonly added: readonly string[] }> {
  const owner = await findExistingUserRowForEmail(db, options.email);
  if (typeof owner?.["id"] !== "string") return { added: [] };
  return addTenantMembershipRoles(db, {
    userId: owner["id"],
    tenantId: options.tenantId,
    roles: options.roles,
    onlyIfInsertedBy: SYSTEM_USER_ID,
  });
}
