---
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

German and Spanish cover every registered key, enforced by a parity test

The new i18n-parity test in `use-all-bundled` harvests the English copy from the real registrations (feature translations, client plugins, renderer defaults, mail templates) and fails with `key -> locale` when `locale-de` or `locale-es` lacks a key or an en-catalog drifts. This added the missing German and Spanish copy for billing plans, the privacy-center status field and many more keys, and removed 110 translation keys no feature registers any more. German uses "Ereignisprotokoll" for the audit log everywhere. `userDataRights.privacyCenter.restriction.dialogTitle` and `.deletion.dialogTitle` are registered in English by the feature.

<!-- kumiko-changes
feature: locale-de
type: improvement
title: German strings cover every registered key and call the audit log "Ereignisprotokoll" everywhere
-->

<!-- kumiko-changes
feature: locale-es
type: improvement
title: Spanish strings cover every registered key
-->

<!-- kumiko-changes
feature: user-data-rights
type: fix
title: The privacy-center restriction and deletion dialog titles are registered in English by the feature
-->

<!-- kumiko-changes
feature: locale-de
type: breaking
title: locale-de and locale-es drop 110 keys that no framework feature registers any more (old custom-screen keys such as audit.log.*, jobs.runs.*, userDataRights.privacyCenter.title)
migration: |
  The framework no longer renders these keys, so framework screens are unaffected. If app code or an app test calls t() with one of them, register that key in the app's own translations or switch to the key the framework screen uses now (for example the screen title key screen:<screen-id>.title, as in screen:audit-log.title).
-->

<!-- kumiko-changes
feature: locale-es
type: breaking
title: locale-es drops the same keys that no framework feature registers any more
migration: |
  Same as locale-de: register any removed key your app still calls in the app's own translations, or switch to the key the framework screen uses now.
-->
