export const LETTER_FEATURE = "letter-foundation" as const;
export const LETTER_ENTITY = "letter" as const;
export const LETTER_PROVIDER_EXTENSION = "letterProvider" as const;

export const LETTER_SHIPPING_MODES = ["standard", "einwurf", "uebergabe", "rueckschein"] as const;
export type LetterShippingMode = (typeof LETTER_SHIPPING_MODES)[number];

// Only `formfrei` and `textform` can be sent: a printed letter without an own-hand signature never meets the written form.
export const LETTER_FORM_REQUIREMENTS = ["schriftform", "textform", "formfrei"] as const;
export type LetterFormRequirement = (typeof LETTER_FORM_REQUIREMENTS)[number];

export const LETTER_STATES = [
  "awaiting-approval",
  "approved",
  "submitting",
  "submission-unknown",
  "accepted",
  "on-hold",
  "sent",
  "failed",
  "canceled",
  "returned",
] as const;
export type LetterState = (typeof LETTER_STATES)[number];

export const LETTER_STATE = {
  awaitingApproval: "awaiting-approval",
  approved: "approved",
  submitting: "submitting",
  submissionUnknown: "submission-unknown",
  accepted: "accepted",
  onHold: "on-hold",
  sent: "sent",
  failed: "failed",
  canceled: "canceled",
  returned: "returned",
} as const satisfies Record<string, LetterState>;

// Which state a letter may move to from each state. "Delivered" is not a state of the letter.
export const LETTER_TRANSITIONS: Readonly<Record<LetterState, readonly LetterState[]>> = {
  "awaiting-approval": ["approved", "canceled"],
  approved: ["submitting", "canceled"],
  submitting: ["accepted", "failed", "submission-unknown"],
  "submission-unknown": ["accepted", "failed"],
  accepted: ["on-hold", "sent", "failed", "canceled"],
  "on-hold": ["accepted", "sent", "failed", "canceled"],
  sent: ["returned"],
  failed: [],
  canceled: [],
  returned: [],
};

export function isLetterTransitionAllowed(from: LetterState, to: LetterState): boolean {
  return LETTER_TRANSITIONS[from].includes(to);
}

export function isFinalLetterState(state: LetterState): boolean {
  return LETTER_TRANSITIONS[state].length === 0;
}

// Names the timestamp column that records entering each state; `awaiting-approval` is the creation time.
export const LETTER_STATE_TIMESTAMP_FIELD = {
  approved: "approvedAt",
  submitting: "submittedAt",
  "submission-unknown": "submissionUnknownAt",
  accepted: "acceptedAt",
  "on-hold": "onHoldAt",
  sent: "sentAt",
  failed: "failedAt",
  canceled: "canceledAt",
  returned: "returnedAt",
} as const satisfies Partial<Record<LetterState, string>>;

export const LETTER_PRICE_SOURCES = ["provider-api", "price-list", "simulated"] as const;
export type LetterPriceSource = (typeof LETTER_PRICE_SOURCES)[number];

export const LETTER_PROVIDER_STATES = [
  "queued",
  "not-found",
  "on-hold",
  "sent",
  "failed",
  "canceled",
  "returned",
] as const;
export type LetterProviderState = (typeof LETTER_PROVIDER_STATES)[number];

export const LETTER_STATE_OF_PROVIDER_STATE = {
  queued: "accepted",
  "on-hold": "on-hold",
  sent: "sent",
  failed: "failed",
  canceled: "canceled",
  returned: "returned",
} as const satisfies Record<Exclude<LetterProviderState, "not-found">, LetterState>;

export const LETTER_REJECTION_CODES = [
  "invalid-document",
  "invalid-address",
  "unsupported-shipping-mode",
  "insufficient-balance",
  "refused-by-provider",
] as const;
export type LetterRejectionCode = (typeof LETTER_REJECTION_CODES)[number];

export const LETTER_CANCEL_REFUSAL_REASONS = [
  "window_closed",
  "already_processed",
  "unknown_job",
] as const;
export type LetterCancelRefusalReason = (typeof LETTER_CANCEL_REFUSAL_REASONS)[number];

// Roles, because Kumiko rights are roles. TenantAdmin deliberately does not approve: sending costs money.
export const LETTER_ROLES = {
  approver: "LetterApprover",
} as const;

export const LETTER_ENV = {
  provider: "LETTER_PROVIDER",
  live: "LETTER_LIVE",
} as const;

export const LETTER_INMEMORY_PROVIDER = "inmemory" as const;

export const LETTER_CONFIG_KEYS = {
  monthlyCostLimitCents: "monthlyCostLimitCents",
} as const;

export const LETTER_CAP = {
  pages: "letter.pages",
  costNetCents: "letter.cost-net-cents",
  count: (mode: LetterShippingMode) => `letter.${mode}.count` as const,
  sheets: (mode: LetterShippingMode) => `letter.${mode}.sheets` as const,
} as const;

export const LETTER_EVENT_SHORT = {
  approved: "approved",
  submitting: "submitting",
  submissionUnknown: "submission-unknown",
  accepted: "accepted",
  onHold: "on-hold",
  sent: "sent",
  failed: "failed",
  canceled: "canceled",
  returned: "returned",
} as const;

export const LetterEvents = {
  approved: `${LETTER_FEATURE}:event:${LETTER_EVENT_SHORT.approved}`,
  submitting: `${LETTER_FEATURE}:event:${LETTER_EVENT_SHORT.submitting}`,
  submissionUnknown: `${LETTER_FEATURE}:event:${LETTER_EVENT_SHORT.submissionUnknown}`,
  accepted: `${LETTER_FEATURE}:event:${LETTER_EVENT_SHORT.accepted}`,
  onHold: `${LETTER_FEATURE}:event:${LETTER_EVENT_SHORT.onHold}`,
  sent: `${LETTER_FEATURE}:event:${LETTER_EVENT_SHORT.sent}`,
  failed: `${LETTER_FEATURE}:event:${LETTER_EVENT_SHORT.failed}`,
  canceled: `${LETTER_FEATURE}:event:${LETTER_EVENT_SHORT.canceled}`,
  returned: `${LETTER_FEATURE}:event:${LETTER_EVENT_SHORT.returned}`,
} as const;

export const LETTER_EVENT_OF_STATE = {
  approved: LetterEvents.approved,
  submitting: LetterEvents.submitting,
  "submission-unknown": LetterEvents.submissionUnknown,
  accepted: LetterEvents.accepted,
  "on-hold": LetterEvents.onHold,
  sent: LetterEvents.sent,
  failed: LetterEvents.failed,
  canceled: LetterEvents.canceled,
  returned: LetterEvents.returned,
} as const satisfies Partial<Record<LetterState, string>>;

export const LETTER_OUTCOME_AGGREGATE_TYPE = "letter-outcome" as const;

export const LetterHandlers = {
  approve: `${LETTER_FEATURE}:write:approve`,
  cancel: `${LETTER_FEATURE}:write:cancel`,
} as const;

export const LetterQueries = {
  preview: `${LETTER_FEATURE}:query:preview`,
  list: `${LETTER_FEATURE}:query:${LETTER_ENTITY}:list`,
  detail: `${LETTER_FEATURE}:query:${LETTER_ENTITY}:detail`,
} as const;

export const LETTER_SUBMISSION_STATUSES = ["claimed", "submitted"] as const;
export type LetterSubmissionStatus = (typeof LETTER_SUBMISSION_STATUSES)[number];

export const LETTER_SUBMISSION_TABLE = "store_letter_submissions" as const;

export const LetterErrors = {
  schriftformRejected: "letter_schriftform_not_possible",
  shippingModeUnsupported: "letter_shipping_mode_unsupported",
  tooManySheets: "letter_too_many_sheets",
  documentRejected: "letter_document_rejected",
  documentUnreadable: "letter_document_unreadable",
  noFiles: "letter_no_files",
  notFound: "letter_not_found",
  notAwaitingApproval: "letter_not_awaiting_approval",
  notCancelableHere: "letter_not_cancelable_here",
  cancelAfterAcceptanceUnavailable: "letter_cancel_after_acceptance_unavailable",
  transitionNotAllowed: "letter_transition_not_allowed",
  stateChanged: "letter_state_changed",
} as const;

export const LetterI18n = {
  schriftformRejected: "letter-foundation.errors.schriftformNotPossible",
  shippingModeUnsupported: "letter-foundation.errors.shippingModeUnsupported",
  tooManySheets: "letter-foundation.errors.tooManySheets",
  documentRejected: "letter-foundation.errors.documentRejected",
  documentUnreadable: "letter-foundation.errors.documentUnreadable",
  noFiles: "letter-foundation.errors.noFiles",
  notAwaitingApproval: "letter-foundation.errors.notAwaitingApproval",
  notCancelableHere: "letter-foundation.errors.notCancelableHere",
  cancelAfterAcceptanceUnavailable: "letter-foundation.errors.cancelAfterAcceptanceUnavailable",
  transitionNotAllowed: "letter-foundation.errors.transitionNotAllowed",
  stateChanged: "letter-foundation.errors.stateChanged",
  limitHint: "letter-foundation.preview.monthlyLimitExceeded",
} as const;
