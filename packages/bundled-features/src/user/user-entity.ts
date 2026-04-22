import { buildDrizzleTable } from "@kumiko/framework/db";
import {
  access,
  createBooleanField,
  createEntity,
  createTextField,
} from "@kumiko/framework/engine";

// User entity — tenant-agnostic. A single user can belong to multiple tenants
// via tenantMemberships. No tenantId column on this table.
export const userEntity = createEntity({
  table: "users",
  idType: "uuid",
  softDelete: true,
  fields: {
    // Identity — anyone who can see the user can read the email, but only
    // privileged roles (SYSTEM auth code, SystemAdmin) may change it.
    email: createTextField({
      required: true,
      format: "email",
      maxLength: 320,
      access: { write: access.privileged },
    }),

    // Password material: only SYSTEM/SystemAdmin can read or write it.
    // auth-email-password reads it during login, writes it during registration
    // and password changes. Stripped from ordinary responses via read-access.
    passwordHash: createTextField({
      maxLength: 255,
      access: { read: access.privileged, write: access.privileged },
    }),

    // Profile — user-editable
    displayName: createTextField({ required: true, maxLength: 100, searchable: true }),
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
  },
});

export const userTable = buildDrizzleTable("user", userEntity);
