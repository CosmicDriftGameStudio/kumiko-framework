---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-dev-server": minor
---

renderer-mail-html in bundled-features depends on html-to-text ^10.0.1, and the managed-files check rejects overrides of Kumiko packages.

<!-- kumiko-changes
feature: renderer-mail-html
type: fix
title: html-to-text 10
detail: The plain-text part of mails is rendered with html-to-text ^10.0.1 instead of ^9.0.5, so apps no longer need an override to get the patched version.
-->

<!-- kumiko-changes
feature: dev-server
type: breaking
title: Overrides of Kumiko packages fail the managed-files check
detail: `kumiko check-managed` reports every `@cosmicdrift/kumiko-*` or `@cosmicdriftgamestudio/kumiko-*` entry in `overrides` or `resolutions`. Published Kumiko packages pin each other exactly, so such an override only hides a version drift.
migration: Delete the Kumiko entries from `overrides` and `resolutions` and keep the exact pins in `dependencies`. Also delete overrides for html-to-text, nodemailer, sharp and happy-dom, which the framework now brings in patched versions.
affects: overrides, resolutions
-->
