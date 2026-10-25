export const MAIL_PROBE_KEYS = {
  area: "mail-foundation.probe.area",
  label: "mail-foundation.probe.send-test-mail.label",
  accepted: "mail-foundation.probe.send-test-mail.accepted",
  notConfigured: "mail-foundation.probe.not-configured",
  noRecipient: "mail-foundation.probe.no-recipient",
} as const;

export const MAIL_FOUNDATION_I18N = {
  "screen:mail-foundation-tenant.title": { en: "Email sending" },
  "mail-foundation.settings": { en: "Email sending" },
  "mail-foundation.provider": { en: "Send via" },
  "mail-foundation.provider.description": {
    en: "Choose who sends your emails. The platform default needs no settings of your own.",
  },
  "mail-foundation.provider.platformDefault": { en: "Platform sending (default)" },
  [MAIL_PROBE_KEYS.area]: { en: "Email" },
  [MAIL_PROBE_KEYS.label]: { en: "Test email to the person who started the check" },
  [MAIL_PROBE_KEYS.accepted]: { en: "Accepted by the mail server" },
  [MAIL_PROBE_KEYS.notConfigured]: { en: "No own email sending set up" },
  [MAIL_PROBE_KEYS.noRecipient]: {
    en: "No email address known for the person who started the check",
  },
} as const;
