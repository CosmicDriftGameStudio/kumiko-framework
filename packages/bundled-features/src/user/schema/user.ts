import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  createBooleanField,
  createDerivedField,
  createEntity,
  createMultiSelectField,
  createSelectField,
  createTextField,
  createTimestampField,
  createTzField,
} from "@cosmicdrift/kumiko-framework/engine";
import { GLOBAL_ROLE_OPTIONS } from "../web/constants.ts";

/**
 * User lifecycle status. This is the single source of truth used by the
 * auth middleware, forget job, and restriction handler instead of duplicated
 * magic strings, following the same pattern as ROLES.SystemAdmin.
 */
export const USER_STATUS = {
  Active: "active",
  Restricted: "restricted",
  DeletionRequested: "deletionRequested",
  Deleted: "deleted",
} as const;

export type UserStatus = (typeof USER_STATUS)[keyof typeof USER_STATUS];

/**
 * Display strings anonymized by userDeleteHook. Constants keep i18n mapping
 * possible and prevent drift. The default is German; app authors can
 * translate it through the i18n system if desired.
 */
export const USER_DELETED_DISPLAY_NAME = "[Geloescht]";
export const USER_ANONYMIZED_DISPLAY_NAME = "[Anonymisiert]";

/**
 * Email pseudonyms used after forgetting. `<prefix>-<userId>@anonymized.invalid`
 * — the userId suffix is permitted as a pseudo-audit marker for operator
 * tracing; the user ID itself is a UUID, not PII.
 * The `.invalid` TLD is reserved by RFC2606, so the address can never be
 * delivered.
 */
export const USER_DELETED_EMAIL_PREFIX = "deleted";
export const USER_ANONYMIZED_EMAIL_PREFIX = "anonymized";
export const USER_ANONYMIZED_EMAIL_DOMAIN = "anonymized.invalid";

// Tuple form for createSelectField (requires a non-empty readonly tuple).
// Object.values(USER_STATUS) would be string[]; the static tuple preserves
// type safety.
const USER_STATUS_OPTIONS = [
  USER_STATUS.Active,
  USER_STATUS.Restricted,
  USER_STATUS.DeletionRequested,
  USER_STATUS.Deleted,
] as const;

// User entity — tenant-agnostic. A single user can belong to multiple tenants
// via tenantMemberships. No tenantId column on this table.
export const userEntity = createEntity({
  description:
    "A person's platform-wide identity: login email and credentials, display name, locale and time zone, account status and global roles, shared across every tenant they belong to.",
  table: "read_users",
  softDelete: true,
  // Tenant-independent identity aggregate — its event stream lives on
  // SYSTEM_TENANT_ID instead of whichever tenant happened to create it.
  systemStream: true,
  // Every row lives on SYSTEM_TENANT_ID; writes with another tenantId are
  // rejected.
  tenancy: "global",
  fields: {
    // Identity — anyone who can see the user can read the email, but only
    // privileged roles (SYSTEM auth code, SystemAdmin) may change it.
    email: createTextField({
      required: true,
      format: "email",
      maxLength: 320,
      personal: "self",
      // Roster search needs email hits — fuzzy expands to lookupable+searchable.
      find: "fuzzy",
      access: { write: access.privileged },
    }),

    // Password material: only SYSTEM/SystemAdmin can read or write it.
    // auth-email-password reads it during login, writes it during registration
    // and password changes. Stripped from ordinary responses via read-access.
    // Kept Klasse 1 deliberately: find-for-auth.query.ts reads this row via a
    // raw fetchOne (bypassing the executor's decrypt on purpose, so a
    // SystemAdmin session's ordinary query path never sees it) — a subject
    // annotation would make the executor encrypt it on write while this
    // login-critical read stays raw, so verifyPassword would compare a
    // plaintext password against ciphertext and every login would fail once
    // a KMS is active. Already an irreversible one-way hash, access-gated to
    // privileged read/write. Needs a blind-index lookup before this can be
    // subject-encrypted.
    passwordHash: createTextField({
      maxLength: 255,
      access: { read: access.privileged, write: access.privileged },
      personal: false,
      reason: "credential_hash_read_without_decrypt",
    }),

    // Profile — user-editable. Real name in most apps → PII. Searchable via
    // the derived Meili index; events/projection stay ciphertext.
    displayName: createTextField({
      required: true,
      maxLength: 100,
      personal: "self",
      find: "fuzzy",
    }),
    // No default here — tenant-settings owns the app-wide locale default.
    locale: createTextField({ maxLength: 10, personal: false, reason: "technical_reference" }),
    // No default here — mirrors locale: ctx.tz falls back to tenant.timezone
    // (then "UTC") when unset, see buildHandlerContext.
    timezone: createTzField(),

    // Which tenant should this user land in on next login. Set by the login
    // handler (SYSTEM), read by the login flow + UI for deep-linking.
    // UUID string matching tenants.id; createTextField stores it as text.
    lastActiveTenantId: createTextField({
      maxLength: 36,
      access: { write: access.privileged },
      personal: false,
      reason: "technical_reference",
    }),

    // Email-verification flag — flipped to true by the verify-email handler
    // after an HMAC-signed token roundtrip. Readable by anyone who can see
    // the user row; writable only by privileged (system) callers so a user
    // can't self-mark themselves verified. Login can be config-gated to
    // refuse a session while this is false (strict mode).
    emailVerified: createBooleanField({
      default: false,
      sortable: true,
      access: { write: access.privileged },
    }),

    // Global (cross-tenant) roles — parallel to tenantMemberships.roles.
    // multiSelect stores jsonb string[]; login merges these with membership
    // roles into the session. Write access privileged: users cannot self-elevate
    // to SystemAdmin. Closed options = only assignable platform roles.
    roles: createMultiSelectField({
      options: GLOBAL_ROLE_OPTIONS,
      default: [],
      access: { write: access.privileged },
    }),

    // User lifecycle status for user-data-rights.
    //   - "active":            Normal state; all operations are allowed.
    //   - "restricted":        Art. 18 restriction — login is blocked and every
    //                          live session is rejected by sessionChecker
    //                          ("blocked"). Recovery via lift-restriction
    //                          (openToAll, independent of the session).
    //   - "deletionRequested": delete-account was called and gracePeriodEnd set;
    //                          login is blocked. Existing sessions remain LIVE
    //                          (reversible), so the user can return to "active"
    //                          via cancel-deletion.
    //   - "deleted":           Forget was executed after the grace period; the row
    //                          was anonymized via softDelete. Login is blocked and
    //                          the session is "blocked".
    //
    // Write access is privileged: only the request-deletion / restrict / lift /
    // execute-forget handlers (all in SYSTEM context) may change the status.
    status: createSelectField({
      required: true,
      default: USER_STATUS.Active,
      options: USER_STATUS_OPTIONS,
      sortable: true,
      access: { write: access.privileged },
    }),

    // When a pending forget may actually be executed.
    // The user-data-rights cron job checks daily whether gracePeriodEnd < now()
    // and then triggers the EXT_USER_DATA hooks. NULL means no forget is pending;
    // delete-account sets it to
    // (= now() + Compliance-Profile.userRights.gracePeriod), and
    // cancel-deletion resets it.
    gracePeriodEnd: createTimestampField({
      access: { write: access.privileged },
    }),

    // Replay protection for the anonymous email-token deletion flow.
    // request-deletion-by-email sets one UUID per email request, and
    // cancel-deletion clears it. confirm-deletion-by-token incorporates this ID
    // into the token's HMAC purpose, so a token replayed after cancellation
    // (while still within its TTL) no longer verifies against the cleared or
    // renewed ID. NULL means no email request is pending.
    pendingDeletionRequestId: createTextField({
      maxLength: 36,
      access: { write: access.privileged },
      personal: false,
      reason: "technical_reference",
    }),
  },
  // email is `personal: "self", find: "fuzzy"` (lookupable), so the column holds
  // per-row ciphertext: a plain unique index on it can't catch duplicates.
  // `unique: true` over a lookupable column makes buildEntityTable /
  // deriveEntityTableMeta emit a second, partial unique index over the
  // deterministic `emailBidx` companion column (WHERE email_bidx IS NOT
  // NULL — erased/key-less rows stay excluded), which is what actually
  // closes the TOCTOU race between two concurrent user:create calls.
  // Global (not tenant-scoped): user is a tenant-agnostic identity
  // aggregate (systemStream: true) — a composite (tenantId, email) would
  // leave the same email resolvable twice.
  // Filled by user:list / user:detail enrichment (membership → tenant names).
  // derive() is a placeholder — list/detail handlers overwrite after the join.
  derivedFields: {
    tenants: createDerivedField({
      valueType: "text",
      derive: () => "",
    }),
  },
  indexes: [{ columns: ["email"], unique: true, name: "read_users_email_unique" }],
});

export const userTable = buildEntityTable("user", userEntity);
