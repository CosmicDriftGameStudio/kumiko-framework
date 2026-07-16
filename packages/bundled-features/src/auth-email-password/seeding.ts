// Stable seeding helpers fürs auth-email-password-Feature. Liegen unter
// `/seeding` (nicht `/testing`) damit der Vertrag klar ist: hier ist
// non-test code der bei jedem Dev-Boot + jedem Integration-Test läuft.
// Test-spezifische Variationen (account-locked-Setup, expired-token,
// race-conditions) werden NICHT als Knöpfe an diesen Helpers angebaut —
// sie kommen als neue Funktionen daneben oder inline ins Test-File.
//
// Bündelt drei Schritte in einem Aufruf:
//   1. argon2-Hash des Plain-Passworts
//   2. seedUser() aus user/seeding
//   3. seedTenant + seedTenantMembership aus tenant/seeding
// Damit Sample-Server und Tests keine drei sub-paths zusammensammeln
// müssen.

import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { ConflictError } from "@cosmicdrift/kumiko-framework/errors";
import { TestUsers } from "@cosmicdrift/kumiko-framework/stack";
import { hashPassword } from "../shared";
// kumiko-lint-ignore cross-feature-import auth-tests need user+tenant seed-helpers
import { seedTenant, seedTenantMembership } from "../tenant/seeding";
// kumiko-lint-ignore cross-feature-import signup create-only guard reads the user projection by email
import { userTable } from "../user/schema/user";
// kumiko-lint-ignore cross-feature-import auth-tests need user+tenant seed-helpers
import { seedUser } from "../user/seeding";

// Re-export für ergonomische Single-Import-Site in tests/seed-scripts.
// Das Auth-Feature ist der natürliche Aufrufer für "seed admin user mit
// password + tenant + membership" — wer das nutzt soll nicht aus drei
// verschiedenen sub-paths zusammensammeln müssen.
// kumiko-lint-ignore cross-feature-import re-export of test-helpers
export { seedTenant, seedTenantMembership } from "../tenant/seeding";
// kumiko-lint-ignore cross-feature-import re-export of test-helpers
export { seedUser } from "../user/seeding";

export type SeedUserWithPasswordOptions = {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
  readonly locale?: string;
  /** Globale Rollen — siehe SeedUserOptions.roles. */
  readonly roles?: readonly string[];
  /** Initial-emailVerified-Flag. Default false (Verify-Flow läuft).
   *  Magic-Link-Signup setzt true weil der Mail-Klick die Email-
   *  Ownership beweist. Siehe SeedUserOptions.emailVerified. */
  readonly emailVerified?: boolean;
  readonly by?: SessionUser;
};

/**
 * Seed a user mit Plain-Password (wird vor dem Insert mit argon2
 * gehasht). Liefert die userId, idempotent über email.
 */
export async function seedUserWithPassword(
  db: DbConnection,
  options: SeedUserWithPasswordOptions,
): Promise<{ id: string }> {
  const passwordHash = await hashPassword(options.password);
  return seedUser(db, {
    email: options.email,
    displayName: options.displayName,
    passwordHash,
    ...(options.locale !== undefined && { locale: options.locale }),
    ...(options.roles !== undefined && { roles: options.roles }),
    ...(options.emailVerified !== undefined && { emailVerified: options.emailVerified }),
    ...(options.by !== undefined && { by: options.by }),
  });
}

/** Provisioning-Helper für Self-Signup-Confirm. Legt einen frischen
 *  Tenant + Admin-User + Membership in einem Rutsch an — verwendet die
 *  bestehende Event-Store-Pipeline (wie seedAdmin) und ist daher
 *  konsistent mit dem regulären create-Pfad: events werden geschrieben,
 *  Projections sind populated, MSPs/Audit sehen die neuen Rows.
 *
 *  Naming-Hinweis: nutzt intern `seedTenant` / `seedUser*` —
 *  diese Helpers sind production-grade (event-store-pipeline), das "seed"
 *  im Namen ist historisch (zuerst für Tests + Bootstrap gebaut, dann
 *  als General-Purpose-Helper exportiert). Rename `seed*` → `provision*`
 *  ist als dedizierter Cleanup-PR geplant — disproportional zum Wert
 *  innerhalb dieses Sprints, weil alle existing tests berührt würden.
 *
 *  Atomicity: läuft inside einer Drizzle-Tx wenn der Caller das angibt
 *  (db.begin(tx => provisionSignupAccount(tx, ...)) — die seed-
 *  helpers nehmen DbConnection|DbTx strukturell. Bei pure DbConnection
 *  sind die 3 writes nicht atomic; bei Failure zwischen Schritten kann
 *  ein orphan-Tenant zurückbleiben (Tenant ohne User → unused row;
 *  User ohne Membership → "no_membership" beim ersten Login).
 *
 *  Create-only: existiert bereits ein User mit dieser Email (Seeding oder
 *  früherer Signup), wirft die Funktion einen ConflictError BEVOR ein Tenant
 *  entsteht. Der Self-Signup-Pfad darf einen bestehenden User nicht still
 *  wiederverwenden — sonst würde der Confirm-Schritt eine Session für ihn
 *  minten (Account-Takeover, #365). `seedUser` selbst bleibt idempotent
 *  add-only (für Bootstrap/Tests); die create-only-Garantie sitzt hier.
 *  tenantKey-Kollisionen löst der Caller via generateUniqueName. */
/** Default-Roles für den Self-Signup-Admin. Geteilt zwischen
 *  provisionSignupAccount (DB-write) und signup-confirm-handler
 *  (SessionUser-Konstruktion für JWT-Mint) — sonst hätten zwei
 *  Stellen unabhängig "Admin" hardcoded und würden bei einem
 *  Refactor zu role-mismatch zwischen DB und Session leiden. */
export const INITIAL_SIGNUP_ROLES = ["Admin"] as const;

export type ProvisionSignupAccountOptions = {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
  readonly tenantKey: string;
  readonly tenantName: string;
  readonly tenantId: TenantId;
  readonly memberRoles?: readonly string[];
};

export async function provisionSignupAccount(
  db: DbConnection,
  options: ProvisionSignupAccountOptions,
): Promise<{ readonly userId: string; readonly tenantId: TenantId }> {
  // Create-only-Guard VOR seedTenant: bei bereits registrierter Email hart
  // abbrechen, sonst entstünde ein verwaister Tenant und seedUser (idempotent
  // add-only) gäbe still die bestehende userId zurück → Confirm mintet eine
  // Session für den fremden Account (#365).
  const existingUser = await fetchOne(db, userTable, { email: options.email });
  if (existingUser) {
    throw new ConflictError({ message: "signup: email already registered" });
  }
  await seedTenant(db, {
    id: options.tenantId,
    key: options.tenantKey,
    name: options.tenantName,
  });
  const { id: userId } = await seedUserWithPassword(db, {
    email: options.email,
    password: options.password,
    displayName: options.displayName,
    emailVerified: true,
  });
  await seedTenantMembership(db, {
    userId,
    tenantId: options.tenantId,
    roles: options.memberRoles ?? INITIAL_SIGNUP_ROLES,
  });
  return { userId, tenantId: options.tenantId };
}

export type SeedAdminOptions = {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
  /** Tenants, in die der Admin als Mitglied eingetragen wird. Pro
   *  Tenant kann eine eigene Rollenliste gesetzt werden — hilft beim
   *  Sample-TenantSwitcher der pro Tenant unterschiedliche
   *  Rollen-Listen zeigt. */
  readonly memberships: ReadonlyArray<{
    readonly tenantId: TenantId;
    readonly tenantKey: string;
    readonly tenantName: string;
    readonly roles: readonly string[];
  }>;
  /** Globale Rollen die in users.roles landen — tenant-unabhängig.
   *  Login-Handler mergt sie in jede Session parallel zu den tenant-
   *  membership-Rollen. Typischer use-case: `["SystemAdmin"]` für
   *  einen Plattform-Operator. Default: leer. */
  readonly globalRoles?: readonly string[];
  readonly by?: SessionUser;
};

/**
 * Seed-Convenience für Sample-Server: Admin-User mit gehashtem
 * Password + N Tenants + N Memberships. Alles idempotent (Re-Run im
 * persistent-DB-Modus läuft durch). Liefert die userId zurück.
 */
export async function seedAdmin(
  db: DbConnection,
  options: SeedAdminOptions,
): Promise<{ id: string }> {
  const by = options.by ?? TestUsers.systemAdmin;

  for (const m of options.memberships) {
    await seedTenant(db, { id: m.tenantId, key: m.tenantKey, name: m.tenantName, by });
  }

  const { id: userId } = await seedUserWithPassword(db, {
    email: options.email,
    password: options.password,
    displayName: options.displayName,
    ...(options.globalRoles !== undefined && { roles: options.globalRoles }),
    by,
  });

  for (const m of options.memberships) {
    await seedTenantMembership(db, {
      userId,
      tenantId: m.tenantId,
      roles: m.roles,
      by,
    });
  }

  return { id: userId };
}
