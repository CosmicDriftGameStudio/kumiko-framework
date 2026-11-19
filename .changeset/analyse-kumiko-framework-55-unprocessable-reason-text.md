---
"@cosmicdrift/kumiko-renderer": patch
---

A business-rule rejection shows its translated reason instead of the generic "request could not be processed" text when the app has a translation for the reason.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Translated reason for unprocessable errors
detail: A write that fails through `failUnprocessable(reason)` arrives with code `unprocessable`, the generic i18nKey `errors.unprocessable` and the slug in `details.reason`. `dispatcherErrorText` (and with it every toast, action form and list action) and the entityEdit error banner now translate `details.reason` as a key when the error carries that generic key and a bundle knows the reason, from `r.translations` or a client feature's translations. Without such a translation they show the generic text as before, and an explicit i18nKey on the error still wins.
-->
