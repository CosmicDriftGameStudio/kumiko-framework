---
"@cosmicdrift/kumiko-bundled-features": minor
---

Remove AuthMailContent from auth-email-password

<!-- kumiko-changes
feature: auth-email-password
type: breaking
title: AuthMailContent is removed
detail: The sections-based content type only fed the retired renderer-simple. Auth mails are template notifications with variables, so nothing builds or consumes AuthMailContent anymore.
migration: |
  Drop AuthMailContent imports; the auth mail text lives in the seeded templates and is overridden per tenant in the template editor.
-->
