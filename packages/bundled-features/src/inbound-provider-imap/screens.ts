import {
  IMAP_CONNECT_SCREEN_ID,
  IMAP_RECONNECT_SCREEN_ID,
  type InboundMailRoles,
  MAIL_ACCOUNT_LIST_SCREEN_QN,
  MY_IMAP_CONNECT_SCREEN_ID,
  MY_IMAP_RECONNECT_SCREEN_ID,
  MY_MAIL_ACCOUNT_LIST_SCREEN_QN,
} from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import { i18nKey } from "@cosmicdrift/kumiko-framework/engine";
import type { ActionFormScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { ImapHandlers, ImapQueries, SMTP_SUBMISSION_PORT } from "./constants.ts";

// The admin form connects a shared mailbox, the member form a personal one. The member form carries
// no sender-check field because that policy is tenant-wide and only admins set it.
function createConnectScreen(variant: {
  readonly id: string;
  readonly handler: string;
  readonly roles: readonly string[];
  readonly returnTarget: string;
  readonly withSenderCheck: boolean;
}): ActionFormScreenDefinition {
  return {
    id: variant.id,
    type: "actionForm",
    agent: { expose: false },
    handler: variant.handler,
    fields: {
      displayName: { type: "text", required: true, maxLength: 200 },
      address: { type: "text", required: true, maxLength: 320, format: "email" },
      host: { type: "text", required: true, maxLength: 255 },
      port: {
        type: "number",
        integer: true,
        grouping: false,
        required: true,
        min: 1,
        max: 65535,
        default: 993,
      },
      user: { type: "text", required: true, maxLength: 320 },
      password: { type: "text", required: true, format: "password", sensitive: true },
      smtpHost: { type: "text", maxLength: 255 },
      smtpPort: {
        type: "number",
        integer: true,
        grouping: false,
        required: true,
        min: 1,
        max: 65535,
        default: SMTP_SUBMISSION_PORT,
      },
      ...(variant.withSenderCheck && { trustedAuthservId: { type: "text", maxLength: 255 } }),
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
        ...(variant.withSenderCheck
          ? [
              {
                title: i18nKey("inboundMail.imap.connect.senderCheck"),
                description: i18nKey("inboundMail.imap.connect.senderCheckHint"),
                fields: ["trustedAuthservId"],
              },
            ]
          : []),
      ],
    },
    submitLabel: i18nKey("inboundMail.imap.connect.submit"),
    redirect: variant.returnTarget,
    cancelTarget: variant.returnTarget,
    access: { roles: [...variant.roles] },
    dormant: true,
  };
}

// Reached from the toolbar of the foundation's mail account list, never from the nav.
export const createImapConnectScreen = ({
  adminRoles,
}: InboundMailRoles): ActionFormScreenDefinition =>
  createConnectScreen({
    id: IMAP_CONNECT_SCREEN_ID,
    handler: ImapHandlers.connectMailbox,
    roles: adminRoles,
    returnTarget: MAIL_ACCOUNT_LIST_SCREEN_QN,
    withSenderCheck: true,
  });

// Reached from the toolbar of "My mail accounts".
export const createMyImapConnectScreen = ({
  memberRoles,
}: InboundMailRoles): ActionFormScreenDefinition =>
  createConnectScreen({
    id: MY_IMAP_CONNECT_SCREEN_ID,
    handler: ImapHandlers.connectMyMailbox,
    roles: memberRoles,
    returnTarget: MY_MAIL_ACCOUNT_LIST_SCREEN_QN,
    withSenderCheck: false,
  });

// Reached from the "Reconnect" row action of an account with a sign-in error. The record id comes
// from the path; the load query returns the stored server settings, never the password.
// The admin and the owner variant share this form; the owner's carries no sender-check field
// because that policy is tenant-wide and only admins set it.
function createReconnectScreen(variant: {
  readonly id: string;
  readonly roles: readonly string[];
  readonly returnTarget: string;
  readonly withSenderCheck: boolean;
}): ActionFormScreenDefinition {
  return {
    id: variant.id,
    type: "actionForm",
    agent: { expose: false },
    handler: ImapHandlers.reconnectMailbox,
    load: { query: ImapQueries.reconnectPrefill, idParam: "accountId" },
    fields: {
      accountId: { type: "text", required: true },
      displayName: { type: "text", maxLength: 200 },
      host: { type: "text", required: true, maxLength: 255 },
      port: {
        type: "number",
        integer: true,
        grouping: false,
        required: true,
        min: 1,
        max: 65535,
        default: 993,
      },
      user: { type: "text", required: true, maxLength: 320 },
      password: { type: "text", required: true, format: "password", sensitive: true },
      smtpHost: { type: "text", maxLength: 255 },
      smtpPort: {
        type: "number",
        integer: true,
        grouping: false,
        required: true,
        min: 1,
        max: 65535,
        default: SMTP_SUBMISSION_PORT,
      },
      ...(variant.withSenderCheck && { trustedAuthservId: { type: "text", maxLength: 255 } }),
    },
    layout: {
      sections: [
        {
          title: i18nKey("inboundMail.imap.connect.server"),
          description: i18nKey("inboundMail.imap.reconnect.hint"),
          // The id only travels in the payload; the user recognises the mailbox by its name.
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
        ...(variant.withSenderCheck
          ? [
              {
                title: i18nKey("inboundMail.imap.connect.senderCheck"),
                description: i18nKey("inboundMail.imap.connect.senderCheckHint"),
                fields: ["trustedAuthservId"],
              },
            ]
          : []),
      ],
    },
    submitLabel: i18nKey("inboundMail.imap.reconnect.submit"),
    redirect: variant.returnTarget,
    cancelTarget: variant.returnTarget,
    access: { roles: [...variant.roles] },
    dormant: true,
  };
}

export const createImapReconnectScreen = ({
  adminRoles,
}: InboundMailRoles): ActionFormScreenDefinition =>
  createReconnectScreen({
    id: IMAP_RECONNECT_SCREEN_ID,
    roles: adminRoles,
    returnTarget: MAIL_ACCOUNT_LIST_SCREEN_QN,
    withSenderCheck: true,
  });

// Reached from the "Reactivate" row action of "My mail accounts".
export const createMyImapReconnectScreen = ({
  memberRoles,
}: InboundMailRoles): ActionFormScreenDefinition =>
  createReconnectScreen({
    id: MY_IMAP_RECONNECT_SCREEN_ID,
    roles: memberRoles,
    returnTarget: MY_MAIL_ACCOUNT_LIST_SCREEN_QN,
    withSenderCheck: false,
  });

export const createImapScreens = (roles: InboundMailRoles): ActionFormScreenDefinition[] => [
  createImapConnectScreen(roles),
  createImapReconnectScreen(roles),
  createMyImapConnectScreen(roles),
  createMyImapReconnectScreen(roles),
];
