# Handbook knowledge

Serves the app's handbook to the AI assistant. `kumiko handbuch knowledge` exports
the pages per locale as JSON; the `handbook-knowledge` bundled feature mounts them
as two query tools, so the assistant can answer how-do-I questions from the real
handbook text.

## What it shows

- **Feature** — `createHandbookKnowledgeFeature({ pages, access, publicPath })`.
  No entity, no migration; `access` decides which roles see the tools.
- **list-pages** — catalog of id, kind, title and questions in the caller's language.
- **read-page** — one page body; the language falls back to the handbook's default
  language, long pages are cut with a visible notice, unknown ids are `not_found`.
- **Test** — `setupTestStack` and HTTP with an `X-Locale` header.

## Files

```
src/feature.ts                              fixed handbook JSON and the feature
src/__tests__/feature.integration.test.ts   list-pages, read-page, fallback, not found
```
