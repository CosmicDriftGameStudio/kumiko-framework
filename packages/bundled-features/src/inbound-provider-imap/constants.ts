export const FEATURE_NAME = "inbound-provider-imap";
export const IMAP_PROVIDER_KEY = "imap";

export const ImapHandlers = {
  connectMailbox: "inbound-provider-imap:write:connect-mailbox",
  reconnectMailbox: "inbound-provider-imap:write:reconnect-mailbox",
} as const;

export const ImapQueries = {
  reconnectPrefill: "inbound-provider-imap:query:reconnect-prefill",
} as const;

export const IMAP_RECONNECT_ERRORS = {
  notPasswordImap: {
    reason: "reconnect_not_password_imap",
    i18nKey: "inboundMail.imap.reconnect.errors.notPasswordImap",
  },
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

// Same categories as IMAP_CONNECT_ERRORS, for the outgoing server checked after the IMAP login.
export const SMTP_CONNECT_ERRORS = {
  hostUnreachable: {
    reason: "smtp_host_unreachable",
    i18nKey: "inboundMail.imap.connect.errors.smtpHostUnreachable",
  },
  loginRejected: {
    reason: "smtp_login_rejected",
    i18nKey: "inboundMail.imap.connect.errors.smtpLoginRejected",
  },
  tlsFailed: {
    reason: "smtp_tls_failed",
    i18nKey: "inboundMail.imap.connect.errors.smtpTlsFailed",
  },
  connectFailed: {
    reason: "smtp_connect_failed",
    i18nKey: "inboundMail.imap.connect.errors.smtpConnectFailed",
  },
} as const satisfies Record<keyof typeof IMAP_CONNECT_ERRORS, unknown>;

export const SMTP_SUBMISSION_PORT = 587;
