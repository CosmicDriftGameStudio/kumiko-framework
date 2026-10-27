import { ACTION_FORM_ENTITY } from "@cosmicdrift/kumiko-framework/ui-types";
import { fieldLabelKey } from "@cosmicdrift/kumiko-renderer/headless";
import {
  INBOUND_MAIL_FOUNDATION_FEATURE,
  InboundMailAccountStatuses,
  InboundMailConnectErrors,
  InboundMailLastErrors,
} from "./constants.ts";
import { INBOUND_PROBE_I18N } from "./probe-keys.ts";
import { QUARANTINE_REASON_OPTION_KEY_PREFIX } from "./quarantine-screens.ts";
import {
  MAIL_ACCOUNT_EDIT_SCREEN_ID,
  MAIL_ACCOUNT_LAST_ERROR_OPTION_KEY_PREFIX,
  MAIL_ACCOUNT_LIST_SCREEN_ID,
  MAIL_ACCOUNT_SENDER_CHECK_SCREEN_ID,
  MAIL_ACCOUNT_STATUS_OPTION_KEY_PREFIX,
  MAIL_QUARANTINE_SCREEN_ID,
} from "./screens.ts";
import { MAIL_SEND_ERRORS } from "./send-from-account.ts";

const formFieldKey = (field: string): string =>
  fieldLabelKey(INBOUND_MAIL_FOUNDATION_FEATURE, ACTION_FORM_ENTITY, field);

export const INBOUND_MAIL_FOUNDATION_I18N: Readonly<Record<string, { readonly en: string }>> = {
  ...INBOUND_PROBE_I18N,
  [`screen:${MAIL_ACCOUNT_LIST_SCREEN_ID}.title`]: { en: "Mailboxes" },
  [`screen:${MAIL_ACCOUNT_EDIT_SCREEN_ID}.title`]: { en: "Edit mailbox" },
  [`screen:${MAIL_ACCOUNT_SENDER_CHECK_SCREEN_ID}.title`]: { en: "Sender check" },
  [`screen:${MAIL_QUARANTINE_SCREEN_ID}.title`]: { en: "Quarantined mails" },
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
    en: "This mailbox was disconnected before. Use Reactivate in the mailbox list to keep its history.",
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
  "inboundMail.accounts.reactivate": { en: "Reactivate" },
  "inboundMail.accounts.quarantine": { en: "Quarantine" },
  [InboundMailConnectErrors.credentialRequired.i18nKey]: {
    en: "This mailbox has no stored sign-in. Enter the password again to reactivate it.",
  },
  "inboundMail.quarantine.col.sender": { en: "Sender" },
  "inboundMail.quarantine.col.subject": { en: "Subject" },
  "inboundMail.quarantine.col.reason": { en: "Reason" },
  "inboundMail.quarantine.col.mailbox": { en: "Mailbox" },
  "inboundMail.quarantine.col.date": { en: "Set aside" },
  "inboundMail.quarantine.retry": { en: "Fetch again" },
  "inboundMail.quarantine.acknowledge": { en: "Confirm" },
  [`${QUARANTINE_REASON_OPTION_KEY_PREFIX}unparseable`]: {
    en: "The mail could not be read.",
  },
  [`${QUARANTINE_REASON_OPTION_KEY_PREFIX}invalid_message`]: {
    en: "The mail is incomplete or invalid.",
  },
  [`${QUARANTINE_REASON_OPTION_KEY_PREFIX}ingest_failed`]: {
    en: "Importing the mail failed repeatedly.",
  },
  "inboundMail.accounts.edit": { en: "Rename" },
  "inboundMail.accounts.edit.submit": { en: "Save" },
  "inboundMail.accounts.senderCheck": { en: "Sender check" },
  "inboundMail.accounts.senderCheck.submit": { en: "Save" },
  "inboundMail.accounts.senderCheckHint": {
    en: "Identifier of the mail server from the Authentication-Results header, for example mx.example.com. Only with it the system checks whether a sender is genuine. Leave empty to turn the check off.",
  },
  [formFieldKey("trustedAuthservId")]: { en: "Mail server ID" },
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
  [MAIL_SEND_ERRORS.attachmentInvalid.i18nKey]: {
    en: "The mail was not sent: an attachment is no longer available.",
  },
  [MAIL_SEND_ERRORS.attachmentsTooLarge.i18nKey]: {
    en: "The mail was not sent: the attachments together are larger than 18 MB.",
  },
};
