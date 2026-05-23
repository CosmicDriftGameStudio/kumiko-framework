---
"@cosmicdrift/kumiko-cli": minor
---

New package `@cosmicdrift/kumiko-cli` — provides `kumiko` bin for
`bunx @cosmicdrift/kumiko-cli new app <name>` and `add feature <name>`.
Fixes the walkthrough's broken `bunx @cosmicdrift/kumiko-framework`
promise (bin-name ≠ pkg-name). Delegates to scaffoldApp +
scaffoldAppFeature from `@cosmicdrift/kumiko-dev-server`.
