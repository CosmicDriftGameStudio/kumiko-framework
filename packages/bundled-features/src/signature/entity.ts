import {
  createEntity,
  createEntityExecutor,
  createLongTextField,
  createNumberField,
  createSelectField,
  createTextField,
  createTimestampField,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  SIGNATURE_LEVEL,
  SIGNATURE_METHOD,
  SIGNATURE_REQUEST_ENTITY,
  SIGNATURE_REQUEST_STATUS,
  SIGNATURE_SIGNER_ENTITY,
  SIGNATURE_SIGNER_STATUS,
} from "./web/constants.ts";

const LEVEL_OPTIONS = [SIGNATURE_LEVEL.Simple] as const;
const REQUEST_STATUS_OPTIONS = [
  SIGNATURE_REQUEST_STATUS.Open,
  SIGNATURE_REQUEST_STATUS.AllSigned,
  SIGNATURE_REQUEST_STATUS.Completed,
  SIGNATURE_REQUEST_STATUS.Declined,
  SIGNATURE_REQUEST_STATUS.Expired,
  SIGNATURE_REQUEST_STATUS.Cancelled,
] as const;
const SIGNER_STATUS_OPTIONS = [
  SIGNATURE_SIGNER_STATUS.Pending,
  SIGNATURE_SIGNER_STATUS.Viewed,
  SIGNATURE_SIGNER_STATUS.Signed,
  SIGNATURE_SIGNER_STATUS.Declined,
] as const;
const METHOD_OPTIONS = [SIGNATURE_METHOD.InPerson, SIGNATURE_METHOD.Link] as const;

export const DEFAULT_SIGNATURE_RETENTION_KEEP_FOR = "10y";

export type SignatureRetention = { readonly keepFor: string };

// A signer has no user account, so the signer row itself is the crypto-shredding subject for the
// name, email, signature image and the audit values (IP, user agent) stored with the signature.
// find: "none" except the email, which the user-data hook looks up by exact match.
const SIGNER_PERSONAL = { personal: "self", find: "none" } as const;

export function createSignatureRequestEntity(
  retention: SignatureRetention = { keepFor: DEFAULT_SIGNATURE_RETENTION_KEEP_FOR },
) {
  return createEntity({
    table: "read_signature_requests",
    description:
      "A request to sign one PDF document by several people, on a display in person or through a link, tracked through open, all-signed, completed, declined, expired and cancelled; the document is referenced by file id and hash and never changed.",
    retention: { keepFor: retention.keepFor, strategy: "hardDelete", reference: "createdAt" },
    fields: {
      documentFileId: createTextField({
        required: true,
        personal: false,
        reason: "technical_reference",
        maxLength: 64,
      }),
      documentSha256: createTextField({
        required: true,
        personal: false,
        reason: "is_document_hash",
        maxLength: 64,
      }),
      title: createTextField({
        required: true,
        personal: false,
        reason: "is_business_data",
        searchable: true,
      }),
      level: createSelectField({ options: LEVEL_OPTIONS, required: true, filterable: true }),
      subjectType: createTextField({
        required: true,
        personal: false,
        reason: "technical_reference",
        filterable: true,
        maxLength: 100,
      }),
      subjectId: createTextField({
        required: true,
        personal: false,
        reason: "technical_reference",
        maxLength: 100,
      }),
      status: createSelectField({
        options: REQUEST_STATUS_OPTIONS,
        required: true,
        default: SIGNATURE_REQUEST_STATUS.Open,
        filterable: true,
        sortable: true,
        optionTones: {
          [SIGNATURE_REQUEST_STATUS.Open]: "warn",
          [SIGNATURE_REQUEST_STATUS.AllSigned]: "accent",
          [SIGNATURE_REQUEST_STATUS.Completed]: "ok",
          [SIGNATURE_REQUEST_STATUS.Declined]: "bad",
          [SIGNATURE_REQUEST_STATUS.Expired]: "neutral",
          [SIGNATURE_REQUEST_STATUS.Cancelled]: "neutral",
        },
      }),
      expiresAt: createTimestampField({
        required: true,
        personal: false,
        reason: "is_deadline",
        sortable: true,
      }),
      completedFileId: createTextField({
        personal: false,
        reason: "technical_reference",
        maxLength: 64,
      }),
      completedAt: createTimestampField({
        personal: false,
        reason: "is_business_timestamp",
        sortable: true,
      }),
    },
    indexes: [
      { columns: ["tenantId", "status"] },
      { columns: ["tenantId", "subjectType", "subjectId"] },
    ],
  });
}

export function createSignatureSignerEntity(
  retention: SignatureRetention = { keepFor: DEFAULT_SIGNATURE_RETENTION_KEEP_FOR },
) {
  return createEntity({
    table: "read_signature_signers",
    description:
      "One person who has to sign a signature request, with their way of signing (in person or link), the signature image and the audit values stored when they signed or declined; name, email, image, IP address and user agent are the signer's personal data.",
    retention: { keepFor: retention.keepFor, strategy: "hardDelete", reference: "createdAt" },
    fields: {
      requestId: createTextField({
        required: true,
        personal: false,
        reason: "technical_reference",
        maxLength: 64,
      }),
      name: createTextField({ required: true, ...SIGNER_PERSONAL }),
      role: createTextField({
        personal: false,
        reason: "is_business_data",
        maxLength: 100,
      }),
      contactId: createTextField({
        personal: false,
        reason: "pseudonymous_fk",
        maxLength: 64,
      }),
      email: createTextField({ personal: "self", find: "exact", maxLength: 320 }),
      status: createSelectField({
        options: SIGNER_STATUS_OPTIONS,
        required: true,
        default: SIGNATURE_SIGNER_STATUS.Pending,
        filterable: true,
        sortable: true,
      }),
      method: createSelectField({ options: METHOD_OPTIONS }),
      signedAt: createTimestampField({
        personal: false,
        reason: "is_business_timestamp",
        sortable: true,
      }),
      imageFileId: createTextField({ ...SIGNER_PERSONAL, maxLength: 64 }),
      linkAnchor: createTextField({
        personal: false,
        reason: "is_grant_anchor",
        maxLength: 64,
      }),
      linkSentAt: createTimestampField({ personal: false, reason: "is_business_timestamp" }),
      viewedAt: createTimestampField({ personal: false, reason: "is_business_timestamp" }),
      viewCount: createNumberField({ default: 0 }),
      signedFromIp: createTextField({ ...SIGNER_PERSONAL, maxLength: 64 }),
      signedUserAgent: createTextField({ ...SIGNER_PERSONAL, maxLength: 500 }),
      declineReason: createLongTextField({ personal: "self", find: "none" }),
    },
    indexes: [{ columns: ["tenantId", "requestId"] }],
  });
}

export const signatureRequestEntity = createSignatureRequestEntity();
export const signatureSignerEntity = createSignatureSignerEntity();

export const { executor: requestExecutor, table: signatureRequestTable } = createEntityExecutor(
  SIGNATURE_REQUEST_ENTITY,
  signatureRequestEntity,
);
export const { executor: signerExecutor, table: signatureSignerTable } = createEntityExecutor(
  SIGNATURE_SIGNER_ENTITY,
  signatureSignerEntity,
);
