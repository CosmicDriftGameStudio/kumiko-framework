import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createLongTextField,
  createSelectField,
  createTextField,
  createTimestampField,
} from "@cosmicdrift/kumiko-framework/engine";
import { WAITLIST_STATUS, type WaitlistStatus } from "./constants.js";

const WAITLIST_STATUS_OPTIONS = [
  WAITLIST_STATUS.Pending,
  WAITLIST_STATUS.Invited,
  WAITLIST_STATUS.Rejected,
] as const;

const OPEN_WAITLIST_STATUSES: readonly WaitlistStatus[] = [
  WAITLIST_STATUS.Pending,
  WAITLIST_STATUS.Invited,
];

// Entries still awaiting a decision; rejected is terminal.
export function isOpenWaitlistStatus(status: unknown): boolean {
  return OPEN_WAITLIST_STATUSES.some((open) => open === status);
}

// An entrant has no user account, so name/email/message are personal: "self" —
// the row's own id is its crypto-shredding subject. find: "fuzzy" keeps the
// blind-index equality lookup (dedupe, GDPR export by email) and full-text
// search alive; sortable stays off, the boot validator rejects it on subject fields.
// tenancy "global" + systemStream: entries are platform-wide and live on
// SYSTEM_TENANT_ID, which also lets the per-tenant GDPR hooks read them.
export const waitlistEntryEntity = createEntity({
  table: "read_waitlist_entries",
  description:
    "A prospect's signup on the platform waitlist, tracked through pending, invited and rejected status as admins process it; name, email and message are the entry's own personal data.",
  systemStream: true,
  tenancy: "global",
  fields: {
    name: createTextField({ required: true, personal: "self", find: "fuzzy", searchable: true }),
    email: createTextField({ required: true, personal: "self", find: "fuzzy", searchable: true }),
    company: createTextField({
      personal: false,
      reason: "is_business_data",
      searchable: true,
      sortable: true,
    }),
    portfolio: createTextField({ personal: false, reason: "is_business_data" }),
    message: createLongTextField({ personal: "self", find: "none" }),
    locale: createTextField({
      required: true,
      personal: false,
      reason: "is_ui_language_preference",
      sortable: true,
    }),
    status: createSelectField({
      options: WAITLIST_STATUS_OPTIONS,
      required: true,
      default: WAITLIST_STATUS.Pending,
      filterable: true,
      sortable: true,
    }),
    submittedAt: createTimestampField({
      personal: false,
      sortable: true,
      required: true,
      reason: "is_submission_timestamp",
    }),
    invitedAt: createTimestampField(),
    invitedBy: createTextField({ personal: false, reason: "is_admin_audit_id" }),
    // Not named tenantId: that is the framework's physical tenant column.
    linkedTenantId: createTextField({ personal: false, reason: "is_tenant_reference" }),
  },
});

export const waitlistEntryTable = buildEntityTable("waitlistEntry", waitlistEntryEntity);
