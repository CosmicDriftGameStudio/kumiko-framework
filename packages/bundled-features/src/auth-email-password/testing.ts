// Testing-Convenience fürs auth-email-password-Feature. Bündelt:
//   1. argon2-Hash des Plain-Passworts
//   2. seedUser() aus user/testing
// in einen Aufruf, damit Test-Fixtures keine zwei Steps brauchen.
//
// Wer mehr Kontrolle will (existierender Hash, custom locale, anderer
// SessionUser für event.metadata), nutzt seedUser direkt.

import type { DbConnection } from "@kumiko/framework/db";
import type { SessionUser, TenantId } from "@kumiko/framework/engine";
import { TestUsers } from "@kumiko/framework/testing";
import { seedTenant, seedTenantMembership } from "../tenant/testing";
import { seedUser } from "../user/testing";
import { hashPassword } from "./password-hashing";

// Re-export für ergonomische Single-Import-Site in tests/seed-scripts.
// Das Auth-Feature ist der natürliche Aufrufer für "seed admin user mit
// password + tenant + membership" — wer das nutzt soll nicht aus drei
// verschiedenen sub-paths zusammensammeln müssen.
export { seedTenant, seedTenantMembership } from "../tenant/testing";
export { seedUser } from "../user/testing";

export type SeedUserWithPasswordOptions = {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
  readonly locale?: string;
  readonly by?: SessionUser;
};

/**
 * Seed a user mit Plain-Password (wird vor dem Insert mit argon2
 * gehasht). Liefert userId, idempotent über email.
 */
export async function seedUserWithPassword(
  db: DbConnection,
  options: SeedUserWithPasswordOptions,
): Promise<string> {
  const passwordHash = await hashPassword(options.password);
  return seedUser(db, {
    email: options.email,
    displayName: options.displayName,
    passwordHash,
    ...(options.locale !== undefined && { locale: options.locale }),
    ...(options.by !== undefined && { by: options.by }),
  });
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
  readonly by?: SessionUser;
};

/**
 * Seed-Convenience für Sample-Server: Admin-User mit gehashtem
 * Password + N Tenants + N Memberships. Alles idempotent (Re-Run im
 * persistent-DB-Modus läuft durch). Liefert die userId zurück.
 */
export async function seedAdmin(db: DbConnection, options: SeedAdminOptions): Promise<string> {
  const by = options.by ?? TestUsers.systemAdmin;

  for (const m of options.memberships) {
    await seedTenant(db, { id: m.tenantId, key: m.tenantKey, name: m.tenantName, by });
  }

  const userId = await seedUserWithPassword(db, {
    email: options.email,
    password: options.password,
    displayName: options.displayName,
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

  return userId;
}
