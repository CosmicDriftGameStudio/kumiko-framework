---
"@cosmicdrift/kumiko-server-runtime": minor
---

PageHeadMeta/PageHeadResolver/PageHeadSystemQuery now importable from the server-runtime barrel

The three resolvePageHead types moved to @cosmicdrift/kumiko-headless/apex (kumiko-framework#3026) and are re-exported unchanged from run-prod-app.ts, so the existing @cosmicdrift/kumiko-server-runtime/run-prod-app subpath import keeps working. New: the main @cosmicdrift/kumiko-server-runtime barrel now also exports all three, closing the gap where a consumer had to use the subpath just to type a resolver. render-head-tags.ts (internal-only, not a public subpath) is removed; injectPageHead now lives in headless.

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: PageHeadMeta/PageHeadResolver/PageHeadSystemQuery now importable from the server-runtime barrel
-->
