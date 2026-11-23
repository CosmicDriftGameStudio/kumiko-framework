import { deriveEntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  createBooleanField,
  createDateField,
  createEntity,
  createEntityExecutor,
  createFileField,
  createFilesField,
  createJsonbField,
  createLongTextField,
  createMoneyField,
  createNumberField,
  createSelectField,
  createTextField,
  createTimestampField,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  LETTER_APPROVAL_MODES,
  LETTER_ENTITY,
  LETTER_ENVELOPES,
  LETTER_FAILURE_REASONS,
  LETTER_FORM_REQUIREMENTS,
  LETTER_PRICE_SOURCES,
  LETTER_SHIPPING_MODES,
  LETTER_STATE,
  LETTER_STATES,
  LETTER_SUBMISSION_STATUSES,
  LETTER_SUBMISSION_TABLE,
} from "./constants.ts";

const TECHNICAL = { personal: false, reason: "technical_reference" } as const;
const BUSINESS_TIMESTAMP = { personal: false, reason: "is_business_timestamp" } as const;
// The address and the name belong to the letter row: forgetting the letter shreds them.
const RECIPIENT = { personal: { of: "id" }, find: "none" } as const;

const STATE_TONES = {
  [LETTER_STATE.awaitingApproval]: "warn",
  [LETTER_STATE.approved]: "accent",
  [LETTER_STATE.submitting]: "accent",
  [LETTER_STATE.submissionUnknown]: "bad",
  [LETTER_STATE.accepted]: "accent",
  [LETTER_STATE.onHold]: "warn",
  [LETTER_STATE.sent]: "ok",
  [LETTER_STATE.failed]: "bad",
  [LETTER_STATE.canceled]: "neutral",
  [LETTER_STATE.returned]: "bad",
} as const;

export const letterEntity = createEntity({
  name: LETTER_ENTITY,
  table: "read_letters",
  description:
    "A PDF sent as a postal letter through a print provider: created awaiting approval, approved by a person with a price preview, then handed to the provider and tracked until it is sent, failed, canceled or returned; the recipient address is the letter's personal data.",
  retention: { keepFor: "7y", strategy: "hardDelete" },
  fields: {
    status: createSelectField({
      options: LETTER_STATES,
      required: true,
      default: LETTER_STATE.awaitingApproval,
      filterable: true,
      sortable: true,
      optionTones: STATE_TONES,
    }),
    approvalMode: createSelectField({
      options: LETTER_APPROVAL_MODES,
      required: true,
      default: "manual",
      filterable: true,
    }),
    // Why a waiting letter cannot be approved: a LetterErrors code, empty when nothing is wrong.
    preparationIssue: createTextField({ maxLength: 100, filterable: true, ...TECHNICAL }),
    idempotencyKey: createTextField({ required: true, maxLength: 200, ...TECHNICAL }),

    sourceEntityType: createTextField({
      required: true,
      maxLength: 100,
      filterable: true,
      ...TECHNICAL,
    }),
    sourceEntityId: createTextField({
      required: true,
      maxLength: 100,
      filterable: true,
      ...TECHNICAL,
    }),
    costCenterRef: createTextField({ maxLength: 200, filterable: true, ...TECHNICAL }),
    createdBy: createTextField({ required: true, maxLength: 64, personal: "ref" }),
    approvedBy: createTextField({ maxLength: 64, personal: "ref" }),

    fileRefIds: createJsonbField({ emptyValue: "array", ...TECHNICAL }),
    // File fields, so the hardDelete retention sweep purges the bytes together with the row.
    mergedFileRefId: createFileField(TECHNICAL),
    documentSha256: createTextField({
      maxLength: 64,
      personal: false,
      reason: "is_document_hash",
    }),
    pageCount: createNumberField(),
    sheetCount: createNumberField(),

    shippingMode: createSelectField({
      options: LETTER_SHIPPING_MODES,
      required: true,
      filterable: true,
    }),
    envelope: createSelectField({ options: LETTER_ENVELOPES, required: true, default: "folded" }),
    color: createBooleanField({ required: true }),
    duplex: createBooleanField({ required: true }),
    formRequirement: createSelectField({ options: LETTER_FORM_REQUIREMENTS, required: true }),
    formRiskAcknowledged: createBooleanField({ required: true, default: false }),
    latestReceiptDate: createDateField({
      personal: false,
      reason: "is_deadline",
      sortable: true,
    }),

    recipientName: createTextField({ required: true, maxLength: 200, ...RECIPIENT }),
    recipientAddressExtra: createTextField({ maxLength: 200, ...RECIPIENT }),
    recipientStreet: createTextField({ required: true, maxLength: 200, ...RECIPIENT }),
    recipientHouseNumber: createTextField({ required: true, maxLength: 20, ...RECIPIENT }),
    recipientPostalCode: createTextField({ required: true, maxLength: 20, ...RECIPIENT }),
    recipientCity: createTextField({ required: true, maxLength: 200, ...RECIPIENT }),
    recognizedAddress: createLongTextField({ personal: { of: "id" }, find: "none" }),

    quotedNet: createMoneyField(),
    actualNet: createMoneyField(),
    actualVat: createMoneyField(),
    priceSource: createSelectField({ options: LETTER_PRICE_SOURCES }),

    providerName: createTextField({ maxLength: 100, ...TECHNICAL }),
    providerJobId: createTextField({ maxLength: 200, ...TECHNICAL }),
    trackingNumber: createTextField({ maxLength: 200, ...TECHNICAL }),
    trackingStatus: createTextField({ maxLength: 200, ...TECHNICAL }),
    proofFileRefIds: createFilesField(TECHNICAL),
    cancelableUntil: createTimestampField(BUSINESS_TIMESTAMP),
    addressMismatch: createBooleanField({ default: false, filterable: true }),
    failureReason: createSelectField({ options: LETTER_FAILURE_REASONS, filterable: true }),
    failureDetail: createTextField({ maxLength: 500, ...RECIPIENT }),
    resolutionNote: createLongTextField(RECIPIENT),

    approvedAt: createTimestampField(BUSINESS_TIMESTAMP),
    submittedAt: createTimestampField(BUSINESS_TIMESTAMP),
    submissionUnknownAt: createTimestampField(BUSINESS_TIMESTAMP),
    acceptedAt: createTimestampField(BUSINESS_TIMESTAMP),
    onHoldAt: createTimestampField(BUSINESS_TIMESTAMP),
    sentAt: createTimestampField({ ...BUSINESS_TIMESTAMP, sortable: true, filterable: true }),
    failedAt: createTimestampField(BUSINESS_TIMESTAMP),
    canceledAt: createTimestampField(BUSINESS_TIMESTAMP),
    returnedAt: createTimestampField(BUSINESS_TIMESTAMP),
  },
  indexes: [
    { unique: true, columns: ["tenantId", "idempotencyKey"] },
    { columns: ["tenantId", "status"] },
    { columns: ["tenantId", "sourceEntityType", "sourceEntityId"] },
  ],
});

export const { executor: letterExecutor, table: letterTable } = createEntityExecutor(letterEntity);

/** One row per letter handed to the provider, so a retried handover finds the claim instead of sending twice.
 *  No address and no name: ids and the provider job id only, nothing personal. */
export const letterSubmissionEntity = createEntity({
  name: "letter-submission",
  table: LETTER_SUBMISSION_TABLE,
  softDelete: false,
  indexes: [{ unique: true, columns: ["tenantId", "idempotencyKey"] }],
  fields: {
    idempotencyKey: createTextField({
      required: true,
      maxLength: 200,
      access: { write: access.privileged },
      ...TECHNICAL,
    }),
    letterId: createTextField({
      required: true,
      maxLength: 36,
      access: { write: access.privileged },
      ...TECHNICAL,
    }),
    status: createSelectField({
      options: LETTER_SUBMISSION_STATUSES,
      required: true,
      access: { write: access.privileged },
    }),
    providerJobId: createTextField({
      maxLength: 200,
      access: { write: access.privileged },
      ...TECHNICAL,
    }),
    reservationId: createTextField({
      maxLength: 36,
      access: { write: access.privileged },
      ...TECHNICAL,
    }),
    periodStart: createTextField({
      maxLength: 40,
      access: { write: access.privileged },
      ...TECHNICAL,
    }),
    claimedAt: createTimestampField({ required: true, access: { write: access.privileged } }),
  },
});

export const letterSubmissionTable = deriveEntityTableMeta(letterSubmissionEntity, {
  source: "unmanaged",
});

export type LetterRow = NonNullable<Awaited<ReturnType<typeof letterExecutor.detail>>>;
