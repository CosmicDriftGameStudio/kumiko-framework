---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-cli": patch
---

Schema CLI and scaffold tests no longer reach the shared dev database through DATABASE_URL.

<!-- kumiko-changes
feature: framework
type: fix
title: schema-cli validate and scaffold check tests run without DATABASE_URL
detail: `schema validate` checks the live row-level security state whenever DATABASE_URL is set. The validate-boot-options tests and the scaffolded `kumiko check boot` test inherited the host value and hit the shared local dev database, so they failed locally on its old policies while CI stayed green. They now run without DATABASE_URL, which makes local and CI runs equal.
-->
