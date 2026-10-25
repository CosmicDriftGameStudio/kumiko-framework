import { ACTION_FORM_ENTITY } from "@cosmicdrift/kumiko-framework/ui-types";
import { fieldLabelKey } from "@cosmicdrift/kumiko-renderer/headless";
import { INBOUND_MAIL_FOUNDATION_FEATURE, InboundMailAccountStatuses } from "./constants.ts";
import { INBOUND_PROBE_I18N } from "./probe-keys.ts";
import {
  MAIL_ACCOUNT_EDIT_SCREEN_ID,
  MAIL_ACCOUNT_LIST_SCREEN_ID,
  MAIL_ACCOUNT_STATUS_OPTION_KEY_PREFIX,
} from "./screens.ts";

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
  "inboundMail.accounts.edit": { en: "Rename" },
  "inboundMail.accounts.edit.submit": { en: "Save" },
  "inboundMail.accounts.disconnect": { en: "Disconnect" },
  "inboundMail.accounts.disconnect.confirm": {
    en: "Disconnect this mailbox? No new mail is fetched; stored mail is kept.",
  },
  [formFieldKey("accountId")]: { en: "Mailbox" },
  [formFieldKey("displayName")]: { en: "Name" },
};
