// Tenant invitations are pre-membership records using a magic-link token flow.
//
// Lifecycle:
//   1. An admin invites an email → a DB row is created with status="pending",
//      and a random token is stored in Redis (signup-style bidirectional flow).
//   2. An email containing the activation URL is sent to the invitee.
//   3. Clicking the link follows one of three branches:
//      a) Logged in + email matches the session user → membership is added
//      b) Anonymous + email exists in users → login → automatic acceptance
//      c) Anonymous + new email → set a password → user and membership are created
//   4. On success: status="accepted", and the Redis token is deleted (single-use).
//   5. When cancelled by an admin: status="cancelled", and the Redis token is deleted.
//   6. When the TTL expires: Redis removes the token, while the DB row remains
//      status="pending" (a cleanup job marks it as "expired" separately).
//
// Redis-TTL is the single source of truth for expiry. DB-row.expiresAt is only
// for UI display ("expires in 6 days"). On lookup, a pending DB row without
// a Redis token is effectively expired, so acceptance fails with invalid-token.
//
// Idempotency: a second invite for the same (tenantId, email) while pending
// reuses the existing row, refreshes the Redis token, and sends the email
// (analogous to signup resend).

import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createMultiSelectField,
  createNumberField,
  createSelectField,
  createTextField,
  createTimestampField,
} from "@cosmicdrift/kumiko-framework/engine";
// kumiko-lint-ignore cross-feature-import global-role options are owned by the user feature
import { GLOBAL_ROLE_OPTIONS } from "../user/web/constants.ts";

// The status constant object prevents handler code from using magic strings.
// If a value is renamed (for example, "cancelled" → "revoked"), every caller
// fails at once instead of having stale values scattered across five locations.
export const INVITATION_STATUS = {
  pending: "pending",
  accepted: "accepted",
  cancelled: "cancelled",
  expired: "expired",
} as const;
export type InvitationStatus = (typeof INVITATION_STATUS)[keyof typeof INVITATION_STATUS];

// The order MUST be bit-for-bit identical to the database migration. Object.values
// preserves insertion order (stable for string keys under the JS spec). Reordering
// INVITATION_STATUS generates a new drizzle-kit migration. The hardcoded tuple
// also guards against accidental refactoring of the object keys.
export const INVITATION_STATUSES = [
  INVITATION_STATUS.pending,
  INVITATION_STATUS.accepted,
  INVITATION_STATUS.cancelled,
  INVITATION_STATUS.expired,
] as const;

export const tenantInvitationEntity = createEntity({
  table: "read_tenant_invitations",
  fields: {
    // The invited email is normalized case-insensitively on insert.
    // It remains PII until acceptance; afterward, the user owns the email in users.
    email: createTextField({ required: true, maxLength: 320, personal: "self", find: "exact" }),
    // The membership role granted to the user on acceptance. The handler defaults
    // to "Admin" (a co-admin pattern for small teams).
    role: createTextField({
      required: true,
      maxLength: 50,
      personal: false,
      reason: "technical_reference",
    }),
    // Global (users.roles) roles granted on accept, on top of the membership
    // role. Only the system-only invite variant sets them; every tenant-admin
    // re-invite resets them to [] so a resend can never carry them over.
    globalRoles: createMultiSelectField({
      options: GLOBAL_ROLE_OPTIONS,
      default: [],
    }),
    // Lifecycle-State. Default "pending"; transitions:
    //   pending → accepted | cancelled | expired
    status: createSelectField({
      options: INVITATION_STATUSES,
      required: true,
      default: "pending",
    }),
    // ID of the inviting admin, retained for the audit trail ("who invited").
    // Self-referencing ownerField: the field's own value IS the owner userId.
    // lookupable: the delete hook filters "invitations sent by this user"
    // through the generated blind-index column instead of decrypting and scanning
    // the entire tenant (see user-data-rights-defaults' invitation hook).
    invitedBy: createTextField({
      required: true,
      personal: { of: "invitedBy" },
      find: "exact",
    }),
    // Version of the invitee's membership row when the invitation was issued
    // (0 = no membership yet). Accept compares it against the current version
    // to detect a membership decision made after the invite. NULL only on rows
    // issued before this field existed.
    membershipVersion: createNumberField({ integer: true, min: 0 }),
    // UI-Anzeige — Wahrheit liegt in Redis-TTL.
    expiresAt: createTimestampField({ required: true }),
  },
  // One invitation row per (tenantId, email). On re-invite after cancellation or
  // acceptance, the existing row is updated: status pending → cancelled → pending,
  // and expiresAt is refreshed. This prevents duplicate tokens and makes resend
  // idempotency trivial in the handler.
  indexes: [
    {
      unique: true,
      columns: ["tenantId", "email"],
      name: "read_tenant_invitations_tenant_email_unique",
    },
  ],
});

export const tenantInvitationsTable = buildEntityTable("tenant-invitation", tenantInvitationEntity);
