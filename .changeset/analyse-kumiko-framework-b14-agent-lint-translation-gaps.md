---
"@cosmicdrift/kumiko-cli": minor
---

`kumiko agent lint` exits 1 when an agent-callable write handler lacks a title or field-label translation.

<!-- kumiko-changes
feature: agent-tools
type: breaking
title: Agent lint fails on missing handler translations
detail: The handler translation gaps that `kumiko agent lint` listed as warnings now fail the command, and `kumiko check` with it. App-local tests that asserted the same titles are no longer needed.
migration: Add the reported title and field-label keys (`handlerTranslationKeys` from `@cosmicdrift/kumiko-framework/engine`), or hide the handler from the agent with `agent: { expose: false }`. Delete app tests that only re-check handler titles.
-->
