---
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-dev-server": patch
---

Shared request-bound systemQuery wiring and clearer deploy scaffold warnings

`@cosmicdrift/kumiko-server-runtime/request-bound-system-query` exports the systemQuery wiring that the prod static-file path and the dev server previously each copied. `scaffoldDeploy` now tells a broken `package.json` (deploy settings fall back to defaults) apart from an unexpected `dependencies`/`workspaces` shape in its warning.

<!-- kumiko-changes
feature: framework
type: improvement
title: Deploy scaffold warnings distinguish broken package.json from unexpected dependency shapes
-->
