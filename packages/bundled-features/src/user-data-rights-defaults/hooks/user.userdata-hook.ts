import { createEventStoreExecutor, WritePurposes } from "@cosmicdrift/kumiko-framework/db";
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
} from "../../user/index.ts";

// Forget writes go through the executor (events), not a raw UPDATE: a
// projection rebuild replays the events, so the anonymization survives it.
// A direct write would be wiped on rebuild — the Art.17 hole this fixes.
const crud = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });

// The user-data hook for the user entity.
//
// The export hook returns profile data without security-sensitive fields
// (passwordHash, roles, status — GDPR Art. 20 covers portability of data
// the user provided themselves, not lifecycle metadata or authorization
// state).
//
// The delete hook anonymizes PII and sets status=deleted. The actual
// softDelete flag is set through Drizzle's deletedAt column; the row remains
// for the audit trail (all foreign-key references to user.id remain valid).
// This complies with GDPR through PII anonymization.
//
// Strategy:
//   "delete":    softDelete + clear email/displayName/passwordHash,
//                status=deleted (login blocked)
//   "anonymize": replace email/displayName with pseudonyms; the row remains
//                active when the user row is still needed as a foreign-key
//                target but PII must be removed (for example, anonymization
//                with a blockDelete deadline on a foreign-key target entity)

export const userExportHook: UserDataExportHook = async (ctx) => {
  const row = await ctx.db.fetchOne<{
    id: string;
    email: string;
    displayName: string;
    locale: string | null;
    emailVerified: boolean;
  }>(userTable, { id: ctx.userId });

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
  // Idempotent: a second call finds the row already anonymized and skips
  // implicitly (UPDATE with the same values). Event-store tenant
  // consistency requires ctx.tenantId to correlate with the row in
  // the user table — user.id is tenant-agnostic (a user can be a member in
  // multiple tenants), so no tenantId filter is needed.

  // System actor + skipOptimisticLock: the forget pipeline has no read
  // version and writes privileged identity columns ("system" is privileged).
  // crud.update extracts the raw connection from ctx.db via tenantDbRunner
  // and enforces global-entity tenancy itself (isForeignTenantOnGlobalEntity),
  // so it reaches the row by id regardless of which tenant pass triggered it —
  // TenantDb's own tenant-scoping narrowing never applies to executor writes.
  const systemUser = createSystemUser(ctx.tenantId);

  if (strategy === "delete") {
    // Remove PII and set status=deleted via an event, so a rebuild replays
    // the forget operation. Do NOT use softDelete: user is systemStream (a
    // tenant-agnostic row), and forgetting runs once per tenant. Setting
    // isDeleted would cause loadById (isDeleted:false) to miss the row for
    // the second tenant (not_found). status=Deleted blocks login; the row
    // remains findable and idempotent across tenant passes, as with the old
    // raw UPDATE.
    await crud.update(
      {
        id: ctx.userId,
        changes: {
          email: `${USER_DELETED_EMAIL_PREFIX}-${ctx.userId}@${USER_ANONYMIZED_EMAIL_DOMAIN}`,
          displayName: USER_DELETED_DISPLAY_NAME,
          passwordHash: null,
          status: USER_STATUS.Deleted,
          // deleted_at as an audit timestamp only — NOT isDeleted (see above).
          // Frozen into the event payload, so a rebuild replays the same value.
          deletedAt: Temporal.Now.instant(),
        },
      },
      systemUser,
      ctx.db,
      { skipOptimisticLock: true, writePurpose: WritePurposes.erasure },
    );
  } else {
    // Anonymize PII, but keep the row active so foreign-key references
    // remain resolvable. The account can still be used if the user
    // authenticates again — pragmatically acceptable because "anonymize"
    // on the user entity is a rare edge case (hard deletion is typical for
    // users).
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
      { skipOptimisticLock: true, writePurpose: WritePurposes.erasure },
    );
  }
};
