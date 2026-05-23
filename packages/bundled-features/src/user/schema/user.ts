import { buildDrizzleTable } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  createBooleanField,
  createEntity,
  createSelectField,
  createTextField,
  createTimestampField,
} from "@cosmicdrift/kumiko-framework/engine";

/**
 * User-Lifecycle-Status (S2.U1). Single source of truth — Auth-Middleware
 * (S2.U6), Forget-Job (S2.U5) und Restriction-Handler nutzen diese
 * Constants statt Magic-Strings (Memory feedback_role_naming_drift —
 * gleiches Pattern wie ROLES.SystemAdmin).
 */
export const USER_STATUS = {
  Active: "active",
  Restricted: "restricted",
  DeletionRequested: "deletionRequested",
  Deleted: "deleted",
} as const;

export type UserStatus = (typeof USER_STATUS)[keyof typeof USER_STATUS];

/**
 * Anonymize-Display-Strings fuer userDeleteHook (S2.H1). Constants statt
 * Magic-Strings damit i18n-Mapping moeglich + drift-fest. Default-DE,
 * App-Author kann via i18n-System uebersetzen wenn gewuenscht.
 */
export const USER_DELETED_DISPLAY_NAME = "[Geloescht]";
export const USER_ANONYMIZED_DISPLAY_NAME = "[Anonymisiert]";

/**
 * Email-Pseudonyme nach Forget. `<prefix>-<userId>@anonymized.invalid`
 * — der userId-Suffix ist als Pseudo-Audit-Marker fuer Operator
 * (Tracing-fall) erlaubt; user-id selbst ist UUID, kein PII.
 * `.invalid`-TLD ist RFC2606-reserviert — niemals deliverbare Email.
 */
export const USER_DELETED_EMAIL_PREFIX = "deleted";
export const USER_ANONYMIZED_EMAIL_PREFIX = "anonymized";
export const USER_ANONYMIZED_EMAIL_DOMAIN = "anonymized.invalid";

// Tuple form fuer createSelectField (erfordert non-empty readonly tuple).
// Object.values(USER_STATUS) waere string[] — statisches Tuple ist
// type-sicher.
const USER_STATUS_OPTIONS = [
  USER_STATUS.Active,
  USER_STATUS.Restricted,
  USER_STATUS.DeletionRequested,
  USER_STATUS.Deleted,
] as const;

// User entity — tenant-agnostic. A single user can belong to multiple tenants
// via tenantMemberships. No tenantId column on this table.
export const userEntity = createEntity({
  table: "read_users",
  softDelete: true,
  fields: {
    // Identity — anyone who can see the user can read the email, but only
    // privileged roles (SYSTEM auth code, SystemAdmin) may change it.
    email: createTextField({
      required: true,
      format: "email",
      maxLength: 320,
      pii: true,
      access: { write: access.privileged },
    }),

    // Password material: only SYSTEM/SystemAdmin can read or write it.
    // auth-email-password reads it during login, writes it during registration
    // and password changes. Stripped from ordinary responses via read-access.
    passwordHash: createTextField({
      maxLength: 255,
      access: { read: access.privileged, write: access.privileged },
    }),

    // Profile — user-editable. Display-name is real-name in most apps,
    // so treat as PII for DSGVO export/forget pipelines.
    displayName: createTextField({ required: true, maxLength: 100, searchable: true, pii: true }),
    locale: createTextField({ maxLength: 10, default: "de" }),

    // Which tenant should this user land in on next login. Set by the login
    // handler (SYSTEM), read by the login flow + UI for deep-linking.
    // UUID string matching tenants.id; createTextField stores it as text.
    lastActiveTenantId: createTextField({
      maxLength: 36,
      access: { write: access.privileged },
    }),

    // Email-verification flag — flipped to true by the verify-email handler
    // after an HMAC-signed token roundtrip. Readable by anyone who can see
    // the user row; writable only by privileged (system) callers so a user
    // can't self-mark themselves verified. Login can be config-gated to
    // refuse a session while this is false (strict mode).
    emailVerified: createBooleanField({
      default: false,
      access: { write: access.privileged },
    }),

    // Globale Rollen — parallel zu tenantMemberships.roles. JSON-encoded
    // string[]; parseRoles() deserialisiert beim Read. Login-Handler mergt
    // diese Rollen mit den tenant-membership-roles in die Session — so
    // sind sie tenant-unabhängig (z.B. SystemAdmin, BillingAdmin). Default
    // "[]" damit die Session-Roles-Merge keinen NULL-Branch braucht.
    // Schreibrecht privileged: ein User darf sich nicht selbst zum
    // SystemAdmin machen.
    roles: createTextField({
      required: true,
      default: "[]",
      access: { write: access.privileged },
    }),

    // S2.U1: User-Lifecycle-Status für user-data-rights (Sprint 2).
    //   - "active":            Normaler State, alle Operationen erlaubt
    //   - "restricted":        Art. 18 Restriction — Auth-Middleware blockiert
    //                          Schreib-Endpoints, Read bleibt erlaubt damit
    //                          User das Banner sieht + lift-restriction klicken kann
    //   - "deletionRequested": delete-account aufgerufen, gracePeriodEnd
    //                          gesetzt, User kann via cancel-deletion zurueck
    //                          auf "active". Auth-Middleware blockiert wie
    //                          "restricted".
    //   - "deleted":           Forget executed nach Grace, Row anonymisiert via
    //                          softDelete. Auth-Middleware blockt Login.
    //
    // Schreibrecht privileged: nur die request-deletion / restrict / lift /
    // execute-forget-Handler (alle SYSTEM-context) duerfen status flippen.
    status: createSelectField({
      required: true,
      default: USER_STATUS.Active,
      options: USER_STATUS_OPTIONS,
      access: { write: access.privileged },
    }),

    // Wann darf der pending-Forget tatsaechlich ausgefuehrt werden?
    // Cron-Job in user-data-rights checkt taeglich gracePeriodEnd < now()
    // und triggert dann die EXT_USER_DATA-Hooks. NULL solange kein
    // Forget pending — wird beim delete-account-Call gesetzt
    // (= now() + Compliance-Profile.userRights.gracePeriod), beim
    // cancel-deletion zurueckgesetzt.
    gracePeriodEnd: createTimestampField({
      access: { write: access.privileged },
    }),
  },
});

export const userTable = buildDrizzleTable("user", userEntity);
