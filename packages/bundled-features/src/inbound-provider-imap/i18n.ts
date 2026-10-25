import { IMAP_CONNECT_SCREEN_ID } from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import { ACTION_FORM_ENTITY } from "@cosmicdrift/kumiko-framework/ui-types";
import { fieldLabelKey } from "@cosmicdrift/kumiko-renderer/headless";
import { FEATURE_NAME, IMAP_CONNECT_ERRORS } from "./constants.ts";

const formFieldKey = (field: string): string =>
  fieldLabelKey(FEATURE_NAME, ACTION_FORM_ENTITY, field);

export const INBOUND_PROVIDER_IMAP_I18N: Readonly<Record<string, { readonly en: string }>> = {
  [`screen:${IMAP_CONNECT_SCREEN_ID}.title`]: { en: "Connect mailbox" },
  [formFieldKey("displayName")]: { en: "Name" },
  [formFieldKey("address")]: { en: "Email address" },
  [formFieldKey("host")]: { en: "IMAP server" },
  [formFieldKey("port")]: { en: "Port" },
  [formFieldKey("user")]: { en: "User name" },
  [formFieldKey("password")]: { en: "Password" },
  "inboundMail.imap.connect.server": { en: "Server sign-in" },
  "inboundMail.imap.connect.submit": { en: "Check and connect" },
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
};
