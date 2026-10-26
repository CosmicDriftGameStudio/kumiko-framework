import {
  IMAP_CONNECT_SCREEN_ID,
  IMAP_RECONNECT_SCREEN_ID,
} from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import { ACTION_FORM_ENTITY } from "@cosmicdrift/kumiko-framework/ui-types";
import { fieldLabelKey } from "@cosmicdrift/kumiko-renderer/headless";
import {
  FEATURE_NAME,
  IMAP_CONNECT_ERRORS,
  IMAP_RECONNECT_ERRORS,
  SMTP_CONNECT_ERRORS,
} from "./constants.ts";

const formFieldKey = (field: string): string =>
  fieldLabelKey(FEATURE_NAME, ACTION_FORM_ENTITY, field);

export const INBOUND_PROVIDER_IMAP_I18N: Readonly<Record<string, { readonly en: string }>> = {
  [`screen:${IMAP_CONNECT_SCREEN_ID}.title`]: { en: "Connect mailbox" },
  [`screen:${IMAP_RECONNECT_SCREEN_ID}.title`]: { en: "Reconnect mailbox" },
  [formFieldKey("accountId")]: { en: "Mailbox" },
  [formFieldKey("displayName")]: { en: "Name" },
  [formFieldKey("address")]: { en: "Email address" },
  [formFieldKey("host")]: { en: "IMAP server" },
  [formFieldKey("port")]: { en: "Port" },
  [formFieldKey("user")]: { en: "User name" },
  [formFieldKey("password")]: { en: "Password" },
  [formFieldKey("smtpHost")]: { en: "Outgoing server (SMTP)" },
  [formFieldKey("smtpPort")]: { en: "SMTP port" },
  "inboundMail.imap.connect.server": { en: "Server sign-in" },
  "inboundMail.imap.connect.outgoing": { en: "Sending" },
  "inboundMail.imap.connect.outgoingHint": {
    en: "Replies go out from this address over your own mail server, with the same user name and password. Leave the field empty if the server is called like the IMAP server, with smtp. instead of imap. Usually 587, even when your provider lists 465/SSL.",
  },
  "inboundMail.imap.connect.submit": { en: "Check and connect" },
  "inboundMail.imap.reconnect.hint": {
    en: "The sign-in is checked before saving. Then the system fetches the mail again.",
  },
  "inboundMail.imap.reconnect.submit": { en: "Check and reconnect" },
  [IMAP_RECONNECT_ERRORS.notPasswordImap.i18nKey]: {
    en: "Only password IMAP mailboxes can be reconnected here.",
  },
  [IMAP_CONNECT_ERRORS.hostUnreachable.i18nKey]: {
    en: "The IMAP server cannot be reached or is not allowed. Check the server name.",
  },
  [IMAP_CONNECT_ERRORS.loginRejected.i18nKey]: {
    en: "The IMAP server rejected the sign-in. Check the user name and password.",
  },
  [IMAP_CONNECT_ERRORS.tlsFailed.i18nKey]: {
    en: "The encrypted connection failed. Check the port and the TLS setting.",
  },
  [IMAP_CONNECT_ERRORS.connectFailed.i18nKey]: {
    en: "No connection to the IMAP server. Check the server name and port.",
  },
  [SMTP_CONNECT_ERRORS.hostUnreachable.i18nKey]: {
    en: "Receiving works, but sending does not: the outgoing server cannot be reached or is not allowed. Check its name.",
  },
  [SMTP_CONNECT_ERRORS.loginRejected.i18nKey]: {
    en: "Receiving works, but sending does not: the outgoing server rejected the sign-in.",
  },
  [SMTP_CONNECT_ERRORS.tlsFailed.i18nKey]: {
    en: "Receiving works, but sending does not: the encrypted connection to the outgoing server on port {port} failed.",
  },
  [SMTP_CONNECT_ERRORS.connectFailed.i18nKey]: {
    en: "Receiving works, but sending does not: no connection to the outgoing server on port {port}.",
  },
};
