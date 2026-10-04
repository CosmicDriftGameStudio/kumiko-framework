---
status: reference
verified: 2026-10-04
evidence: "packages/bundled-features/src/channel-email/types.ts; packages/bundled-features/src/channel-email/smtp-transport.ts; packages/bundled-features/src/renderer-simple/simple-renderer.ts; packages/bundled-features/src/user-data-rights/email-templates.ts; packages/bundled-features/src/delivery/__tests__/delivery-email-text-part.integration.test.ts"
---

# Email text part

`EmailMessage` has an optional `text`. When it is set, the SMTP transport sends the mail as `multipart/alternative` with a plain-text part next to the HTML. Without it the mail stays HTML only.

```ts illustration
await transport.send({ to, subject, html, text });
```

## Where the framework fills it

- `NotificationRenderer` has an optional `renderText(input)`. The email channel calls it next to `render` and sends both parts. The text part survives the queued `delivery.render` → `delivery.send` jobs.
- `createSimpleRenderer` (and `simpleRenderer`) implement `renderText` from the same template data: header, sections, footer and the branding footer, one block per paragraph. Text is not escaped. Markdown sections stay as written. A button becomes `label: url`. Auth, billing and other mails that go through the simple renderer get the text part without changes.
- The GDPR default mails (`renderExportReadyEmail` and the other three) return `text` built from the same translations, and the default mailers send it.

A custom `NotificationRenderer` without `renderText` keeps sending HTML only. The PII guard checks and redacts `text` the same way as subject and body.
