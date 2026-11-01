import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createFilesField,
  createLongTextField,
  createNumberField,
  createSelectField,
  createTextField,
  createTimestampField,
} from "@cosmicdrift/kumiko-framework/engine";
import type { PersonalSubject } from "@cosmicdrift/kumiko-types/fields";
import { DEFAULT_RETENTION_KEEP_FOR } from "./options.ts";
import {
  HELPDESK_KIND,
  HELPDESK_MAX_FILES,
  HELPDESK_REPLY_CHANNELS,
  HELPDESK_SOURCE,
  HELPDESK_STATUS,
} from "./web/constants.ts";

const KIND_OPTIONS = [
  HELPDESK_KIND.Question,
  HELPDESK_KIND.Contact,
  HELPDESK_KIND.Bug,
  HELPDESK_KIND.Wish,
] as const;
const STATUS_OPTIONS = [
  HELPDESK_STATUS.Open,
  HELPDESK_STATUS.Answered,
  HELPDESK_STATUS.Done,
] as const;
const SOURCE_OPTIONS = [HELPDESK_SOURCE.Website, HELPDESK_SOURCE.Admin] as const;
const REPLY_CHANNEL_OPTIONS = [
  HELPDESK_REPLY_CHANNELS.Email,
  HELPDESK_REPLY_CHANNELS.EmailAndInApp,
] as const;

// A signed-in reporter is the data subject; an anonymous reporter has no user id, so the row
// itself is the crypto-shredding subject.
const REPORTER_SUBJECT: PersonalSubject = { of: "reporterUserId", whenAbsent: "self" };

const MAX_FILE_SIZE = "10MB";

export function createHelpdeskRequestEntity(retentionKeepFor: string = DEFAULT_RETENTION_KEEP_FOR) {
  return createEntity({
    table: "read_helpdesk_requests",
    description:
      "A message from a website visitor or a signed-in user to the platform operators (question, contact request, bug report or wish), tracked through open, answered and done as SystemAdmins process it; name, email, phone, subject and message are the reporter's personal data.",
    systemStream: true,
    tenancy: "global",
    retention: { keepFor: retentionKeepFor, strategy: "hardDelete", reference: "submittedAt" },
    fields: {
      kind: createSelectField({
        options: KIND_OPTIONS,
        required: true,
        filterable: true,
        sortable: true,
        optionTones: {
          [HELPDESK_KIND.Bug]: "bad",
          [HELPDESK_KIND.Question]: "accent",
          [HELPDESK_KIND.Contact]: "accent",
          [HELPDESK_KIND.Wish]: "neutral",
        },
      }),
      status: createSelectField({
        options: STATUS_OPTIONS,
        required: true,
        default: HELPDESK_STATUS.Open,
        filterable: true,
        sortable: true,
        optionTones: {
          [HELPDESK_STATUS.Open]: "warn",
          [HELPDESK_STATUS.Answered]: "accent",
          [HELPDESK_STATUS.Done]: "ok",
        },
      }),
      source: createSelectField({
        options: SOURCE_OPTIONS,
        required: true,
        filterable: true,
      }),
      subject: createTextField({
        required: true,
        personal: REPORTER_SUBJECT,
        find: "none",
        searchable: true,
      }),
      message: createLongTextField({ required: true, personal: REPORTER_SUBJECT, find: "none" }),
      name: createTextField({
        required: true,
        personal: REPORTER_SUBJECT,
        find: "fuzzy",
        searchable: true,
      }),
      email: createTextField({
        required: true,
        personal: REPORTER_SUBJECT,
        find: "fuzzy",
        searchable: true,
      }),
      phone: createTextField({ personal: REPORTER_SUBJECT, find: "none" }),
      reporterUserId: createTextField({ personal: false, reason: "pseudonymous_fk" }),
      // Not named tenantId: that is the framework's physical tenant column.
      reporterTenantId: createTextField({ personal: false, reason: "is_tenant_reference" }),
      reporterTenantName: createTextField({ personal: false, reason: "is_business_data" }),
      reporterTenantPlan: createTextField({ personal: false, reason: "is_business_data" }),
      page: createTextField({ personal: false, reason: "is_page_path" }),
      appVersion: createTextField({ personal: false, reason: "is_app_build_version" }),
      browser: createTextField({ personal: false, reason: "is_browser_summary" }),
      locale: createTextField({ personal: false, reason: "is_ui_language_preference" }),
      fileIds: createFilesField({
        maxCount: HELPDESK_MAX_FILES,
        maxSize: MAX_FILE_SIZE,
        personal: REPORTER_SUBJECT,
      }),
      fileCount: createNumberField({ default: 0 }),
      submittedAt: createTimestampField({
        personal: false,
        sortable: true,
        required: true,
        reason: "is_submission_timestamp",
      }),
      answeredAt: createTimestampField(),
      closedAt: createTimestampField(),
      replyCount: createNumberField({ default: 0 }),
    },
  });
}

export function createHelpdeskReplyEntity(retentionKeepFor: string = DEFAULT_RETENTION_KEEP_FOR) {
  return createEntity({
    table: "read_helpdesk_replies",
    description:
      "A SystemAdmin's answer to a contact request, with the channels it went out on; the message is the reporter's personal data because it quotes and addresses them.",
    systemStream: true,
    tenancy: "global",
    retention: { keepFor: retentionKeepFor, strategy: "hardDelete", reference: "sentAt" },
    fields: {
      requestId: createTextField({
        required: true,
        personal: false,
        reason: "technical_reference",
      }),
      reporterUserId: createTextField({ personal: false, reason: "pseudonymous_fk" }),
      message: createLongTextField({ required: true, personal: REPORTER_SUBJECT, find: "none" }),
      authorUserId: createTextField({
        required: true,
        personal: false,
        reason: "is_admin_audit_id",
      }),
      authorName: createTextField({ required: true, personal: false, reason: "is_admin_label" }),
      fileIds: createFilesField({
        maxCount: HELPDESK_MAX_FILES,
        maxSize: MAX_FILE_SIZE,
        personal: false,
        reason: "is_business_data",
      }),
      channels: createSelectField({ options: REPLY_CHANNEL_OPTIONS, required: true }),
      sentAt: createTimestampField({
        personal: false,
        sortable: true,
        required: true,
        reason: "is_submission_timestamp",
      }),
    },
  });
}

export const helpdeskRequestEntity = createHelpdeskRequestEntity();
export const helpdeskReplyEntity = createHelpdeskReplyEntity();
export const helpdeskRequestTable = buildEntityTable("helpdesk-request", helpdeskRequestEntity);
export const helpdeskReplyTable = buildEntityTable("helpdesk-reply", helpdeskReplyEntity);
