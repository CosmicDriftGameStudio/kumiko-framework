export const LETTER_FEATURE = "letter-foundation" as const;
export const LETTER_ENTITY = "letter" as const;
export const LETTER_PROVIDER_EXTENSION = "letterProvider" as const;

export const LETTER_SHIPPING_MODES = ["standard", "einwurf", "uebergabe", "rueckschein"] as const;
export type LetterShippingMode = (typeof LETTER_SHIPPING_MODES)[number];

// `flat` is an unfolded A4 sheet in a C4 envelope, for contracts and other documents that must not be folded.
export const LETTER_ENVELOPES = ["folded", "flat"] as const;
export type LetterEnvelope = (typeof LETTER_ENVELOPES)[number];

// A printed letter never meets the written form (a handwritten signature). `schriftform` is therefore refused
// unless the caller states that the user was told and accepted the risk (`formRiskAcknowledged`); the app decides, not this feature.
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
  approved: ["submitting", "failed", "canceled"],
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

/** Qualified name of the limit key, which is how the config feature's `set` handler and accessor address it. */
export const LETTER_MONTHLY_COST_LIMIT_CONFIG =
  `${LETTER_FEATURE}:config:monthly-cost-limit-cents` as const;

export const LETTER_CAP = {
  pages: "letter.pages",
  costNetCents: "letter.cost-net-cents",
  count: (mode: LetterShippingMode) => `letter.${mode}.count` as const,
  sheets: (mode: LetterShippingMode) => `letter.${mode}.sheets` as const,
} as const;

export const LetterEvents = {
  approved: `${LETTER_FEATURE}:event:${LETTER_STATE.approved}`,
  submitting: `${LETTER_FEATURE}:event:${LETTER_STATE.submitting}`,
  submissionUnknown: `${LETTER_FEATURE}:event:${LETTER_STATE.submissionUnknown}`,
  accepted: `${LETTER_FEATURE}:event:${LETTER_STATE.accepted}`,
  onHold: `${LETTER_FEATURE}:event:${LETTER_STATE.onHold}`,
  sent: `${LETTER_FEATURE}:event:${LETTER_STATE.sent}`,
  failed: `${LETTER_FEATURE}:event:${LETTER_STATE.failed}`,
  canceled: `${LETTER_FEATURE}:event:${LETTER_STATE.canceled}`,
  returned: `${LETTER_FEATURE}:event:${LETTER_STATE.returned}`,
} as const;

export const LETTER_OUTCOME_AGGREGATE_TYPE = "letter-outcome" as const;

export const LetterHandlers = {
  approve: `${LETTER_FEATURE}:write:approve`,
  cancel: `${LETTER_FEATURE}:write:cancel`,
  resolveUnknown: `${LETTER_FEATURE}:write:resolve-unknown`,
} as const;

export const LetterInternalHandlers = {
  startSubmission: `${LETTER_FEATURE}:write:start-submission`,
  recordAcceptance: `${LETTER_FEATURE}:write:record-acceptance`,
  recordRejection: `${LETTER_FEATURE}:write:record-rejection`,
  markSubmissionUnknown: `${LETTER_FEATURE}:write:mark-submission-unknown`,
  applyProviderStatus: `${LETTER_FEATURE}:write:apply-provider-status`,
} as const;

export const LETTER_JOB = {
  submit: "submit",
  poll: "poll",
} as const;

export const LetterJobs = {
  submit: `${LETTER_FEATURE}:job:${LETTER_JOB.submit}`,
  poll: `${LETTER_FEATURE}:job:${LETTER_JOB.poll}`,
} as const;

// Time to cancel without touching the provider: the handover job waits this long after approval.
export const LETTER_HANDOVER_HOLD_MS = 5 * 60_000;

// The provider allows 120 requests per minute for the whole account and a run spends about one
// request per letter. 50 per tenant and run keeps a single tenant far below that; many tenants
// polling together can still exceed it. The way out is the provider's list query: one request for all letters.
export const LETTER_POLL_LIMIT_PER_RUN = 50;

// A sent letter is polled this long after sending, for the tracking number and a return.
export const LETTER_SENT_TRACKING_DAYS = 14;

export const LETTER_ADDRESS_MISMATCH_FIELD = "addressMismatch" as const;

export const LETTER_FAILURE_REASONS = [
  "monthly-limit",
  "rejected-by-provider",
  "not-found-at-provider",
  "failed-at-provider",
  "address-mismatch",
  "resolved-by-operator",
  "document-unreadable",
] as const;
export type LetterFailureReason = (typeof LETTER_FAILURE_REASONS)[number];

export const LETTER_FAILURE_REASON = {
  monthlyLimit: "monthly-limit",
  rejectedByProvider: "rejected-by-provider",
  notFoundAtProvider: "not-found-at-provider",
  failedAtProvider: "failed-at-provider",
  addressMismatch: "address-mismatch",
  resolvedByOperator: "resolved-by-operator",
  documentUnreadable: "document-unreadable",
} as const satisfies Record<string, LetterFailureReason>;

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
  envelopeUnsupported: "letter_envelope_unsupported",
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
  notSubmissionUnknown: "letter_not_submission_unknown",
  cancelWindowClosed: "letter_cancel_window_closed",
  cancelAlreadyProcessed: "letter_cancel_already_processed",
  cancelUnknownJob: "letter_cancel_unknown_job",
} as const;

export const LetterI18n = {
  schriftformRejected: "letter-foundation.errors.schriftformNotPossible",
  shippingModeUnsupported: "letter-foundation.errors.shippingModeUnsupported",
  envelopeUnsupported: "letter-foundation.errors.envelopeUnsupported",
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
  notSubmissionUnknown: "letter-foundation.errors.notSubmissionUnknown",
  cancelWindowClosed: "letter-foundation.errors.cancelWindowClosed",
  cancelAlreadyProcessed: "letter-foundation.errors.cancelAlreadyProcessed",
  cancelUnknownJob: "letter-foundation.errors.cancelUnknownJob",
} as const;
