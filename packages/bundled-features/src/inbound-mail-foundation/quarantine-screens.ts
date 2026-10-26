import {
  i18nKey,
  MAX_LIST_LIMIT,
  type ProjectionListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { InboundMailFoundationHandlers, InboundMailFoundationQueries } from "./constants.ts";
import { MAIL_QUARANTINE_SCREEN_ID } from "./screens.ts";

export const QUARANTINE_REASON_OPTION_KEY_PREFIX = "inboundMail.quarantine.reason.";

// Same roles as the handlers; the bound query shows each caller only the mailboxes they may manage.
// dormant: reached through the row action "Quarantine" of the mailbox list.
export const mailQuarantineScreen: ProjectionListScreenDefinition = {
  id: MAIL_QUARANTINE_SCREEN_ID,
  type: "projectionList",
  agent: { expose: false },
  query: InboundMailFoundationQueries.listQuarantine,
  pagination: false,
  pageSize: MAX_LIST_LIMIT,
  columns: [
    { field: "sender", label: i18nKey("inboundMail.quarantine.col.sender"), sortable: false },
    { field: "subject", label: i18nKey("inboundMail.quarantine.col.subject"), sortable: false },
    {
      field: "reason",
      label: i18nKey("inboundMail.quarantine.col.reason"),
      sortable: false,
      renderer: { format: "enumOption", keyPrefix: QUARANTINE_REASON_OPTION_KEY_PREFIX },
    },
    {
      field: "accountName",
      label: i18nKey("inboundMail.quarantine.col.mailbox"),
      sortable: false,
      hideOnNarrow: true,
    },
    {
      field: "quarantinedAt",
      label: i18nKey("inboundMail.quarantine.col.date"),
      sortable: false,
      renderer: { format: "timestamp" },
    },
  ],
  rowActions: [
    {
      kind: "writeHandler",
      id: "retry",
      label: i18nKey("inboundMail.quarantine.retry"),
      handler: InboundMailFoundationHandlers.retryQuarantinedMessage,
      payload: { map: { accountId: "accountId", providerMessageId: "providerMessageId" } },
      visible: { field: "retryRequestedAt", eq: null },
    },
    {
      kind: "writeHandler",
      id: "acknowledge",
      label: i18nKey("inboundMail.quarantine.acknowledge"),
      handler: InboundMailFoundationHandlers.acknowledgeQuarantine,
      payload: { map: { accountId: "accountId", providerMessageId: "providerMessageId" } },
    },
  ],
  access: { roles: ["SystemAdmin", "TenantAdmin", "User"] },
  dormant: true,
};
