export const FEATURE_NAME = "inbound-provider-imap";
export const IMAP_PROVIDER_KEY = "imap";

export const ImapHandlers = {
  connectMailbox: "inbound-provider-imap:write:connect-mailbox",
} as const;

export const IMAP_CONNECT_ERRORS = {
  hostUnreachable: {
    reason: "imap_host_unreachable",
    i18nKey: "inboundMail.imap.connect.errors.hostUnreachable",
  },
  loginRejected: {
    reason: "imap_login_rejected",
    i18nKey: "inboundMail.imap.connect.errors.loginRejected",
  },
  tlsFailed: { reason: "imap_tls_failed", i18nKey: "inboundMail.imap.connect.errors.tlsFailed" },
  connectFailed: {
    reason: "imap_connect_failed",
    i18nKey: "inboundMail.imap.connect.errors.connectFailed",
  },
} as const;
