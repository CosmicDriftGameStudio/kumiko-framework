---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

Fix the `DataTable` empty state rendering the literal English `No entries.` in translated apps: `DefaultDataTable` now resolves its default empty label through `kumiko.list.no-entries` (already shipped in the framework catalog and translated in `@cosmicdrift/kumiko-locale-de`/`-es`) instead of a hardcoded string. This covers every caller that does not pass its own `emptyState` — notably the `relatedList` path of a `projectionDetail`, where an empty list in a German app showed `No entries.` Callers outside a `LocaleProvider` still fall back to the English literal.
