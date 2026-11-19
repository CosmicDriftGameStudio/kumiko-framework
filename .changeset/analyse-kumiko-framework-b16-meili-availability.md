---
"@cosmicdrift/kumiko-testing": patch
---

`meiliAvailable()` and `liveMeiliConnection()` in `@cosmicdrift/kumiko-testing/helpers` replace the local Meilisearch probes in live search tests.

<!-- kumiko-changes
feature: testing
type: improvement
title: One Meilisearch availability check for live tests
detail: Seven integration test files each had their own `/health` probe, and one of them skipped its live tests silently even when the CI job set `REQUIRE_MEILI=1`. `meiliAvailable()` probes `MEILI_URL` (default from the local service defaults), returns false when Meilisearch is down so the suite can `describe.skipIf`, and throws when `REQUIRE_MEILI=1` is set. `liveMeiliConnection()` returns the URL and master key the tests connect with.
-->
