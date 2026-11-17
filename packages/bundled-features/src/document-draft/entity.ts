import {
  createEntity,
  createEntityExecutor,
  createJsonbField,
  createLongTextField,
  createNumberField,
  createSelectField,
  createTextField,
  createTimestampField,
} from "@cosmicdrift/kumiko-framework/engine";
import { TEMPLATE_SCOPES } from "../template-resolver/index.ts";
import {
  DOCUMENT_DRAFT_ENTITY,
  DOCUMENT_DRAFT_STATUS,
  DOCUMENT_DRAFT_STATUS_TONE,
} from "./web/constants.ts";

export const DEFAULT_DOCUMENT_DRAFT_RETENTION_KEEP_FOR = "10y";

export type DocumentDraftRetention = { readonly keepFor: string };

const STATUS_OPTIONS = [
  DOCUMENT_DRAFT_STATUS.Open,
  DOCUMENT_DRAFT_STATUS.Finalized,
  DOCUMENT_DRAFT_STATUS.Discarded,
] as const;

// The body carries the text of one contract with names and amounts filled in by whoever edits it,
// so the draft row is its own crypto-shredding subject, like a signer row. find: "none": nothing looks it up.
const DRAFT_PERSONAL = { personal: "self", find: "none" } as const;
const DRAFT_PERSONAL_JSON = { personal: "self" } as const;

export function createDocumentDraftEntity(
  retention: DocumentDraftRetention = { keepFor: DEFAULT_DOCUMENT_DRAFT_RETENTION_KEEP_FOR },
  subjectTypes?: readonly string[],
) {
  return createEntity({
    table: "read_document_drafts",
    description:
      "One editable copy of a PDF document template for one object (for example a lease contract): the template text with its {{placeholders}} frozen at creation, changed with the same structured operations as a template, then finalized to a stored PDF. The template itself stays unchanged; body, variables and the last change are personal data of the draft.",
    retention: { keepFor: retention.keepFor, strategy: "hardDelete", reference: "createdAt" },
    // A draft is visible only while its subject row is readable through the subject entity's own read rules.
    parentRef: {
      entityTypeField: "subjectType",
      entityIdField: "subjectId",
      ...(subjectTypes !== undefined && { allowedTypes: subjectTypes }),
    },
    fields: {
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
        filterable: true,
        maxLength: 100,
      }),
      templateSlug: createTextField({
        required: true,
        personal: false,
        reason: "technical_reference",
        maxLength: 200,
      }),
      templateVariant: createTextField({
        personal: false,
        reason: "technical_reference",
        maxLength: 200,
      }),
      templateTitle: createTextField({
        personal: false,
        reason: "template_content",
        maxLength: 300,
      }),
      templateId: createTextField({
        required: true,
        personal: false,
        reason: "technical_reference",
        maxLength: 64,
      }),
      templateVersion: createNumberField({ required: true }),
      templateScope: createSelectField({ options: [...TEMPLATE_SCOPES], required: true }),
      locale: createTextField({
        required: true,
        personal: false,
        reason: "technical_reference",
        maxLength: 20,
      }),
      templateBody: createLongTextField({
        required: true,
        personal: false,
        reason: "template_content",
      }),
      body: createLongTextField({ required: true, ...DRAFT_PERSONAL }),
      variables: createJsonbField(DRAFT_PERSONAL_JSON),
      meta: createJsonbField({ personal: false, reason: "template_settings" }),
      variableSchema: createJsonbField({
        personal: false,
        reason: "template_definition",
      }),
      status: createSelectField({
        options: STATUS_OPTIONS,
        required: true,
        default: DOCUMENT_DRAFT_STATUS.Open,
        filterable: true,
        sortable: true,
        optionTones: DOCUMENT_DRAFT_STATUS_TONE,
      }),
      revision: createNumberField({ required: true, default: 1 }),
      fileRefId: createTextField({
        personal: false,
        reason: "technical_reference",
        maxLength: 64,
      }),
      fileName: createTextField({ ...DRAFT_PERSONAL, maxLength: 300 }),
      finalizedAt: createTimestampField({ personal: false, reason: "is_business_timestamp" }),
      lastChange: createJsonbField(DRAFT_PERSONAL_JSON),
    },
    indexes: [{ columns: ["tenantId", "subjectType", "subjectId"] }],
  });
}

export const documentDraftEntity = createDocumentDraftEntity();

export const { executor: documentDraftExecutor, table: documentDraftTable } = createEntityExecutor(
  DOCUMENT_DRAFT_ENTITY,
  documentDraftEntity,
);
