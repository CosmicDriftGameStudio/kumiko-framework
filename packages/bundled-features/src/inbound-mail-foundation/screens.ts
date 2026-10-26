import {
  i18nKey,
  MAX_LIST_LIMIT,
  type ProjectionListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import type { ActionFormScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import {
  InboundMailAccountStatuses,
  InboundMailFoundationHandlers,
  InboundMailFoundationQueries,
} from "./constants.ts";

export const MAIL_ACCOUNT_LIST_SCREEN_ID = "mail-accounts";
export const MAIL_ACCOUNT_EDIT_SCREEN_ID = "mail-account-edit";
export const MAIL_ACCOUNT_LIST_SCREEN_QN = "inbound-mail-foundation:screen:mail-accounts";
// Registered by inbound-provider-imap, which needs the IMAP client to check the login. The
// renderer drops a navigate action whose target screen is not mounted, so the toolbar button
// only shows in apps that mount that provider.
export const MAIL_ACCOUNT_SENDER_CHECK_SCREEN_ID = "mail-account-sender-check";
export const IMAP_CONNECT_SCREEN_ID = "mail-account-connect-imap";
// Same reason for the row action "Reconnect" on an account with a sign-in error.
export const IMAP_RECONNECT_SCREEN_ID = "mail-account-reconnect-imap";

export const MAIL_ACCOUNT_STATUS_OPTION_KEY_PREFIX = "inboundMail.accounts.status.";
export const MAIL_ACCOUNT_LAST_ERROR_OPTION_KEY_PREFIX = "inboundMail.accounts.lastError.";

// Same roles as the update/disconnect handlers: a screen rule wider than the
// handlers would only render actions that 403.
const MAIL_ACCOUNT_ADMIN_ACCESS = { roles: ["SystemAdmin", "TenantAdmin"] } as const;

// Several mailboxes per tenant, one row each. The bound query already filters
// personal mailboxes the caller neither owns nor administers and returns no
// credential: the secret lives in the secrets feature, never in the row.
// dormant: the consuming app places the list in its own settings nav.
export const mailAccountListScreen: ProjectionListScreenDefinition = {
  id: MAIL_ACCOUNT_LIST_SCREEN_ID,
  type: "projectionList",
  agent: { expose: false },
  query: InboundMailFoundationQueries.listAccounts,
  pagination: false,
  pageSize: MAX_LIST_LIMIT,
  columns: [
    { field: "displayName", label: i18nKey("inboundMail.accounts.col.name"), sortable: false },
    { field: "address", label: i18nKey("inboundMail.accounts.col.address"), sortable: false },
    {
      field: "provider",
      label: i18nKey("inboundMail.accounts.col.provider"),
      sortable: false,
      hideOnNarrow: true,
    },
    {
      field: "status",
      label: i18nKey("inboundMail.accounts.col.status"),
      sortable: false,
      renderer: { format: "enumOption", keyPrefix: MAIL_ACCOUNT_STATUS_OPTION_KEY_PREFIX },
    },
    {
      field: "lastError",
      label: i18nKey("inboundMail.accounts.col.lastError"),
      sortable: false,
      renderer: { format: "enumOption", keyPrefix: MAIL_ACCOUNT_LAST_ERROR_OPTION_KEY_PREFIX },
    },
    {
      field: "quarantinedCount",
      label: i18nKey("inboundMail.accounts.col.quarantined"),
      sortable: false,
      hideOnNarrow: true,
    },
    {
      field: "connectedAt",
      label: i18nKey("inboundMail.accounts.col.connected"),
      sortable: false,
      hideOnNarrow: true,
      renderer: { format: "timestamp" },
    },
  ],
  rowActions: [
    {
      kind: "navigate",
      id: "edit",
      label: i18nKey("inboundMail.accounts.edit"),
      screen: MAIL_ACCOUNT_EDIT_SCREEN_ID,
      params: { map: { accountId: "id", displayName: "displayName" } },
      visible: { field: "status", ne: InboundMailAccountStatuses.disconnected },
    },
    {
      kind: "navigate",
      id: "sender-check",
      label: i18nKey("inboundMail.accounts.senderCheck"),
      screen: MAIL_ACCOUNT_SENDER_CHECK_SCREEN_ID,
      params: { map: { accountId: "id", trustedAuthservId: "trustedAuthservId" } },
      visible: { field: "status", ne: InboundMailAccountStatuses.disconnected },
    },
    {
      kind: "navigate",
      id: "reconnect",
      label: i18nKey("inboundMail.accounts.reconnect"),
      screen: IMAP_RECONNECT_SCREEN_ID,
      entityId: "id",
      // The handler rejects accounts of other providers; the row condition cannot combine fields.
      // A disconnected mailbox is reconnected in place, so no duplicate address and no lost history.
      visible: {
        field: "status",
        in: [InboundMailAccountStatuses.authError, InboundMailAccountStatuses.disconnected],
      },
    },
    {
      kind: "writeHandler",
      id: "acknowledge-quarantine",
      label: i18nKey("inboundMail.accounts.acknowledgeQuarantine"),
      handler: InboundMailFoundationHandlers.acknowledgeQuarantine,
      payload: { map: { accountId: "id" } },
      visible: { field: "hasOpenQuarantine", eq: true },
    },
    {
      kind: "writeHandler",
      id: "disconnect",
      label: i18nKey("inboundMail.accounts.disconnect"),
      handler: InboundMailFoundationHandlers.disconnectAccount,
      payload: { map: { accountId: "id" } },
      style: "danger",
      confirm: i18nKey("inboundMail.accounts.disconnect.confirm"),
      visible: { field: "status", ne: InboundMailAccountStatuses.disconnected },
    },
  ],
  toolbarActions: [
    {
      kind: "navigate",
      id: "connect-imap",
      label: i18nKey("inboundMail.accounts.connectImap"),
      screen: IMAP_CONNECT_SCREEN_ID,
      style: "primary",
    },
  ],
  access: MAIL_ACCOUNT_ADMIN_ACCESS,
  dormant: true,
};

export const mailAccountEditScreen: ActionFormScreenDefinition = {
  id: MAIL_ACCOUNT_EDIT_SCREEN_ID,
  type: "actionForm",
  agent: { expose: false },
  handler: InboundMailFoundationHandlers.updateAccount,
  fields: {
    accountId: { type: "text", required: true },
    displayName: { type: "text", required: true, maxLength: 200 },
  },
  layout: {
    sections: [{ fields: [{ field: "accountId", readOnly: true }, "displayName"] }],
  },
  submitLabel: i18nKey("inboundMail.accounts.edit.submit"),
  redirect: MAIL_ACCOUNT_LIST_SCREEN_ID,
  cancelTarget: MAIL_ACCOUNT_LIST_SCREEN_ID,
  access: MAIL_ACCOUNT_ADMIN_ACCESS,
  dormant: true,
};

export const mailAccountSenderCheckScreen: ActionFormScreenDefinition = {
  id: MAIL_ACCOUNT_SENDER_CHECK_SCREEN_ID,
  type: "actionForm",
  agent: { expose: false },
  handler: InboundMailFoundationHandlers.setTrustedAuthservId,
  fields: {
    accountId: { type: "text", required: true },
    trustedAuthservId: { type: "text", maxLength: 255 },
  },
  layout: {
    sections: [
      {
        description: i18nKey("inboundMail.accounts.senderCheckHint"),
        fields: [{ field: "accountId", readOnly: true }, "trustedAuthservId"],
      },
    ],
  },
  submitLabel: i18nKey("inboundMail.accounts.senderCheck.submit"),
  redirect: MAIL_ACCOUNT_LIST_SCREEN_ID,
  cancelTarget: MAIL_ACCOUNT_LIST_SCREEN_ID,
  access: MAIL_ACCOUNT_ADMIN_ACCESS,
  dormant: true,
};
