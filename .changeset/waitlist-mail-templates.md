---
"@cosmicdrift/kumiko-bundled-features": minor
---

Waitlist mails are template notifications

<!-- kumiko-changes
feature: waitlist
type: breaking
title: Waitlist confirmation and admin notice use template variables
detail: The confirmation and admin-notice mails are r.notification declarations (waitlist:notify:confirmation, waitlist:notify:admin-notice) with variables and localized templates. The notify data is the variable object; the confirmation wording is computed in code and passed as variables. The admin notice subject is the submitter name.
migration: |
  Update delivery preferences and tests that referenced the old types or read the sections data. An app that mounts it without includeBundled needs template-resolver, renderer-foundation and @cosmicdrift/kumiko-renderer-mail-html at boot (composeRendererStack() from dev-server mounts all of them), plus a delivery with the channel-email feature; apps without the template tables need a schema migration (`kumiko schema generate`).
-->
