---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-testing": minor
---

channel-email: fromName sets the display name of the From header

`EmailMessage` gets an optional `fromName`, and the email channel passes `data.fromName` through like `replyTo`. The SMTP transport combines it with the address of `message.from` or the transport default, so `from: "App <noreply@x>"` plus `fromName: "Tenant via veridom"` sends from `noreply@x` under the new name. Control characters in the name are replaced by spaces before sending, and an empty name behaves like no name. The PII ciphertext guard refuses a ciphertext `fromName`.

<!-- kumiko-changes
feature: channel-email
type: improvement
title: EmailMessage.fromName sets the From display name
-->
