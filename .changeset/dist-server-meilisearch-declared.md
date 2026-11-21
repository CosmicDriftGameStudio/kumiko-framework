---
"@cosmicdrift/kumiko-dev-server": patch
---

`kumiko-build` lists `meilisearch` in `dist-server/package.json` only when the app declares it. Since 0.425.1 the server runtime lazy-loads the framework's meilisearch adapter, so every server bundle contains an import of `meilisearch` and the import scan added it to every app. Apps without `meilisearch` in their lock then failed the offline lockfile step (`Failed to resolve root prod dependency 'meilisearch'`), which broke every Studio customer build on 0.425.1 and 0.426.0.

<!-- kumiko-changes
feature: dev-server
type: fix
title: dist-server installs meilisearch only when the app declares it
detail: The server bundle always references meilisearch through the lazily loaded search adapter, so an import in the bundle no longer adds it to the runtime dependencies. Builds without internet access work again for apps that do not use search.
migration: Apps that configure search "meili-env" must declare meilisearch in their package.json dependencies; resolveSearchOption already reports this at boot.
-->
