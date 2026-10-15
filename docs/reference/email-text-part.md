---
status: reference
verified: 2026-10-04
evidence: "packages/bundled-features/src/channel-email/types.ts; packages/bundled-features/src/channel-email/smtp-transport.ts; packages/bundled-features/src/channel-email/email-channel.ts; packages/bundled-features/src/user-data-rights/mail-notifications.ts; packages/bundled-features/src/delivery/__tests__/delivery-email-text-part.integration.test.ts"
---

# Email text part

`EmailMessage` has an optional `text`. When it is set, the SMTP transport sends the mail as `multipart/alternative` with a plain-text part next to the HTML. Without it the mail stays HTML only.

```ts illustration
await transport.send({ to, subject, html, text });
```

## Where the framework fills it

- The email channel renders a notification's stored mail template through `ChannelContext.renderMail` (`renderer-mail-html`). The renderer returns `subject`, `html` and `text` from the same template, and the channel sends all three. The text part survives the queued `delivery.render` → `delivery.send` jobs.
- Auth, billing, waitlist and the GDPR default mails are `r.notification` declarations with a template, so they get the text part without extra code.

A notification without a mail template has no email delivery at all. The PII guard checks and redacts `text` the same way as subject and body.
