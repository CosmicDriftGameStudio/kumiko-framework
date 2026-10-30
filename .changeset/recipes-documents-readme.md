---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
---

The documents recipe gets a README so the docs site generates its sample page, and gen-sample-index now fails when a primarySample has no README.

<!-- kumiko-changes
feature: documents
type: fix
title: Documents recipe has a README and gen-sample-index rejects a primarySample without one
detail: feature-reference linked to /en/samples/recipes-documents/, a page the docs site never generated because the recipe had no README.md. The README is added, and gen-sample-index aborts with the feature, the sample and the fix when a primarySample from sample-index.overrides.json has no README.md.
-->
