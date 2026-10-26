import { ACTION_FORM_ENTITY } from "@cosmicdrift/kumiko-framework/ui-types";
import { fieldLabelKey } from "@cosmicdrift/kumiko-renderer/headless";
import {
  INBOUND_MAIL_FOUNDATION_FEATURE,
  InboundMailAccountStatuses,
  InboundMailConnectErrors,
  InboundMailLastErrors,
} from "./constants.ts";
import { INBOUND_PROBE_I18N } from "./probe-keys.ts";
import {
  MAIL_ACCOUNT_EDIT_SCREEN_ID,
  MAIL_ACCOUNT_LAST_ERROR_OPTION_KEY_PREFIX,
  MAIL_ACCOUNT_LIST_SCREEN_ID,
  MAIL_ACCOUNT_STATUS_OPTION_KEY_PREFIX,
} from "./screens.ts";
import { MAIL_SEND_ERRORS } from "./send-from-account.ts";

const formFieldKey = (field: string): string =>
  fieldLabelKey(INBOUND_MAIL_FOUNDATION_FEATURE, ACTION_FORM_ENTITY, field);

export const INBOUND_MAIL_FOUNDATION_I18N: Readonly<Record<string, { readonly en: string }>> = {
  ...INBOUND_PROBE_I18N,
  [`screen:${MAIL_ACCOUNT_LIST_SCREEN_ID}.title`]: { en: "Mailboxes" },
  [`screen:${MAIL_ACCOUNT_EDIT_SCREEN_ID}.title`]: { en: "Edit mailbox" },
  "inboundMail.accounts.col.name": { en: "Name" },
  "inboundMail.accounts.col.address": { en: "Address" },
  "inboundMail.accounts.col.provider": { en: "Provider" },
  "inboundMail.accounts.col.status": { en: "Status" },
  "inboundMail.accounts.col.connected": { en: "Connected" },
  "inboundMail.accounts.col.lastError": { en: "Problem" },
  "inboundMail.accounts.col.quarantined": { en: "Quarantined" },
  [`${MAIL_ACCOUNT_LAST_ERROR_OPTION_KEY_PREFIX}${InboundMailLastErrors.connectionFailed}`]: {
    en: "The mail server could not be reached. Syncing is retried automatically.",
  },
  [`${MAIL_ACCOUNT_LAST_ERROR_OPTION_KEY_PREFIX}${InboundMailLastErrors.rateLimited}`]: {
    en: "The mail server is limiting requests. Syncing is retried automatically.",
  },
  [`${MAIL_ACCOUNT_LAST_ERROR_OPTION_KEY_PREFIX}${InboundMailLastErrors.messageQuarantined}`]: {
    en: "A mail could not be imported and was set aside. Confirm the quarantine once you have looked into it.",
  },
  [`${MAIL_ACCOUNT_LAST_ERROR_OPTION_KEY_PREFIX}${InboundMailLastErrors.fileStorageUnavailable}`]: {
    en: "File storage is not available, so attachments and originals are not saved.",
  },
  [InboundMailConnectErrors.addressAlreadyConnected.i18nKey]: {
    en: "This mailbox is already connected.",
  },
  [InboundMailConnectErrors.addressDisconnected.i18nKey]: {
    en: "This mailbox was disconnected before. Reconnect it from the mailbox list to keep its history.",
  },
  "inboundMail.accounts.acknowledgeQuarantine": { en: "Confirm quarantine" },
  [`${MAIL_ACCOUNT_STATUS_OPTION_KEY_PREFIX}${InboundMailAccountStatuses.active}`]: {
    en: "Active",
  },
  [`${MAIL_ACCOUNT_STATUS_OPTION_KEY_PREFIX}${InboundMailAccountStatuses.authError}`]: {
    en: "Sign-in failed",
  },
  [`${MAIL_ACCOUNT_STATUS_OPTION_KEY_PREFIX}${InboundMailAccountStatuses.degraded}`]: {
    en: "Interrupted",
  },
  [`${MAIL_ACCOUNT_STATUS_OPTION_KEY_PREFIX}${InboundMailAccountStatuses.disconnected}`]: {
    en: "Disconnected",
  },
  "inboundMail.accounts.connectImap": { en: "Connect mailbox" },
  "inboundMail.accounts.reconnect": { en: "Reconnect" },
  "inboundMail.accounts.edit": { en: "Rename" },
  "inboundMail.accounts.edit.submit": { en: "Save" },
  "inboundMail.accounts.disconnect": { en: "Disconnect" },
  "inboundMail.accounts.disconnect.confirm": {
    en: "Disconnect this mailbox? No new mail is fetched; stored mail is kept.",
  },
  [formFieldKey("accountId")]: { en: "Mailbox" },
  [formFieldKey("displayName")]: { en: "Name" },
  [MAIL_SEND_ERRORS.notConfigured.i18nKey]: {
    en: "Sending is not set up for this mailbox. Connect the mailbox again with its outgoing server.",
  },
  [MAIL_SEND_ERRORS.loginRejected.i18nKey]: {
    en: "The outgoing mail server rejected the sign-in. Check the mailbox password.",
  },
  [MAIL_SEND_ERRORS.serverUnreachable.i18nKey]: {
    en: "The outgoing mail server cannot be reached. Try again later.",
  },
  [MAIL_SEND_ERRORS.rejected.i18nKey]: {
    en: "The outgoing mail server refused the mail. Check the recipient address.",
  },
  [MAIL_SEND_ERRORS.invalidMessage.i18nKey]: {
    en: "The mail was not sent: a recipient, the subject or the reply reference is invalid.",
  },
};
