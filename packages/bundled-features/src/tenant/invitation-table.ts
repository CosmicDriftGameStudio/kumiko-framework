// Tenant-Invitations: Pre-Membership-Records mit Magic-Link-Token-Flow.
//
// Lifecycle:
//   1. Admin invitet email → DB-Row entsteht mit status="pending",
//      Random-Token in Redis (signup-style bidirektional)
//   2. Mail an die invited Email mit Activation-URL
//   3. Klick auf Link → 3 Branches:
//      a) Eingeloggt + Email matched session-user → Membership-Add
//      b) Anonymous + Email existiert in users → Login → Auto-Accept
//      c) Anonymous + Email neu → Password setzen → user+membership entstehen
//   4. Bei Erfolg: status="accepted", token aus Redis gelöscht (single-use-burn)
//   5. Bei Cancel durch Admin: status="cancelled", token aus Redis gelöscht
//   6. Bei TTL-Ablauf: Redis räumt Token, DB-Row bleibt mit status="pending"
//      (Cleanup-Job marked sie als "expired" — separater Concern)
//
// Single-Truth für expiry: Redis-TTL. DB-row.expiresAt ist nur UI-
// Anzeige ("läuft in 6 Tagen ab"). Bei Lookup: pending in DB + token
// nicht mehr in Redis → effectively expired, accept schlägt fehl mit
// invalid-token.
//
// Idempotenz: zweiter invite für gleiche (tenantId, email) während
// pending → re-use existing row + refresh Redis-token + send mail
// (analog zu signup-Resend).

import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createSelectField,
  createTextField,
  createTimestampField,
} from "@cosmicdrift/kumiko-framework/engine";

// Status-const-Object damit Handler-Code keine Magic-Strings nutzt.
// Bei rename (z.B. "cancelled" → "revoked") fällt jeder caller auf
// einmal auf statt verstreut über 5 Stellen.
export const INVITATION_STATUS = {
  pending: "pending",
  accepted: "accepted",
  cancelled: "cancelled",
  expired: "expired",
} as const;
export type InvitationStatus = (typeof INVITATION_STATUS)[keyof typeof INVITATION_STATUS];

// Order MUSS bit-identisch zur DB-Migration sein. Object.values
// bewahrt insertion-order (JS-spec-stable für string-keys). Wenn
// jemand INVITATION_STATUS reordnet, generiert drizzle-kit eine
// neue Migration. Hardcoded-Tuple zur Sicherheit gegen versehentliches
// Refactoring der Object-Keys.
export const INVITATION_STATUSES = [
  INVITATION_STATUS.pending,
  INVITATION_STATUS.accepted,
  INVITATION_STATUS.cancelled,
  INVITATION_STATUS.expired,
] as const;

export const tenantInvitationEntity = createEntity({
  table: "read_tenant_invitations",
  fields: {
    // Eingeladene Email — case-insensitive normalisiert beim Insert.
    // PII bis zur Annahme (danach hat der User selbst seine email in users).
    email: createTextField({ required: true, maxLength: 320, pii: true }),
    // Membership-Rolle die dem User nach Accept gegeben wird. Default
    // im handler ist "Admin" (Co-Admin-Pattern für kleine Teams).
    role: createTextField({ required: true, maxLength: 50 }),
    // Lifecycle-State. Default "pending"; transitions:
    //   pending → accepted | cancelled | expired
    status: createSelectField({
      options: INVITATION_STATUSES,
      required: true,
      default: "pending",
    }),
    // userId des einladenden Admins (für Audit-Trail "wer hat eingeladen").
    invitedBy: createTextField({ required: true, pii: true }),
    // UI-Anzeige — Wahrheit liegt in Redis-TTL.
    expiresAt: createTimestampField({ required: true }),
  },
  // Eine Invitation-Row pro (tenantId, email). Bei Re-Invite (Admin
  // invitet zweite Mal nach Cancel/Accept) wird die existing row
  // updated: status pending → cancelled → pending zurück, expiresAt
  // refreshed. Verhindert Token-Doppel-Gabe + macht Resend-Idempotenz
  // im handler trivial.
  indexes: [
    {
      unique: true,
      columns: ["tenantId", "email"],
      name: "read_tenant_invitations_tenant_email_unique",
    },
  ],
});

export const tenantInvitationsTable = buildEntityTable("tenant-invitation", tenantInvitationEntity);
