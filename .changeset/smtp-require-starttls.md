---
"@cosmicdrift/kumiko-bundled-features": minor
---

SMTP transports now require STARTTLS (or implicit TLS) and refuse to send in clear text.

<!-- kumiko-changes
feature: channel-email
type: breaking
title: SMTP requires STARTTLS unless the host is loopback or allowlisted
detail: `createSmtpTransport` (also via `createSmtpTransportFromEnv` and the per-tenant mail-transport-smtp) now sets nodemailer `requireTLS` when `secure` is false. A public SMTP server that offers no STARTTLS no longer receives mail or credentials in clear text; sending fails instead. Loopback hosts (`localhost`, `127.0.0.0/8`, `::1`) and hosts in the operator allowlist `KUMIKO_MAIL_ALLOWED_PRIVATE_HOSTS` stay plaintext-capable so local dev catchers such as Mailpit keep working.
migration: Point the SMTP host at a server that offers STARTTLS or implicit TLS (`SMTP_SECURE=true`, port 465). For a private dev catcher that has no TLS, list its host in `KUMIKO_MAIL_ALLOWED_PRIVATE_HOSTS`; loopback hosts need no entry.
-->
