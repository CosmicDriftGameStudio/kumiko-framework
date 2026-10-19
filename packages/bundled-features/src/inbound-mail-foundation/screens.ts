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

export const MAIL_ACCOUNT_STATUS_OPTION_KEY_PREFIX = "inboundMail.accounts.status.";

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
  access: MAIL_ACCOUNT_ADMIN_ACCESS,
  dormant: true,
};

// The reason is the audit label update-account requires; it is not in the
// layout, so the default is what gets written.
export const mailAccountEditScreen: ActionFormScreenDefinition = {
  id: MAIL_ACCOUNT_EDIT_SCREEN_ID,
  type: "actionForm",
  agent: { expose: false },
  handler: InboundMailFoundationHandlers.updateAccount,
  fields: {
    accountId: { type: "text", required: true },
    displayName: { type: "text", required: true, maxLength: 200 },
    reason: { type: "text", default: "tenant_admin" },
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
