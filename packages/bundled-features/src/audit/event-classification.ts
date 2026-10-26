// Events that are not entity lifecycle events (`<entity>.created` etc.) need an explicit
// audit stance: a label key for the log, or "technical" to hide them behind the facet.
// The boot-registry test fails for a bundled event type that has neither.

import { WORKFLOW_SYSTEM_EVENT_DEFS } from "@cosmicdrift/kumiko-framework/engine";
import { ESCAPE_HATCH_USED_EVENT } from "./escape-hatch-audit-sink.ts";

export const TECHNICAL_EVENT = "technical" as const;

export type AuditEventStance = typeof TECHNICAL_EVENT | { readonly labelKey: string };

const label = (name: string): AuditEventStance => ({ labelKey: `audit.log.event.${name}` });

export const AUDIT_EVENT_STANCES: Readonly<Record<string, AuditEventStance>> = {
  [ESCAPE_HATCH_USED_EVENT]: TECHNICAL_EVENT,
  "delivery:event:attempt": TECHNICAL_EVENT,
  "delivery:event:attempt-address-erased": TECHNICAL_EVENT,
  "cap-counter:event:rolling-incremented": TECHNICAL_EVENT,
  "cap-counter:event:rolling-released": TECHNICAL_EVENT,
  "inbound-mail-foundation:event:inbound-message-received": TECHNICAL_EVENT,
  "inbound-mail-foundation:event:inbound-message-content-fetched": TECHNICAL_EVENT,
  "inbound-mail-foundation:event:mail-thread-updated": TECHNICAL_EVENT,
  "document-ingest-foundation:event:document-ingest-requested": TECHNICAL_EVENT,
  "document-ingest-foundation:event:document-ingest-skipped": TECHNICAL_EVENT,
  "tenant-lifecycle:event:tenant-destruction-stage-started": TECHNICAL_EVENT,
  "tenant-lifecycle:event:tenant-destruction-stage-succeeded": TECHNICAL_EVENT,
  "tenant-lifecycle:event:tenant-destruction-stage-progressed": TECHNICAL_EVENT,
  "tenant-lifecycle:event:tenant-destruction-stage-failed": TECHNICAL_EVENT,
  "tenant-lifecycle:event:tenant-destruction-stage-abandoned": TECHNICAL_EVENT,

  "custom-fields:event:custom-field-set": label("custom-field-set"),
  "custom-fields:event:custom-field-cleared": label("custom-field-cleared"),
  "custom-fields:event:field-definition-deleted": label("field-definition-deleted"),
  "secrets:event:read": label("secret-read"),
  "sessions:event:session-revoked": label("session-revoked"),
  "crypto-shredding:event:subject-forgotten": label("subject-forgotten"),
  "crypto-shredding:event:forget-denied": label("forget-denied"),
  "personal-access-tokens:event:pat-revoked": label("pat-revoked"),
  "inbound-mail-foundation:event:mail-account-connected": label("mail-account-connected"),
  "inbound-mail-foundation:event:mail-account-updated": label("mail-account-updated"),
  "inbound-mail-foundation:event:mail-account-disconnected": label("mail-account-disconnected"),
  "billing-foundation:event:subscription-created": label("subscription-created"),
  "billing-foundation:event:subscription-updated": label("subscription-updated"),
  "billing-foundation:event:subscription-canceled": label("subscription-canceled"),
  "billing-foundation:event:invoice-paid": label("invoice-paid"),
  "billing-foundation:event:invoice-payment-failed": label("invoice-payment-failed"),
  "billing-foundation:event:payment-received": label("payment-received"),
  "billing-foundation:event:checkout-consent-recorded": label("checkout-consent-recorded"),
  "billing-foundation:event:contract-confirmation-issued": label("contract-confirmation-issued"),
  "billing-foundation:event:contract-termination-requested": label(
    "contract-termination-requested",
  ),
  "billing-foundation:event:contract-termination-declared": label("contract-termination-declared"),
  "billing-foundation:event:contract-termination-unmatched": label(
    "contract-termination-unmatched",
  ),
  "billing-foundation:event:contract-termination-revoked": label("contract-termination-revoked"),
  "tenant-lifecycle:event:destruction-requested": label("destruction-requested"),
  "tenant-lifecycle:event:destruction-cancelled": label("destruction-cancelled"),
  "tenant-lifecycle:event:tenant-destruction-started": label("tenant-destruction-started"),
  "tenant-lifecycle:event:tenant-destruction-completed": label("tenant-destruction-completed"),
  "tenant-lifecycle:event:tenant-destruction-failed": label("tenant-destruction-failed"),
  "tenant-handover:event:claimed": label("tenant-handover-claimed"),
  "waitlist:event:exported": label("waitlist-exported"),
  "waitlist:event:purged": label("waitlist-purged"),
  "feature-toggles:event:toggle-set": label("feature-toggle-set"),
};

// Streams whose payload holds rows that only a SystemAdmin or a single owner may read: a
// readiness probe run stores system-probe and personal-mailbox results next to the tenant's
// own. Below SystemAdmin the audit log leaves these streams out entirely.
export const SYSTEM_ADMIN_ONLY_AGGREGATE_TYPES: readonly string[] = ["probe-run"];

// Framework system events (kumiko:system:*) are engine plumbing, never audit-worthy on their own.
export const FRAMEWORK_SYSTEM_EVENT_TYPES: readonly string[] = [
  ...WORKFLOW_SYSTEM_EVENT_DEFS.keys(),
];

export const TECHNICAL_EVENT_TYPES: readonly string[] = [
  ...Object.entries(AUDIT_EVENT_STANCES)
    .filter(([, stance]) => stance === TECHNICAL_EVENT)
    .map(([type]) => type),
  ...FRAMEWORK_SYSTEM_EVENT_TYPES,
];

export function eventLabelKeyOf(type: string): string | null {
  const stance = AUDIT_EVENT_STANCES[type];
  return stance === undefined || stance === TECHNICAL_EVENT ? null : stance.labelKey;
}
