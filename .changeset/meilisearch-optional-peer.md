---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-dev-server": minor
---

meilisearch is an optional peer dependency

<!-- kumiko-changes
feature: framework
type: breaking
title: meilisearch is an optional peer dependency
migration: |
  Apps that import @cosmicdrift/kumiko-framework/search/meilisearch add meilisearch to their own dependencies (bun add meilisearch@^0.58.0); without it that import fails at boot with a message that names the package. Apps without the Meilisearch adapter need nothing.
-->
