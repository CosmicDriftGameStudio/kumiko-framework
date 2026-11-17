---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

A preSave hook that throws a KumikoError rejects the write with exactly that error instead of presave_hook_failed.

<!-- kumiko-changes
feature: lifecycle-hooks
type: fix
title: preSave hooks reject writes with their own error
detail: A KumikoError thrown by a preSave hook (for example `UnprocessableError` with `details.fields`, `ValidationError`, `NotFoundError`) reaches the caller unchanged, with its code, status, i18nKey and details, and no event is written. Any other throw still answers 422 `presave_hook_failed`. Bundled guards now answer with their own errors: `ledger:schedule:create|update` gives 400 `validation_error` with the missing subject field, `folder:create|update` gives 422 `folder_parent_not_found` or `folder_parent_cycle`, and `documents:filed-document:create|update` gives 404 `not_found` for a foreign pending file or a document whose host the caller cannot edit.
-->
