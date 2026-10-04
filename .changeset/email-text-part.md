---
"@cosmicdrift/kumiko-bundled-features": minor
---

Email text part

`EmailMessage` gets an optional `text`. With it the SMTP transport sends `multipart/alternative` with a plain-text part. `NotificationRenderer` gets an optional `renderText`, which the email channel sends next to the HTML through the queued render and send jobs. `createSimpleRenderer` implements it from the template data (header, sections, footer, branding footer; buttons as `label: url`). The GDPR default mails return and send `text` as well. The PII guard checks and redacts `text` like the body.

<!-- kumiko-changes
feature: channel-email
type: improvement
title: Mails get a plain-text part (EmailMessage.text, NotificationRenderer.renderText, simple renderer and GDPR mails fill it)
-->
