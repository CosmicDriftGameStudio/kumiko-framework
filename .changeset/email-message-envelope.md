---
"@cosmicdrift/kumiko-bundled-features": minor
---

channel-email: `EmailMessage` now carries optional `from` / `replyTo` / `headers`. A single send can override the app-wide default From (e.g. a reply from the mailbox the original mail reached) and set threading headers (`In-Reply-To` / `References`). `createSmtpTransport` forwards them to nodemailer, the email delivery channel copies them off the notification's channel data, and the PII guard refuses a ciphertext `from`/`reply-to` the same way it already refuses a ciphertext recipient. Fully backward-compatible — omit the fields and behaviour is unchanged.
