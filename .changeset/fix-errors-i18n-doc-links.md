---
"@cosmicdrift/kumiko-framework": patch
---

Fix dead docs links in the error-reason i18n texts (en + de): the targets
`/{en,de}/architecture/*` and `/en/features/feature-toggles/` never existed on
docs.kumiko.rocks. Links now point to the real pages (`/en/concepts/commands/`,
`/en/guides/field-level-permissions/`, `/en/feature-reference/feature-toggles/`);
the state-machine link is dropped until a target page exists. German texts link
to the English pages — the docs site is single-locale by design.
