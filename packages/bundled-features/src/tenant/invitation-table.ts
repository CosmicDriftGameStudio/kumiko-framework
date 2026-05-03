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

import { buildDrizzleTable } from "@kumiko/framework/db";
import {
  createEntity,
  createSelectField,
  createTextField,
  createTimestampField,
} from "@kumiko/framework/engine";

export const INVITATION_STATUSES = ["pending", "accepted", "cancelled", "expired"] as const;

export const tenantInvitationEntity = createEntity({
  table: "read_tenant_invitations",
  fields: {
    // Eingeladene Email — case-insensitive normalisiert beim Insert.
    email: createTextField({ required: true, maxLength: 320 }),
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
    invitedBy: createTextField({ required: true }),
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

export const tenantInvitationsTable = buildDrizzleTable(
  "tenant-invitation",
  tenantInvitationEntity,
);
