---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-renderer": minor
---

Security: URL query parameters only prefill form fields that a declared navigate `params` targets.

**BREAKING** — previously an actionForm, secretMint or entityEdit-create screen took *any* query parameter whose name matched a field, so a crafted link could seed e.g. an IBAN or e-mail field. `buildAppSchema` now derives `urlPrefillFields` per form screen from every navigate `params` (entityList/projectionList rowActions, projectionDetail/entityEdit actions, relatedList rowActions, projectionDetail metrics) that targets it, and the renderer ignores every other query parameter. A form no navigate `params` targets takes nothing from the URL. Declared rowAction/action `params` keep working unchanged.

Custom code that prefilled a form via `nav.navigate` + `nav.setSearchParams` (without a declared `params`) must switch to the new `useNavigateWithInitialValues()` hook from `@cosmicdrift/kumiko-renderer`, which hands initial values to the target form in memory instead of the query string. This includes the ai-agent `openForm` client tool (`agentPrefill=1`), which ships in the matching kumiko-enterprise release.

`sensitive` is now projected into the client schema, so the existing "never prefill a sensitive field" rule also applies to entityEdit-create (it was silently inactive there). Sensitive and `format: "password"` fields are never prefilled — not from the URL, not from an allowlist entry, not from a handoff.
