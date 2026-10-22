---
"@cosmicdrift/kumiko-testing": minor
---

`@cosmicdrift/kumiko-testing/e2e` exports `presentIdentitiesOnPage`, `restoreIdentitiesOnPage` and `withPresentedIdentities(page, mappings, fn)`. Specs can show stable identities for their own `page.screenshot` calls and get the real values back even when the callback throws.

<!-- kumiko-changes
feature: testing
type: improvement
title: E2E specs can present stable identities around their own screenshots
detail: withPresentedIdentities replaces generated identities in page text and form values, runs the callback and restores the originals in a finally block. The lower-level present and restore functions are exported too.
-->
