import {
  IMAP_CONNECT_SCREEN_ID,
  MAIL_ACCOUNT_LIST_SCREEN_QN,
} from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import { i18nKey } from "@cosmicdrift/kumiko-framework/engine";
import type { ActionFormScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { ImapHandlers } from "./constants.ts";

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
    secure: { type: "boolean", default: true },
    user: { type: "text", required: true, maxLength: 320 },
    password: { type: "text", required: true, format: "password", sensitive: true },
  },
  layout: {
    sections: [
      // The name-based icon guess reads "address" as a postal address.
      { fields: ["displayName", { field: "address", icon: "mail" }] },
      {
        title: i18nKey("inboundMail.imap.connect.server"),
        fields: ["host", "port", "secure", "user", "password"],
      },
    ],
  },
  submitLabel: i18nKey("inboundMail.imap.connect.submit"),
  redirect: MAIL_ACCOUNT_LIST_SCREEN_QN,
  cancelTarget: MAIL_ACCOUNT_LIST_SCREEN_QN,
  access: { roles: ["SystemAdmin", "TenantAdmin"] },
  dormant: true,
};
