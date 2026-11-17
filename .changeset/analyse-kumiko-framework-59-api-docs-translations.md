---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-cli": patch
---

`apiDocs.translations` loads texts that only the API docs need, and `resolveApiDocsConfig` is async.

<!-- kumiko-changes
feature: agent-tools
type: breaking
title: Doc-only translations for kumiko api-docs
detail: Apps that document their API in more locales than the app itself mounted one pseudo-feature per locale so the boot rule i18n/locale-inconsistent would accept the extra texts, and those texts were loaded on every server boot. `apiDocs.translations` in kumiko.config.ts is a function returning full translation keys, for example `() => import("./src/api-docs-texts").then((m) => m.texts)`. Only `kumiko api-docs` calls it. Per key and locale it fills only what the registry does not define. `resolveApiDocsConfig` from `@cosmicdrift/kumiko-bundled-features/agent-tools` now returns a Promise; callers await it.
affects: resolveApiDocsConfig, apiDocs
-->
