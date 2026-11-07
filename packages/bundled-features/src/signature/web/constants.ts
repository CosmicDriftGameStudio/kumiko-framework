// Pure string constants, safe for browser code (static-sign imports this file).
export const SIGNATURE_FEATURE = "signature" as const;

export const SIGNATURE_REQUEST_ENTITY = "signatureRequest" as const;
export const SIGNATURE_SIGNER_ENTITY = "signatureSigner" as const;

export const SIGNATURE_LEVEL = {
  Simple: "simple",
} as const;

export type SignatureLevel = (typeof SIGNATURE_LEVEL)[keyof typeof SIGNATURE_LEVEL];

export const SIGNATURE_REQUEST_STATUS = {
  Open: "open",
  AllSigned: "all-signed",
  Completed: "completed",
  Declined: "declined",
  Expired: "expired",
  Cancelled: "cancelled",
} as const;

export type SignatureRequestStatus =
  (typeof SIGNATURE_REQUEST_STATUS)[keyof typeof SIGNATURE_REQUEST_STATUS];

export const SIGNATURE_SIGNER_STATUS = {
  Pending: "pending",
  Viewed: "viewed",
  Signed: "signed",
  Declined: "declined",
} as const;

export type SignatureSignerStatus =
  (typeof SIGNATURE_SIGNER_STATUS)[keyof typeof SIGNATURE_SIGNER_STATUS];

export const SIGNATURE_METHOD = {
  InPerson: "in-person",
  Link: "link",
} as const;

export type SignatureMethod = (typeof SIGNATURE_METHOD)[keyof typeof SIGNATURE_METHOD];

export const SignatureHandlers = {
  request: `${SIGNATURE_FEATURE}:write:request`,
  signInPerson: `${SIGNATURE_FEATURE}:write:sign-in-person`,
  issueLink: `${SIGNATURE_FEATURE}:write:issue-link`,
  revokeLink: `${SIGNATURE_FEATURE}:write:revoke-link`,
  cancel: `${SIGNATURE_FEATURE}:write:cancel`,
  openByLink: `${SIGNATURE_FEATURE}:write:open-by-link`,
  signByLink: `${SIGNATURE_FEATURE}:write:sign-by-link`,
  declineByLink: `${SIGNATURE_FEATURE}:write:decline-by-link`,
} as const;

export const SignatureQueries = {
  list: `${SIGNATURE_FEATURE}:query:signature-request:list`,
  detail: `${SIGNATURE_FEATURE}:query:signature-request:detail`,
  signerList: `${SIGNATURE_FEATURE}:query:signature-signer:list`,
} as const;

export const SignatureJobs = {
  sweep: `${SIGNATURE_FEATURE}:job:sweep`,
} as const;

export const SIGNATURE_EVENT_SHORT = {
  completed: "completed",
  declined: "declined",
  expired: "expired",
} as const;

export const SignatureEvents = {
  completed: `${SIGNATURE_FEATURE}:event:${SIGNATURE_EVENT_SHORT.completed}`,
  declined: `${SIGNATURE_FEATURE}:event:${SIGNATURE_EVENT_SHORT.declined}`,
  expired: `${SIGNATURE_FEATURE}:event:${SIGNATURE_EVENT_SHORT.expired}`,
} as const;

// Every link rejection (forged, expired, revoked, used up, already signed) carries this reason, so
// a caller cannot tell the cases apart.
export const SIGNATURE_INVALID_LINK_REASON = "invalid_or_expired_link";

export const SIGNATURE_INVALID_IMAGE_REASON = "invalid_signature_image";

export const SIGNATURE_LINK_TTL_DAYS = 14;
export const SIGNATURE_MAX_LINK_OPENS = 20;
export const SIGNATURE_DEFAULT_VALIDITY_DAYS = 14;

export const SignatureInternalHandlers = {
  linkOpen: `${SIGNATURE_FEATURE}:write:link-open`,
  linkSign: `${SIGNATURE_FEATURE}:write:link-sign`,
  linkDecline: `${SIGNATURE_FEATURE}:write:link-decline`,
  finish: `${SIGNATURE_FEATURE}:write:finish`,
  expire: `${SIGNATURE_FEATURE}:write:expire`,
  reconcile: `${SIGNATURE_FEATURE}:write:reconcile`,
} as const;
