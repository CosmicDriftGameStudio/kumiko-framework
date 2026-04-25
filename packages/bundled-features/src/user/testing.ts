// Testing-Helper fürs user-Feature. `seedUser` legt einen User direkt
// über den Event-Store-Executor an — gleicher Pfad wie der echte
// `UserHandlers.create`, aber ohne Access-Check und ohne ConflictError
// bei Duplikaten (idempotent: zweiter Aufruf für dieselbe Email
// liefert die existierende userId zurück).
//
// Warum nicht direkt `db.insert(userTable)`: das würde den Event-Store
// umgehen, also kein `user.created`-Event und keine MSP-Konsumenten
// (audit, search-index) sehen den Seed. Der Executor-Pfad emittiert
// das Event UND schreibt die Projection-Zeile in einer TX.

import {
  createEventStoreExecutor,
  createTenantDb,
  type DbConnection,
  fetchOne,
} from "@kumiko/framework/db";
import type { SessionUser } from "@kumiko/framework/engine";
import { TestUsers } from "@kumiko/framework/testing";
import { eq } from "drizzle-orm";
import { userEntity, userTable } from "./user-entity";

const userExecutor = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });

export type SeedUserOptions = {
  readonly email: string;
  readonly displayName: string;
  /** Optional bereits-gehashtes Passwort. Für plain-password-Tests
   *  besser den Convenience-Wrapper aus
   *  `@kumiko/bundled-features/auth-email-password/testing` nutzen,
   *  der argon2-Hashing übernimmt. */
  readonly passwordHash?: string;
  readonly locale?: string;
  readonly by?: SessionUser;
};

/**
 * Seed a user. Returns the userId (existing oder neu angelegt).
 * Idempotent über die `email`-Spalte: wenn ein User mit dieser Email
 * existiert, kommt seine ID zurück ohne neuen Insert.
 */
export async function seedUser(db: DbConnection, options: SeedUserOptions): Promise<string> {
  const by = options.by ?? TestUsers.systemAdmin;
  const tdb = createTenantDb(db, by.tenantId, "system");

  const existing = await fetchOne(db, userTable, eq(userTable["email"], options.email));
  if (existing) return existing["id"] as string;

  const result = await userExecutor.create(
    {
      email: options.email,
      displayName: options.displayName,
      ...(options.passwordHash !== undefined && { passwordHash: options.passwordHash }),
      ...(options.locale !== undefined && { locale: options.locale }),
    },
    by,
    tdb,
  );
  if (!result.isSuccess) {
    throw new Error(
      `seedUser failed: ${result.error.code} — ${JSON.stringify(result.error.details ?? {})}`,
    );
  }
  // Executor.create gibt das geschriebene Objekt zurück — id steckt drin.
  const created = result.data as { id: string };
  return created.id;
}
