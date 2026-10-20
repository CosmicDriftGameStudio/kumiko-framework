---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
"@cosmicdrift/kumiko-locale-fr": minor
"@cosmicdrift/kumiko-locale-it": minor
---

The tenant "Email sending" screen is a standard settings form. The provider is a select with "Platform sending (default)" and "Own SMTP server"; the SMTP fields sit in the same form with one save.

A selector owner without panels now generates one configEdit screen `<owner>-tenant` instead of a dashboard around a dormant `<owner>-tenant-selection` form. The provider select gets an empty option for "no own provider", labelled by `<field label key>.platformDefault` or the generic `config.settings.provider.platformDefault`.

<!-- kumiko-changes
feature: framework
type: improvement
title: Extension-selector settings form is one standard configEdit screen
detail: Without owner panels the provider form is the `<owner>-tenant` screen itself (no dashboard, no `<owner>-tenant-selection`). The provider select offers an empty "platform default" option next to the plugin ids.
-->

<!-- kumiko-changes
feature: mail-foundation
type: improvement
title: Email sending offers a platform default and an own SMTP server
detail: The provider field is labelled "Send via" with the options "Platform sending (default)" (empty, saved as "") and "Own SMTP server"; the SMTP fields show only while the own server is picked.
-->
