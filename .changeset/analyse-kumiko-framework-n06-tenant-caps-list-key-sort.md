---
"@cosmicdrift/kumiko-bundled-features": minor
---

`cap-overview:query:tenant-caps:list` no longer decrypts every tenant name per call: it sorts by the plaintext tenant key by default, searches names through the SearchAdapter and decrypts only the names of the returned page.

<!-- kumiko-changes
feature: cap-overview
type: breaking
title: Tenant caps list sorts by key and searches through the search index
detail: Tenant names are ciphertext at rest, so the list used to decrypt every tenant on each call (the default sort was the name, and every search filtered decrypted names). The default sort is now the tenant `key`, each row carries `key`, and `sort: "name"` is rejected with a 400 like any other unsupported sort field. A search goes through the app's SearchAdapter, where the tenant name is already indexed for `tenant:query:list`, and answers 422 `search_adapter_not_wired` when no adapter is wired; more than 1000 candidate hits set `searchTruncated`. Only the names of the returned page are decrypted.
migration: Callers that send `sort: "name"` to `cap-overview:query:tenant-caps:list` drop it or send `sort: "key"`. Apps that search this list wire a SearchAdapter. No caller in kumiko-enterprise, kumiko-platform, kumiko-studio or the app repos sends `sort: "name"`.
-->
