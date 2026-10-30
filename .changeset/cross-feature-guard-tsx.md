---
"@cosmicdrift/kumiko-guards": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

The cross-feature import guard now checks .tsx files too, and a feature's web barrel counts as public.

<!-- kumiko-changes
feature: guards
type: improvement
title: Cross-feature import guard scans .tsx and accepts web barrels
detail: The guard scanned only .ts files, so a deep import across features from a .tsx screen or cell went through. It now scans .tsx as well (test files stay excluded). Next to the barrel, contract and schema/entity, another feature's web barrel (`../B/web`, `../B/web/index.ts`) is allowed, because browser code must not load the server barrel. Consumer note: after the bump, deep imports across feature boundaries in .tsx files fail the guard; import from the feature's barrel, its web barrel or its contract instead.
-->
