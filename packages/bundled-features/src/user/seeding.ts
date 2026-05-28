// Testing-Helper fürs user-Feature. `seedUser` legt einen User direkt
// über den Event-Store-Executor an — gleicher Pfad wie der echte
// `UserHandlers.create`, aber ohne Access-Check und ohne ConflictError
// bei Duplikaten. Idempotent add-only über die `email`-Spalte: ein
// existierender User → return ohne Event. Kein update-Pfad — Profilfelder
// ändern läuft über den regulären Handler.
//
// Warum nicht direkt `db.insert(userTable)`: das würde den Event-Store
// umgehen, also kein `user.created`-Event und keine MSP-Konsumenten
// (audit, search-index) sehen den Seed. Der Executor-Pfad emittiert
// das Event UND schreibt die Projection-Zeile in einer TX.

import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createEventStoreExecutor,
  createTenantDb,
  type DbConnection,
} from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { TestUsers } from "@cosmicdrift/kumiko-framework/stack";
import { userEntity, userTable } from "./schema/user";

const userExecutor = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });

export type SeedUserOptions = {
  readonly email: string;
  readonly displayName: string;
  /** Optional bereits-gehashtes Passwort. Für plain-password-Tests
   *  besser den Convenience-Wrapper aus
   *  `@cosmicdrift/kumiko-bundled-features/auth-email-password/seeding` nutzen,
   *  der argon2-Hashing übernimmt. */
  readonly passwordHash?: string;
  readonly locale?: string;
  /** Globale Rollen — landen in users.roles als JSON-encoded string[].
   *  Werden vom login-handler in die Session-Roles parallel zu tenant-
   *  membership-roles gemerged. Default: leer-array. Typisches Beispiel:
   *  `["SystemAdmin"]` für den Plattform-Operator. */
  readonly roles?: readonly string[];
  /** Initial-State für emailVerified. Default false (Pflicht-Verify-Flow
   *  muss explizit "true" setzen wenn Email-Ownership schon bewiesen ist —
   *  z.B. Magic-Link-Signup, wo der User den Mail-Link klicken musste
   *  bevor sein Account überhaupt entsteht). */
  readonly emailVerified?: boolean;
  readonly by?: SessionUser;
};

/**
 * Seed a user. Returns the userId (existing oder neu angelegt).
 * Idempotent add-only über die `email`-Spalte: wenn ein User mit dieser
 * Email existiert, kommt seine ID zurück ohne neuen Insert.
 */
export async function seedUser(
  db: DbConnection,
  options: SeedUserOptions,
): Promise<{ id: string }> {
  const by = options.by ?? TestUsers.systemAdmin;
  // executor.create erwartet eine TenantDb (mit .insert()-API). User
  // ist zwar tenant-agnostic (kein tenant_id-Spalte), aber das runtime-
  // Interface braucht den Wrap.
  const tdb = createTenantDb(db, by.tenantId, "system");

  const existing = await fetchOne(db, userTable, { email: options.email });
  // @cast-boundary db-row: users.id ist uuid-Spalte (string), fetchOne
  // liefert die Projection-Row als Record<string, unknown>.
  if (existing) return { id: existing["id"] as string };

  const result = await userExecutor.create(
    {
      email: options.email,
      displayName: options.displayName,
      ...(options.passwordHash !== undefined && { passwordHash: options.passwordHash }),
      ...(options.locale !== undefined && { locale: options.locale }),
      ...(options.roles !== undefined && { roles: JSON.stringify(options.roles) }),
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
  return { id: extractId(result.data, "seedUser") };
}

// Extrahiert die `id`-Spalte aus dem executor.create-Result. Der
// Executor liefert ein Record<string, unknown> (die Projection-Row), in
// das die DB die Aggregat-id reinschreibt — wir prüfen runtime statt
// blindem `as { id: string }`-Cast, damit ein API-Vertragsbruch sofort
// als ehrlicher Throw rauskommt statt downstream als undefined-Bug.
function extractId(data: unknown, who: string): string {
  if (typeof data === "object" && data !== null && "id" in data) {
    const id = (data as { id: unknown }).id; // @cast-boundary engine-bridge
    if (typeof id === "string") return id;
  }
  throw new Error(`${who}: executor.create result has no string id (got ${JSON.stringify(data)})`);
}
