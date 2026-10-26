import {
  IMAP_CONNECT_SCREEN_ID,
  IMAP_RECONNECT_SCREEN_ID,
  MAIL_ACCOUNT_LIST_SCREEN_QN,
} from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import { i18nKey } from "@cosmicdrift/kumiko-framework/engine";
import type { ActionFormScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { ImapHandlers, ImapQueries, SMTP_SUBMISSION_PORT } from "./constants.ts";

// Reached from the toolbar of the foundation's mail account list, never from the nav.
export const imapConnectScreen: ActionFormScreenDefinition = {
  id: IMAP_CONNECT_SCREEN_ID,
  type: "actionForm",
  agent: { expose: false },
  handler: ImapHandlers.connectMailbox,
  fields: {
    displayName: { type: "text", required: true, maxLength: 200 },
    address: { type: "text", required: true, maxLength: 320, format: "email" },
    host: { type: "text", required: true, maxLength: 255 },
    port: { type: "number", integer: true, required: true, min: 1, max: 65535, default: 993 },
    user: { type: "text", required: true, maxLength: 320 },
    password: { type: "text", required: true, format: "password", sensitive: true },
    smtpHost: { type: "text", maxLength: 255 },
    smtpPort: {
      type: "number",
      integer: true,
      required: true,
      min: 1,
      max: 65535,
      default: SMTP_SUBMISSION_PORT,
    },
  },
  layout: {
    sections: [
      // The name-based icon guess reads "address" as a postal address.
      { fields: ["displayName", { field: "address", icon: "mail" }] },
      {
        title: i18nKey("inboundMail.imap.connect.server"),
        fields: ["host", "port", "user", "password"],
      },
      {
        title: i18nKey("inboundMail.imap.connect.outgoing"),
        description: i18nKey("inboundMail.imap.connect.outgoingHint"),
        fields: ["smtpHost", "smtpPort"],
      },
    ],
  },
  submitLabel: i18nKey("inboundMail.imap.connect.submit"),
  redirect: MAIL_ACCOUNT_LIST_SCREEN_QN,
  cancelTarget: MAIL_ACCOUNT_LIST_SCREEN_QN,
  access: { roles: ["SystemAdmin", "TenantAdmin"] },
  dormant: true,
};

// Reached from the "Reconnect" row action of an account with a sign-in error. The record id comes
// from the path; the load query returns the stored server settings, never the password.
export const imapReconnectScreen: ActionFormScreenDefinition = {
  id: IMAP_RECONNECT_SCREEN_ID,
  type: "actionForm",
  agent: { expose: false },
  handler: ImapHandlers.reconnectMailbox,
  load: { query: ImapQueries.reconnectPrefill, idParam: "accountId" },
  fields: {
    accountId: { type: "text", required: true },
    displayName: { type: "text", maxLength: 200 },
    host: { type: "text", required: true, maxLength: 255 },
    port: { type: "number", integer: true, required: true, min: 1, max: 65535, default: 993 },
    user: { type: "text", required: true, maxLength: 320 },
    password: { type: "text", required: true, format: "password", sensitive: true },
    smtpHost: { type: "text", maxLength: 255 },
    smtpPort: {
      type: "number",
      integer: true,
      required: true,
      min: 1,
      max: 65535,
      default: SMTP_SUBMISSION_PORT,
    },
  },
  layout: {
    sections: [
      {
        title: i18nKey("inboundMail.imap.connect.server"),
        description: i18nKey("inboundMail.imap.reconnect.hint"),
        // The id only travels in the payload; the admin recognises the mailbox by its name.
        fields: [
          { field: "accountId", visible: false },
          { field: "displayName", readOnly: true, submit: false },
          "host",
          "port",
          "user",
          "password",
        ],
      },
      {
        title: i18nKey("inboundMail.imap.connect.outgoing"),
        description: i18nKey("inboundMail.imap.connect.outgoingHint"),
        fields: ["smtpHost", "smtpPort"],
      },
    ],
  },
  submitLabel: i18nKey("inboundMail.imap.reconnect.submit"),
  redirect: MAIL_ACCOUNT_LIST_SCREEN_QN,
  cancelTarget: MAIL_ACCOUNT_LIST_SCREEN_QN,
  access: { roles: ["SystemAdmin", "TenantAdmin"] },
  dormant: true,
};
