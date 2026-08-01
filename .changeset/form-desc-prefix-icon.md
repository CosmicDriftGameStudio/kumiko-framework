---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

`entityEdit` screens now support two declarative form-affordances that previously required custom JSX:

- `EditFieldsSection.description` — an optional help text (i18n key or raw string) under a block heading, rendered through the same `subtitle` slot as `FormProps.subtitle`.
- `EditFieldSpec.icon` — an optional prefix icon on `text`/`number` fields, resolved against a small `FIELD_ICONS` registry in `kumiko-renderer-web` (mail, lock, hash, search, user, phone, calendar, link, tag, building, globe, key, map-pin). Unknown keys fall back to no icon.

Closes #1677.
