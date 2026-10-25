---
"@cosmicdrift/kumiko-dev-server": patch
---

meilisearch lands in dist-server dependencies only when the bundle imports it or the app declares it.

<!-- kumiko-changes
feature: dev-server
type: improvement
title: meilisearch lands in dist-server dependencies only when the bundle imports it or the app declares it
detail: The package stays external in every server build, but apps without search no longer get it as a production dependency in dist-server/package.json. An app that imports createMeilisearchAdapter, or lists meilisearch in dependencies or optionalDependencies, keeps it with the framework's peer range.
-->
