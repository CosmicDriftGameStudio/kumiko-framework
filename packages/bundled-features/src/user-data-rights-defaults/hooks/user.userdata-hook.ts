import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createSystemUser,
  type UserDataDeleteHook,
  type UserDataExportHook,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  USER_ANONYMIZED_DISPLAY_NAME,
  USER_ANONYMIZED_EMAIL_DOMAIN,
  USER_ANONYMIZED_EMAIL_PREFIX,
  USER_DELETED_DISPLAY_NAME,
  USER_DELETED_EMAIL_PREFIX,
  USER_STATUS,
  userEntity,
  userTable,
} from "../../user";

// Forget writes go through the executor (events), not a raw UPDATE: a
// projection rebuild replays the events, so the anonymization survives it.
// A direct write would be wiped on rebuild — the Art.17 hole this fixes.
const crud = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });

// userData-Hook fuer user-entity (S2.H1).
//
// Export-Hook liefert Profil-Daten ohne security-sensitive Felder
// (passwordHash, roles, status — DSGVO Art. 20 ist Datenportabilitaet
// fuer das was der User selbst zur Verfuegung gestellt hat, nicht
// Lifecycle-Metadata oder Authorization-State).
//
// Delete-Hook anonymisiert PII + setzt status=deleted. Der eigentliche
// softDelete-Flag wird ueber drizzle's deletedAt-Column gesetzt; die
// Row bleibt fuer Audit-Trail erhalten (alle FK-Refs auf user.id
// bleiben gueltig). DSGVO-konform via PII-Anonymisierung.
//
// Strategy:
//   "delete":    softDelete + email/displayName/passwordHash leeren,
//                status=deleted (Login geblockt)
//   "anonymize": email/displayName auf Pseudonym, Row bleibt active
//                — fuer Cases wo User-Row als FK noch relevant ist
//                aber PII raus muss (z.B. anonymize mit blockDelete-
//                Frist auf einer FK-target-Entity)

export const userExportHook: UserDataExportHook = async (ctx) => {
  const row = (await fetchOne(ctx.db, userTable, { id: ctx.userId })) as {
    id: string;
    email: string;
    displayName: string;
    locale: string;
    emailVerified: boolean;
  } | null; // @cast-boundary db-runner

  if (!row) return null;

  return {
    entity: "user",
    rows: [
      {
        id: row.id,
        email: row.email,
        displayName: row.displayName,
        locale: row.locale,
        emailVerified: row.emailVerified,
      },
    ],
  };
};

export const userDeleteHook: UserDataDeleteHook = async (ctx, strategy) => {
  // Idempotent: zweiter Call findet die Row schon anonymized + skipt
  // implicit (UPDATE mit gleichen Werten). Memory feedback_event_store_
  // tenant_consistency: ctx.tenantId muss in der user-table-Zeile
  // korrelieren — user.id ist tenant-agnostic (User kann in mehreren
  // Tenants Member sein), kein tenantId-Filter noetig.

  // System actor + skipOptimisticLock: the forget pipeline has no read
  // version and writes privileged identity columns ("system" is privileged).
  const systemUser = createSystemUser(ctx.tenantId);

  if (strategy === "delete") {
    // PII raus + status=deleted (Login geblockt), dann softDelete — beides
    // als Events, damit ein Rebuild den Forget mitspielt. Row bleibt fuer
    // Audit/FK-Refs erhalten (softDelete, kein hard-delete).
    await crud.update(
      {
        id: ctx.userId,
        changes: {
          email: `${USER_DELETED_EMAIL_PREFIX}-${ctx.userId}@${USER_ANONYMIZED_EMAIL_DOMAIN}`,
          displayName: USER_DELETED_DISPLAY_NAME,
          passwordHash: null,
          status: USER_STATUS.Deleted,
        },
      },
      systemUser,
      ctx.db,
      { skipOptimisticLock: true },
    );
    await crud.delete({ id: ctx.userId }, systemUser, ctx.db);
  } else {
    // anonymize: PII raus, aber Row bleibt active (damit FK-References
    // weiter aufloesbar sind). Account ist effektiv weiter nutzbar
    // wenn der User sich neu authentifiziert — pragmatisch akzeptabel
    // weil "anonymize" auf user-entity ein seltener Edge-Case ist
    // (typisch hard-delete fuer User).
    await crud.update(
      {
        id: ctx.userId,
        changes: {
          email: `${USER_ANONYMIZED_EMAIL_PREFIX}-${ctx.userId}@${USER_ANONYMIZED_EMAIL_DOMAIN}`,
          displayName: USER_ANONYMIZED_DISPLAY_NAME,
        },
      },
      systemUser,
      ctx.db,
      { skipOptimisticLock: true },
    );
  }
};
