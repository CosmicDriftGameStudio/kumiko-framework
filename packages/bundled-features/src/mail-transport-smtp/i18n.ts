export const MAIL_TRANSPORT_SMTP_I18N = {
  "screen:mail-transport-smtp-tenant.title": { en: "SMTP server" },
  // Also the option label of mail-foundation's provider select.
  "mail-transport-smtp.settings": { en: "SMTP server" },
  "mail-transport-smtp.settings.secrets": { en: "SMTP sign-in" },
  "mail-transport-smtp.settings.description": {
    en: "The connection details come from your mail provider, for example Brevo, Postmark, Amazon SES or your own server.",
  },
  "mail-transport-smtp.host": { en: "Server address" },
  "mail-transport-smtp.host.description": {
    en: "Host name of the SMTP server, for example smtp.example.com.",
  },
  "mail-transport-smtp.port": { en: "Port number" },
  "mail-transport-smtp.port.description": {
    en: "Usually 587. Use 465 when your provider asks for SSL/TLS.",
  },
  "mail-transport-smtp.secure": { en: "SSL/TLS from the start" },
  "mail-transport-smtp.secure.description": {
    en: "Turn on for port 465. Leave off for 587, which switches to encryption by itself.",
  },
  "mail-transport-smtp.authUser": { en: "User name" },
  "mail-transport-smtp.authUser.description": {
    en: "Login name at the SMTP server, often an email address.",
  },
  "mail-transport-smtp.from": { en: "Sender address" },
  "mail-transport-smtp.from.description": {
    en: "The address mails are sent from, for example status@example.com. Your provider must allow it.",
  },
} as const;
