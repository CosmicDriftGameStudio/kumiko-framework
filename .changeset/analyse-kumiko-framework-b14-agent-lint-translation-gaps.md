---
"@cosmicdrift/kumiko-cli": minor
"@cosmicdrift/kumiko-bundled-features": patch
---

`kumiko agent lint` exits 1 when an agent-callable write handler lacks a title or field-label translation.

<!-- kumiko-changes
feature: agent-tools
type: breaking
title: Agent lint fails on missing handler translations
detail: The handler translation gaps that `kumiko agent lint` listed as warnings now fail the command, and `kumiko check` with it. A fully spelled-out key counts from any mounted feature, as on the client, so an app labels handlers that a bundled feature derives from its config, such as template-resolver's `<id>-set` for each declared collection. App-local tests that asserted the same titles are no longer needed.
migration: Add the reported title and field-label keys (`handlerTranslationKeys` from `@cosmicdrift/kumiko-framework/engine`), or hide the handler from the agent with `agent: { expose: false }`. For template-resolver collections register them in an app feature with `handlerTranslationKeys(TEMPLATE_RESOLVER_FEATURE, { writes: { "<id>-set": { title, fields } } })`. Delete app tests that only re-check handler titles.
affects: all
-->
