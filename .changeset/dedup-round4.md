---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-guards": patch
---

Duplicate cleanup round 4: repeated code moves into shared helpers without behavior changes, and four small helpers that apps had copied become public exports. Static files ending in .webp are now served as image/webp.

<!-- kumiko-changes
feature: framework
type: improvement
title: findEntity is exported from the engine entry point
detail: findEntity(features, entityName) from @cosmicdrift/kumiko-framework/engine returns the entity definition a mounted feature declares under that name, or undefined. It reads the raw feature definitions, not the merged registry entity map. Internal duplicates in logging, jobs, metrics, event consumers, transactions, dispatch and the role projection now share helpers; messages and behavior are unchanged.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: toggleSetMember helper
detail: toggleSetMember(set, value) from @cosmicdrift/kumiko-renderer returns a new Set with value removed if it was present and added if it was not. The input set is not changed, so it fits React state updaters for expanded or collapsed ids.
-->

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: writeStaticHtmlPages and webp content type
detail: writeStaticHtmlPages(outDir, pages) from @cosmicdrift/kumiko-server-runtime writes each { path, html } to <outDir>/<path>/index.html (an empty path writes <outDir>/index.html) and creates the directories. Before writing anything it rejects absolute paths, backslashes and ".." segments. Apps that render marketing pages per locale into dist/pages can use it instead of their own node:fs code. The prod static file server now answers .webp files with content-type image/webp instead of application/octet-stream.
-->

<!-- kumiko-changes
feature: dev-server
type: fix
title: webp content type for public files
detail: The dev server serves .webp files from public/ with content-type image/webp, the same as prod.
-->

<!-- kumiko-changes
feature: tier-engine
type: improvement
title: capsForTierFromMap
detail: capsForTierFromMap(tierMap, isTierName, defaultTier) returns a capsForTier function for createTierResolver. An unknown tier name falls back to defaultTier; if the map has no entry for the resolved name it throws. Apps with a hand-written capsForTier over their tier map can switch to it.
-->

<!-- kumiko-changes
feature: guards
type: improvement
title: No-Direct-Fs allowlists the static page writer
detail: packages/server-runtime/src/static-html-pages.ts is on the No-Direct-Fs allowlist, next to run-prod-app-static-files.ts. It writes build output under the caller's outDir and checks page paths for traversal.
-->
