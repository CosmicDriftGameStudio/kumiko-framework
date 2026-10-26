---
"@cosmicdrift/kumiko-framework": patch
---

The app-facing AGENTS.md names the right package for the app test helpers: `setupAppTestStack` and `seedTenant` come from `@cosmicdrift/kumiko-dev-server/testing`, as in the scaffolded integration tests.

<!-- kumiko-changes
feature: framework
type: fix
title: AGENTS.md points app tests at kumiko-dev-server/testing
detail: The Tests section told agents to import setupAppTestStack and seedTenant from @cosmicdrift/kumiko-testing, which does not export them; an agent that followed it got a missing-export error and had to copy the import from the scaffolded test. The section now names @cosmicdrift/kumiko-dev-server/testing. No code change.
-->
