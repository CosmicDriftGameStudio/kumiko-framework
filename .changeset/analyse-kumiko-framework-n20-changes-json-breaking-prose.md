---
"@cosmicdrift/kumiko-framework": patch
---

`changes.json` keeps prose only for breaking changes. Fixes and improvements carry version, type and title there; their text stays in the package CHANGELOG.md.

<!-- kumiko-changes
feature: framework
type: improvement
title: changes.json keeps detail only on breaking entries
detail: `kumiko changes fold` drops `detail` from improvement and fix entries and strips it from every existing changes.json in the repo on the next release, so the published framework changelog shrinks from about 690 KB to about 390 KB. Breaking entries keep detail and migration, and codemods stay on every entry type. `kumiko-upgrade --verbose` therefore prints prose only for breaking changes; the text of a fix or improvement is in the package CHANGELOG.md.
-->
