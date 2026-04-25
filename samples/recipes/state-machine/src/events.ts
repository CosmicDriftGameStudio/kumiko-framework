// Single source of truth for event names. Keeps the reducer and the feature
// in sync — both use INVOICE_EVENTS + eventName() to derive the qualified
// strings, so a rename here propagates everywhere instead of silently
// breaking the reducer.

export const FEATURE_NAME = "billing";
export const ENTITY_NAME = "invoice";

// Short event names — passed to r.defineEvent("...") in feature.ts. The
// framework qualifies them as "billing:event:<short>" at registration time.
export const INVOICE_EVENTS = {
  sent: "invoice-sent",
  markedPaid: "invoice-marked-paid",
  cancelled: "invoice-cancelled",
  reopened: "invoice-reopened",
  statusForced: "invoice-status-forced",
} as const;

// Qualifier used by the reducer to match events from the stream.
export function eventName(short: string): string {
  return `${FEATURE_NAME}:event:${short}`;
}

// The auto-generated event the executor emits on create — entity name dot
// "created", no feature prefix (executor convention).
export const INVOICE_CREATED_EVENT = `${ENTITY_NAME}.created` as const;
