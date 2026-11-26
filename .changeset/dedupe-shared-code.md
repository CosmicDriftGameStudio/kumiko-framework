---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-feature-ast": patch
"create-kumiko-app": patch
---

Duplicated code in the forgot-password and unlock screens, the IMAP screens and row actions is shared; behaviour is unchanged.

<!-- kumiko-changes
feature: framework
type: fix
title: Email request screens, IMAP screens and row actions share their duplicated code
detail: The forgot-password and account-unlock screens render one shared screen, the IMAP connect screens share their fields, and row actions share their base properties. Texts and test ids are unchanged; nothing to do for apps.
-->
